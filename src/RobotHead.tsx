import { forwardRef, useEffect, useId, useImperativeHandle, useRef, type MouseEvent } from 'react';
import type { RobotHeadProps, RobotHeadShape, RobotHeadState } from './types';
import { getShape } from './tv/geometry';
import { RobotSim, restPose } from './tv/sim';
import { RobotRenderer, frameFor, type Palette } from './tv/render';
import { linear } from './tv/light';
import { parseColor } from './color';
import { subscribe, pointer } from './ticker';
import type { SoundPlayer } from './sound/player';

export const robotHeadShapes: RobotHeadShape[] = ['rectangle', 'square', 'circle', 'hexagon'];

export const robotHeadStates: RobotHeadState[] = ['idle', 'thinking', 'searching', 'listening', 'speaking', 'working', 'happy', 'error', 'sleeping'];

const labels: Record<RobotHeadState, string> = {
  idle: 'idle',
  thinking: 'thinking',
  searching: 'searching',
  listening: 'listening',
  speaking: 'speaking',
  working: 'working',
  happy: 'happy',
  error: 'error',
  sleeping: 'sleeping',
};

function hashSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

/* the sounds are fetched the first time any head turns them on */
let soundModule: Promise<typeof import('./sound/player')> | null = null;

const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function palette(color: string, trim: string, screen: string): Palette {
  const shell = parseColor(color) ?? [48, 80, 172];
  const metal = parseColor(trim) ?? [150, 168, 200];
  const led = parseColor(screen) ?? [232, 242, 255];
  return {
    shell: { albedo: linear(shell), f0: 0.05, metal: 0.15, spec: 0.55, shininess: 70, rim: 0.9 },
    trim: { albedo: linear(metal), f0: 0.2, metal: 0.65, spec: 0.8, shininess: 45, rim: 0.7 },
    led,
  };
}

/**
 * A TV-headed robot: a glossy moulded shell with knob ears and an
 * antenna, and an LED matrix for a face that shows what it is doing.
 *
 * The element is a `size` × `size` box with the robot at rest centred
 * in it. Its canvas reaches past the box, so hops, the antenna's glow and
 * the floor's shadow draw outside it without taking part in layout.
 */
export const RobotHead = forwardRef<HTMLCanvasElement, RobotHeadProps>(function RobotHead(
  {
    model = 'tv',
    shape = 'rectangle',
    state = 'idle',
    size = 160,
    color = '#2b49a3',
    trimColor = '#93a6c8',
    screenColor = '#e8f2ff',
    speed = 1,
    paused = false,
    interactive = true,
    floorShadow = true,
    antenna = true,
    sound = false,
    onCue,
    seed,
    className,
    style,
    onClick,
    'aria-label': ariaLabel,
    ...rest
  },
  ref
) {
  void model;
  const boxRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useImperativeHandle(ref, () => canvasRef.current as HTMLCanvasElement);
  const reactId = useId();
  const stateKey: RobotHeadState = state in labels ? state : 'idle';
  const shapeKey: RobotHeadShape = robotHeadShapes.includes(shape) ? shape : 'rectangle';
  const seedValue = Math.min(1, Math.max(0, seed ?? hashSeed(reactId)));
  const still = paused || !(speed > 0);

  const sim = useRef<RobotSim | null>(null);
  const renderer = useRef<RobotRenderer | null>(null);
  const pal = useRef<Palette>(palette(color, trimColor, screenColor));
  pal.current = palette(color, trimColor, screenColor);
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const interactiveRef = useRef(interactive);
  interactiveRef.current = interactive;
  const shadowRef = useRef(floorShadow);
  shadowRef.current = floorShadow;
  const antennaRef = useRef(antenna);
  antennaRef.current = antenna;
  const onCueRef = useRef(onCue);
  onCueRef.current = onCue;
  const soundRef = useRef(sound);
  soundRef.current = sound;
  const player = useRef<SoundPlayer | null>(null);
  const soundOn = !!sound;

  useEffect(() => {
    if (!soundOn || player.current) return;
    let live = true;
    (soundModule ??= import('./sound/player')).then(
      (m) => {
        if (live && !player.current) player.current = new m.SoundPlayer();
      },
      () => {
        soundModule = null;
      }
    );
    return () => {
      live = false;
    };
  }, [soundOn]);
  useEffect(() => () => player.current?.dispose(), []);

  if (!sim.current) sim.current = new RobotSim(seedValue, stateKey);
  sim.current.setState(stateKey);

  const frame = frameFor(getShape(shapeKey), antenna, size);
  const frameRef = useRef(frame);
  frameRef.current = frame;

  const paint = (animated: boolean) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
    const f = frameRef.current;
    const w = Math.round((f.box + 2 * f.padSide) * dpr);
    const h = Math.round((f.box + f.padTop + f.padBottom) * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (!renderer.current) renderer.current = new RobotRenderer();
    const s = sim.current!;
    renderer.current.draw(ctx, f, dpr, animated ? s.pose : restPose(stateKey), animated ? s : null, stateKey, getShape(shapeKey), pal.current, { floorShadow: shadowRef.current, antenna: antennaRef.current });
  };

  useEffect(() => {
    if (still || reducedMotion()) {
      paint(false);
      /* a still head is quiet, and doesn't catch up on what it missed */
      sim.current!.cues.length = 0;
      player.current?.setLoop(false);
      return;
    }
    const unsubscribe = subscribe((dt) => {
      const s = sim.current!;
      const el = boxRef.current;
      if (el && interactiveRef.current && Number.isFinite(pointer.x)) {
        /* measured from the resting head's centre */
        const box = el.getBoundingClientRect();
        const f = frameRef.current;
        const dx = pointer.x - (box.left + box.width / 2);
        const dy = pointer.y - (box.top + f.cy - f.padTop);
        s.pointer = Math.hypot(dx, dy) < 700 ? { x: dx, y: dy } : null;
      } else s.pointer = null;
      s.update(dt * speedRef.current);
      paint(true);
      const options = soundRef.current;
      const p = options ? player.current : null;
      if (p) p.options = typeof options === 'object' ? options : {};
      if (s.cues.length)
        for (const cue of s.cues.splice(0)) {
          onCueRef.current?.(cue);
          p?.cue(cue, stateKey);
        }
      player.current?.setLoop(!!p && stateKey === 'sleeping');
    });
    /* the loop carries on across a re-subscribe; the next frame, or the still branch, settles it */
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [still, size, stateKey, shapeKey, color, trimColor, screenColor, floorShadow, antenna]);

  const click = (e: MouseEvent<HTMLSpanElement>) => {
    if (interactive && !still) sim.current?.poke();
    onClick?.(e);
  };

  return (
    <span
      ref={boxRef}
      role="img"
      aria-label={ariaLabel ?? `Robot, ${labels[stateKey]}`}
      className={className}
      onClick={click}
      style={{ position: 'relative', display: 'block', flex: 'none', width: size, height: size, cursor: interactive ? 'pointer' : undefined, ...style }}
      {...rest}
    >
      <canvas
        ref={canvasRef}
        aria-hidden
        style={{
          position: 'absolute',
          left: -frame.padSide,
          top: -frame.padTop,
          width: frame.box + 2 * frame.padSide,
          height: frame.box + frame.padTop + frame.padBottom,
          display: 'block',
          pointerEvents: 'none',
        }}
      />
    </span>
  );
});

