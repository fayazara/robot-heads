/* Drawing the TV head on a 2D canvas. The shell's sides and rolled
   edges are lit per quad; the flat front and back are plates drawn in
   their own plane (an affine map is exact under an orthographic view),
   each carrying a baked relief — the lip into the screen hole, the
   rubber gasket, the shadow the lip casts on the glass, the screws, the
   vents on the back. The glass sits a little behind the face, so it
   slides against the bezel as the head turns. The LEDs are drawn crisp,
   then bloomed from a one-pixel-per-LED image scaled up smooth. */

import { COLS, FACES, LIGHTS, ROWS, makeGrid, type Grid } from './faces';
import { HEAD, INSET, headMeshes, rotate, rotation, type HeadMeshes, type Mesh, type Shape, type V3 } from './geometry';
import { KEY, css, radiance, shadeCss, type Material } from './light';
import type { RobotPose, RobotSim } from './sim';
import type { RobotHeadState } from '../types';

export interface Palette {
  shell: Material;
  trim: Material;
  led: [number, number, number];
}

export interface RenderOptions {
  floorShadow: boolean;
  antenna: boolean;
}

type RGB = [number, number, number];

const makeCanvas = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
};

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/* a stable hash for the grain, so a rebake does not shimmer */
const hash = (x: number, y: number) => {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

const HALF: V3 = (() => {
  const l = Math.hypot(KEY[0], KEY[1], KEY[2] + 1);
  return [KEY[0] / l, KEY[1] / l, (KEY[2] + 1) / l];
})();

/* the head's reach, in head units: the antenna up to the top of its bulb,
   the knob alone, the ears past the sides; then the room motion needs past
   that: the bulb's glow, the highest hop (a click), the body rising past it
   as it stretches and leans in (with an antenna, its own room covers that),
   the floor's shadow, a turn or a lean past the ears */
const HEAD_TRAVEL = { antenna: 0.028 + HEAD.stem + HEAD.ball * 1.8, knob: 0.035, ear: 0.105, glow: 0.18, hop: 0.3, overshoot: 0.13, shadow: 0.22, side: 0.12 };
/* the resting robot fills its box but for this inset, as a share of the box */
const BOX_INSET = 0.05;

/**
 * Where a head sits, in CSS px. The element is a `box` × `box` square
 * holding the robot at rest, centred and filling it; the canvas reaches
 * past it by `pad*` on each side, room for hops, the glow and the floor's
 * shadow that takes no part in layout. `cx`, `cy` place the centre of the
 * resting head in the canvas; `unit` is one head unit.
 */
export interface Frame {
  box: number;
  padTop: number;
  padBottom: number;
  padSide: number;
  unit: number;
  cx: number;
  cy: number;
}

export function frameFor(shape: Shape, antenna: boolean, box: number): Frame {
  const top = antenna ? HEAD_TRAVEL.antenna : HEAD_TRAVEL.knob;
  const tall = 2 * shape.hy + top;
  const wide = 2 * (shape.earX + HEAD_TRAVEL.ear);
  const inner = box * (1 - 2 * BOX_INSET);
  const unit = Math.min(inner / tall, inner / wide);
  /* the resting robot, centred in the box */
  const above = (box - tall * unit) / 2;
  const centreY = above + (shape.hy + top) * unit;
  const reachUp = (antenna ? HEAD_TRAVEL.glow + HEAD_TRAVEL.hop : HEAD_TRAVEL.hop + HEAD_TRAVEL.overshoot) * unit;
  const reachDown = centreY + (shape.hy + HEAD_TRAVEL.shadow) * unit;
  const reachSide = box / 2 + (shape.earX + HEAD_TRAVEL.ear + HEAD_TRAVEL.side) * unit;
  /* whole px, and a pixel spare, so nothing ever touches the canvas edge */
  const padTop = Math.ceil(Math.max(0, reachUp - above) + 1);
  const padBottom = Math.ceil(Math.max(0, reachDown - box) + 1);
  const padSide = Math.ceil(Math.max(0, reachSide - box) + 1);
  return { box, padTop, padBottom, padSide, unit, cx: padSide + box / 2, cy: padTop + centreY };
}

/* how far the screen image reaches past the glass, so the recess never shows a gap */
const SCREEN_OVER = 0.035;

/* the glass's half extents, and the screen image's: the glass or the LED grid, whichever is bigger */
const glassOf = (s: Shape) => ({ hx: s.hx - INSET.glass, hy: s.hy - INSET.glass });
function screenOf(s: Shape) {
  const g = glassOf(s);
  return {
    hx: Math.max(g.hx, (COLS / 2) * s.pitch) + SCREEN_OVER,
    hy: Math.max(g.hy, (ROWS / 2) * s.pitch) + SCREEN_OVER,
  };
}
const plateOf = (s: Shape) => ({ hx: s.hx - INSET.plate, hy: s.hy - INSET.plate });

/**
 * A relief as light: positive brightens toward white, negative darkens
 * toward black, laid over a plate as white or black with that alpha.
 */
function bakeRelief(shape: Shape, unit: number, fn: (u: number, v: number, px: number, ix: number, iy: number) => number): HTMLCanvasElement {
  const PLATE = plateOf(shape);
  const w = Math.ceil(PLATE.hx * 2 * unit), h = Math.ceil(PLATE.hy * 2 * unit);
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(c.width, c.height);
  const d = img.data;
  const px = (PLATE.hx * 2) / c.width;
  for (let iy = 0; iy < c.height; iy++) {
    const v = -PLATE.hy + (iy + 0.5) * px;
    for (let ix = 0; ix < c.width; ix++) {
      const u = -PLATE.hx + (ix + 0.5) * px;
      const edge = shape.sd(u, v, INSET.plate);
      const cover = Math.min(1, Math.max(0, 0.5 - edge / px));
      if (cover <= 0) continue;
      const val = fn(u, v, px, ix, iy);
      const i = (iy * c.width + ix) * 4;
      const a = Math.min(1, Math.abs(val)) * cover;
      const white = val > 0 ? 255 : 0;
      d[i] = d[i + 1] = d[i + 2] = white;
      d[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/* lighting of a tilted bit of surface, relative to the flat plate */
function tilt(nx: number, ny: number, nz: number, gloss = 0.55, power = 36): number {
  const l = Math.hypot(nx, ny, nz);
  nx /= l; ny /= l; nz /= l;
  const diff = (nx * KEY[0] + ny * KEY[1] + nz * KEY[2] - KEY[2]) * 0.95;
  const spec = gloss * Math.pow(Math.max(0, nx * HALF[0] + ny * HALF[1] + nz * HALF[2]), power);
  return diff + spec - gloss * Math.pow(HALF[2], power);
}

/* gradient of a signed distance, by central differences */
function grad(fn: (u: number, v: number) => number, u: number, v: number): [number, number] {
  const e = 0.0015;
  const gx = fn(u + e, v) - fn(u - e, v);
  const gy = fn(u, v + e) - fn(u, v - e);
  const l = Math.hypot(gx, gy) || 1;
  return [gx / l, gy / l];
}

function screw(u: number, v: number, cx: number, cy: number, angle: number): number | null {
  const rs = 0.013;
  const dx = u - cx, dy = v - cy;
  const d = Math.hypot(dx, dy);
  if (d > rs + 0.006) return null;
  if (d > rs) return -0.5 * (1 - (d - rs) / 0.006);
  const nz = Math.sqrt(Math.max(0, 1 - (d / rs) ** 2)) + 0.6;
  let val = tilt(dx / rs, dy / rs, nz, 0.9, 30) * 1.3 + 0.08;
  /* the slot */
  const c = Math.cos(angle), s = Math.sin(angle);
  const across = Math.abs(dx * -s + dy * c);
  if (across < 0.0026 && d < rs * 0.8) val = -0.65;
  return val;
}

function bakeFront(shape: Shape, unit: number) {
  const LIP = 0.018;
  const sdHole = (u: number, v: number) => shape.sd(u, v, INSET.hole);
  const sdGlass = (u: number, v: number) => shape.sd(u, v, INSET.glass);
  const screws = shape.screws;
  return bakeRelief(shape, unit, (u, v, _px, ix, iy) => {
    const grain = (hash(ix, iy) - 0.5) * 0.07;
    for (const [cx, cy, a] of screws) {
      const s = screw(u, v, cx, cy, a);
      if (s !== null) return s;
    }
    const dh = sdHole(u, v);
    if (dh >= 0) {
      /* the shell rolls down into the hole */
      if (dh < LIP) {
        const [gx, gy] = grad(sdHole, u, v);
        const s = 1 - dh / LIP;
        const th = s * s * 1.25;
        return tilt(-gx * Math.sin(th), -gy * Math.sin(th), Math.cos(th)) + grain;
      }
      return grain;
    }
    const dg = sdGlass(u, v);
    if (dg >= 0) {
      /* the rubber gasket, a soft bead */
      const s = dg / HEAD.gasket;
      const [gx, gy] = grad(sdGlass, u, v);
      const th = (s - 0.45) * 2.2;
      return tilt(gx * Math.sin(th), gy * Math.sin(th), Math.cos(th), 0.22, 14) * 0.7 + grain * 0.4;
    }
    /* on the glass: the lip's cast shadow, darker toward the edge */
    const k = 0.05;
    const blocked = smooth(-0.012, 0.012, sdGlass(u - KEY[0] * k, v - KEY[1] * k));
    return -(0.5 * blocked + 0.32 * Math.exp(dg / 0.014));
  });
}

function bakeBack(shape: Shape, unit: number) {
  const vents = [-0.12, -0.065, -0.01, 0.045, 0.1];
  const panel = (u: number, v: number) => shape.sd(u, v, INSET.plate + 0.04);
  const screws = shape.backScrews;
  return bakeRelief(shape, unit, (u, v, _px, ix, iy) => {
    const grain = (hash(ix, iy) - 0.5) * 0.07;
    for (const [cx, cy, a] of screws) {
      const s = screw(u, v, cx, cy, a);
      if (s !== null) return s;
    }
    /* a panel line */
    const dp = panel(u, v);
    if (Math.abs(dp) < 0.006) {
      const [gx, gy] = grad(panel, u, v);
      const th = (dp / 0.006) * 1.1;
      return tilt(-gx * Math.sin(th), -gy * Math.sin(th), Math.cos(th)) * 0.9 - 0.18;
    }
    for (const vy of vents) {
      const slot = (a: number, b: number) => Math.hypot(Math.max(0, Math.abs(a) - 0.196), b - vy) - 0.014;
      const d = slot(u, v);
      if (d < 0) {
        /* down in the slot: dark, the top lip's shadow over it */
        return -0.72 - 0.15 * smooth(-0.014, 0, -(v - vy));
      }
      if (d < 0.01) {
        const [gx, gy] = grad(slot, u, v);
        const th = (1 - d / 0.01) ** 2 * 1.2;
        return tilt(-gx * Math.sin(th), -gy * Math.sin(th), Math.cos(th)) + grain;
      }
    }
    return grain;
  });
}

/* the screen's background and the dark LEDs, which never change */
function bakeScreenBase(w: number, h: number, pitch: number, x0: number, y0: number, led: RGB) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(w * 0.5, h * 0.45, 0, w * 0.5, h * 0.5, Math.max(w, h) * 0.65);
  g.addColorStop(0, '#111417');
  g.addColorStop(1, '#050607');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  /* each LED a dark lens in a black grid */
  const cell = pitch * 0.8;
  const off = (pitch - cell) / 2;
  const lens = `rgba(${Math.round(60 + led[0] * 0.12)},${Math.round(64 + led[1] * 0.12)},${Math.round(70 + led[2] * 0.12)},0.34)`;
  /* the dark lenses fill the whole glass, past the cells the faces use */
  const c0 = -Math.ceil(x0 / pitch), c1 = Math.ceil((w - x0) / pitch);
  const r0 = -Math.ceil(y0 / pitch), r1 = Math.ceil((h - y0) / pitch);
  ctx.fillStyle = lens;
  for (let r = r0; r < r1; r++) for (let q = c0; q < c1; q++) ctx.fillRect(x0 + q * pitch + off, y0 + r * pitch + off, cell, cell);
  /* a faint highlight on the top edge of each lens */
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  for (let r = r0; r < r1; r++) for (let q = c0; q < c1; q++) ctx.fillRect(x0 + q * pitch + off, y0 + r * pitch + off, cell, Math.max(1, cell * 0.16));
  return c;
}

/* the glass over the LEDs: vignette, a curved reflection, a cool sheen */
function bakeGlass(w: number, h: number) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d')!;
  const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.hypot(w, h) * 0.55);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
  const top = ctx.createLinearGradient(0, 0, 0, h);
  top.addColorStop(0, 'rgba(190,210,255,0.09)');
  top.addColorStop(0.42, 'rgba(190,210,255,0.015)');
  top.addColorStop(0.43, 'rgba(190,210,255,0)');
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.translate(w * 0.3, h * 0.2);
  ctx.scale(1, 0.45);
  const spot = ctx.createRadialGradient(0, 0, 0, 0, 0, w * 0.35);
  spot.addColorStop(0, 'rgba(255,255,255,0.07)');
  spot.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = spot;
  ctx.fillRect(-w, -h * 3, w * 2, h * 6);
  ctx.restore();
  return c;
}

function grainPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  const c = makeCanvas(128, 128);
  const g = c.getContext('2d')!;
  const img = g.createImageData(128, 128);
  for (let i = 0; i < 128 * 128; i++) {
    const r = hash(i, 7);
    const on = r > 0.5 ? 255 : 0;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = on;
    img.data[i * 4 + 3] = Math.round(hash(i, 13) * 9);
  }
  g.putImageData(img, 0, 0);
  return ctx.createPattern(c, 'repeat');
}

/* bakes depend only on the shape and the size, so every head on the page shares them */
const bakes = new Map<string, { front: HTMLCanvasElement; back: HTMLCanvasElement; glass: HTMLCanvasElement }>();
function bakesFor(shape: Shape, unit: number) {
  const key = `${shape.name}:${Math.round(unit)}`;
  let b = bakes.get(key);
  if (!b) {
    const sc = screenOf(shape);
    b = { front: bakeFront(shape, unit), back: bakeBack(shape, unit), glass: bakeGlass(sc.hx * 2 * unit, sc.hy * 2 * unit) };
    bakes.set(key, b);
  }
  return b;
}

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export class RobotRenderer {
  private shape: Shape | null = null;
  private meshes: HeadMeshes | null = null;
  private unit = 0;
  private ledKey = '';
  private front: HTMLCanvasElement | null = null;
  private back: HTMLCanvasElement | null = null;
  private screen: HTMLCanvasElement | null = null;
  private screenBase: HTMLCanvasElement | null = null;
  private glass: HTMLCanvasElement | null = null;
  private layer: HTMLCanvasElement | null = null;
  private tiny = makeCanvas(COLS, ROWS);
  private tinyHalf = makeCanvas(COLS / 2, ROWS / 2);
  private tinyImg: ImageData | null = null;
  private grain: CanvasPattern | null = null;
  private grid: Grid = makeGrid(COLS, ROWS);
  private gridPrev: Grid = makeGrid(COLS, ROWS);
  private proj = new Float32Array(2048 * 3);
  private screenGeo = { pitch: 0, x0: 0, y0: 0 };

  private prepare(shape: Shape, unit: number, led: RGB) {
    if (Math.abs(unit - this.unit) > 0.5 || shape !== this.shape) {
      this.unit = unit;
      this.shape = shape;
      this.meshes = headMeshes(shape);
      const b = bakesFor(shape, unit);
      this.front = b.front;
      this.back = b.back;
      this.glass = b.glass;
      const sc = screenOf(shape);
      this.screen = makeCanvas(sc.hx * 2 * unit, sc.hy * 2 * unit);
      this.ledKey = '';
      /* the matrix covers the whole glass, the face area centred in it */
      const gl = glassOf(shape);
      this.grid = makeGrid(Math.ceil((gl.hx * 2) / shape.pitch), Math.ceil((gl.hy * 2) / shape.pitch));
      this.gridPrev = makeGrid(this.grid.cols, this.grid.rows);
      this.tiny = makeCanvas(this.grid.cols, this.grid.rows);
      this.tinyHalf = makeCanvas(Math.ceil(this.grid.cols / 2), Math.ceil(this.grid.rows / 2));
      this.tinyImg = null;
      const pitch = shape.pitch * unit;
      this.screenGeo = {
        pitch,
        x0: (this.screen.width - pitch * this.grid.cols) / 2,
        y0: (this.screen.height - pitch * this.grid.rows) / 2,
      };
    }
    const key = led.join(',');
    if (key !== this.ledKey && this.screen) {
      this.ledKey = key;
      const { pitch, x0, y0 } = this.screenGeo;
      this.screenBase = bakeScreenBase(this.screen.width, this.screen.height, pitch, x0, y0, led);
    }
  }

  /* the LED matrix for this frame */
  private compose(sim: RobotSim | null, state: RobotHeadState): Grid {
    const grid = this.grid;
    const g = grid.v;
    const { cols, rows } = grid;
    g.fill(0);
    if (!sim) {
      FACES[state](grid, { lookX: 0, lookY: 0, blink: 0, time: 0.4, side: 1, seed: 0 });
      return grid;
    }
    FACES[sim.shown](grid, sim.face);
    /* a cross-fade from the last face, with a flicker of glitch */
    if (sim.switched < 0.3) {
      const p = this.gridPrev;
      p.v.fill(0);
      FACES[sim.previous](p, { ...sim.face, time: sim.face.time + 10 });
      const k = sim.switched / 0.3;
      for (let i = 0; i < g.length; i++) g[i] = g[i] * k + p.v[i] * (1 - k);
      if (sim.switched < 0.13) {
        const seed = Math.floor(sim.time * 30);
        for (let r = 0; r < rows; r++) {
          const shift = Math.floor((Math.sin(seed * 12.9 + r * 78.2) * 0.5 + 0.5) * 3) - 1;
          if (!shift) continue;
          const row = g.slice(r * cols, (r + 1) * cols);
          for (let c = 0; c < cols; c++) g[r * cols + c] = row[(c - shift + cols) % cols];
        }
        for (let i = 0; i < g.length; i++) if (Math.sin(i * 91.7 + seed * 3.1) > 0.93) g[i] = Math.max(g[i], 0.3);
      }
    }
    /* switching on: a bright line that opens to the full screen */
    if (sim.age < 0.55) {
      const open = smooth(0.08, 0.5, sim.age) * (rows / 2 + 0.5);
      for (let r = 0; r < rows; r++) {
        const d = Math.abs(r - (rows - 1) / 2);
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          if (d > open) g[i] = 0;
          else if (d > open - 1.2) g[i] = Math.max(g[i], 0.85 * (1 - sim.age / 0.55));
        }
      }
    }
    return grid;
  }

  private drawScreen(grid: Grid, led: RGB) {
    const s = this.screen!;
    const ctx = s.getContext('2d')!;
    const { cols, rows, v: g } = grid;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(this.screenBase!, 0, 0);
    const { pitch, x0, y0 } = this.screenGeo;
    const core = mix(led, [255, 255, 255], 0.6);
    const coreCss = `rgb(${core.map(Math.round).join(',')})`;
    const bleedCss = `rgb(${led.map(Math.round).join(',')})`;
    const cell = pitch * 0.8, off = (pitch - cell) / 2;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = g[r * cols + c];
        if (v < 0.01) continue;
        ctx.globalAlpha = Math.min(1, v * 0.4);
        ctx.fillStyle = bleedCss;
        ctx.fillRect(x0 + c * pitch + off * 0.4, y0 + r * pitch + off * 0.4, pitch - off * 0.8, pitch - off * 0.8);
        ctx.globalAlpha = Math.min(1, v);
        ctx.fillStyle = coreCss;
        ctx.fillRect(x0 + c * pitch + off, y0 + r * pitch + off, cell, cell);
      }
    }
    /* bloom: the matrix at one pixel per LED, scaled up smooth */
    const t = this.tiny.getContext('2d')!;
    if (!this.tinyImg) this.tinyImg = t.createImageData(cols, rows);
    const d = this.tinyImg.data;
    for (let i = 0; i < cols * rows; i++) {
      d[i * 4] = led[0];
      d[i * 4 + 1] = led[1];
      d[i * 4 + 2] = led[2];
      d[i * 4 + 3] = Math.round(Math.min(1, g[i]) * 255);
    }
    t.putImageData(this.tinyImg, 0, 0);
    const h = this.tinyHalf.getContext('2d')!;
    h.clearRect(0, 0, this.tinyHalf.width, this.tinyHalf.height);
    h.imageSmoothingEnabled = true;
    h.drawImage(this.tiny, 0, 0, this.tinyHalf.width, this.tinyHalf.height);
    ctx.imageSmoothingEnabled = true;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.7;
    ctx.drawImage(this.tiny, x0, y0, cols * pitch, rows * pitch);
    ctx.globalAlpha = 0.65;
    ctx.drawImage(this.tinyHalf, x0 - pitch, y0 - pitch, (cols + 2) * pitch, (rows + 2) * pitch);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(this.glass!, 0, 0);
  }

  /** Draw a frame; `frame` is in CSS px, the canvas in device px (`dpr` per CSS px). */
  draw(ctx: CanvasRenderingContext2D, frame: Frame, dpr: number, pose: RobotPose, sim: RobotSim | null, state: RobotHeadState, shape: Shape, palette: Palette, opts: RenderOptions) {
    const U = frame.unit * dpr;
    const PLATE = plateOf(shape);
    const GLASS = glassOf(shape);
    const SCREEN = screenOf(shape);
    const shown = sim ? sim.shown : state;
    const lightNow = LIGHTS[shown];
    let led: RGB = lightNow.screen ?? palette.led;
    if (sim && sim.switched < 0.3) {
      const was = LIGHTS[sim.previous].screen ?? palette.led;
      led = mix(was, led, sim.switched / 0.3).map(Math.round) as RGB;
    }
    this.prepare(shape, U, led);
    if (!this.layer || this.layer.width !== ctx.canvas.width || this.layer.height !== ctx.canvas.height) {
      this.layer = makeCanvas(ctx.canvas.width, ctx.canvas.height);
      this.grain = grainPattern(ctx);
    }
    const layer = this.layer.getContext('2d')!;

    const R = rotation(pose.yaw, pose.pitch, pose.roll);
    const cx = frame.cx * dpr + pose.x * U;
    /* the head's centre at rest */
    const rest = frame.cy * dpr;
    const cy = rest - pose.lift * U;
    const by = cy + shape.hy * U;
    const P = (x: number, y: number, z: number): V3 => {
      const r = rotate(R, x, y, z);
      return [cx + r[0] * U * pose.sx, by + (cy + r[1] * U - by) * pose.sy, r[2]];
    };
    const plane = (c: CanvasRenderingContext2D, z: number, flip: boolean) => {
      const o = P(0, 0, z), ex = P(flip ? -1 : 1, 0, z), ey = P(0, 1, z);
      c.setTransform(ex[0] - o[0], ex[1] - o[1], ey[0] - o[0], ey[1] - o[1], o[0], o[1]);
    };

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    /* the floor's shadow, smaller and fainter the higher the head is */
    if (opts.floorShadow) {
      const up = Math.max(0, pose.lift);
      const fy = rest + (shape.hy + 0.11) * U;
      const rx = U * shape.hx * (1 - up * 0.9) * pose.sx;
      ctx.save();
      ctx.translate(frame.cx * dpr + pose.x * U, fy);
      ctx.scale(1, 0.16);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
      const a = 0.55 * Math.max(0, 1 - up * 1.6);
      g.addColorStop(0, `rgba(0,0,0,${a})`);
      g.addColorStop(0.55, `rgba(0,0,0,${a * 0.45})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, rx, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    const { body, earL, earR, collar } = this.meshes!;
    const earLz = rotate(R, -shape.earX - 0.05, HEAD.earY, 0)[2];
    const earRz = rotate(R, shape.earX + 0.05, HEAD.earY, 0)[2];
    const topZ = rotate(R, 0, -shape.hy, 0)[2];
    const antennaBehind = topZ < -0.012;

    const drawMesh = (c: CanvasRenderingContext2D, mesh: Mesh, mat: Material) => {
      const n = mesh.pos.length / 3;
      const pr = this.proj;
      for (let i = 0; i < n; i++) {
        const p = P(mesh.pos[i * 3], mesh.pos[i * 3 + 1], mesh.pos[i * 3 + 2]);
        pr[i * 3] = p[0]; pr[i * 3 + 1] = p[1]; pr[i * 3 + 2] = p[2];
      }
      const order: Array<[number, number]> = [];
      const q = mesh.quads, nn = mesh.normals;
      for (let k = 0; k < q.length / 4; k++) {
        const nz = R[6] * nn[k * 3] + R[7] * nn[k * 3 + 1] + R[8] * nn[k * 3 + 2];
        if (nz < -0.03) continue;
        const z = pr[q[k * 4] * 3 + 2] + pr[q[k * 4 + 1] * 3 + 2] + pr[q[k * 4 + 2] * 3 + 2] + pr[q[k * 4 + 3] * 3 + 2];
        order.push([z, k]);
      }
      order.sort((a, b) => a[0] - b[0]);
      c.lineWidth = Math.max(0.6, U / 260);
      c.lineJoin = 'round';
      for (const [, k] of order) {
        const nx = nn[k * 3], ny = nn[k * 3 + 1], nz0 = nn[k * 3 + 2];
        const w = rotate(R, nx, ny, nz0);
        const col = shadeCss(mat, w[0], w[1], w[2]);
        c.beginPath();
        for (let j = 0; j < 4; j++) {
          const vi = q[k * 4 + j] * 3;
          if (j) c.lineTo(pr[vi], pr[vi + 1]);
          else c.moveTo(pr[vi], pr[vi + 1]);
        }
        c.closePath();
        c.fillStyle = col;
        c.strokeStyle = col;
        c.fill();
        c.stroke();
      }
    };

    /* the knob on top always; the stem and its bulb only with the antenna on */
    const antenna = () => this.drawAntenna(ctx, P, U, pose, palette, sim, shown, lightNow, collar, opts.antenna);

    if (antennaBehind) antenna();
    if (earLz < 0) drawMesh(ctx, earL, palette.trim);
    if (earRz < 0) drawMesh(ctx, earR, palette.trim);

    /* the shell, on its own layer so the grain stays on it */
    layer.setTransform(1, 0, 0, 1, 0, 0);
    layer.globalCompositeOperation = 'source-over';
    layer.clearRect(0, 0, this.layer.width, this.layer.height);
    drawMesh(layer, body, palette.shell);
    const frontZ = R[8];
    const zf = shape.depth / 2;
    const facing = Math.abs(frontZ) > 0.005 ? (frontZ > 0 ? 1 : -1) : 0;
    if (facing) {
      const dome = 0.17;
      plane(layer, facing * zf, facing < 0);
      const at = (dx: number, dy: number) => {
        const w = rotate(R, dx * (facing < 0 ? -1 : 1), dy, facing);
        const l = Math.hypot(w[0], w[1], w[2]);
        return css(radiance(palette.shell, w[0] / l, w[1] / l, w[2] / l));
      };
      layer.beginPath();
      shape.path(layer, INSET.plate - 0.002);
      const vg = layer.createLinearGradient(0, -PLATE.hy, 0, PLATE.hy);
      vg.addColorStop(0, at(0, -dome));
      vg.addColorStop(0.5, at(0, 0));
      vg.addColorStop(1, at(0, dome));
      layer.fillStyle = vg;
      layer.fill();
      const hg = layer.createLinearGradient(-PLATE.hx, 0, PLATE.hx, 0);
      hg.addColorStop(0, at(-dome, 0));
      hg.addColorStop(0.5, at(0, 0));
      hg.addColorStop(1, at(dome, 0));
      layer.globalAlpha = 0.5;
      layer.fillStyle = hg;
      layer.fill();
      layer.globalAlpha = 1;
    }
    if (this.grain) {
      layer.setTransform(1, 0, 0, 1, 0, 0);
      layer.globalCompositeOperation = 'source-atop';
      const m = typeof DOMMatrix === 'function' ? new DOMMatrix().translate(cx, cy) : null;
      if (m && 'setTransform' in this.grain) this.grain.setTransform(m);
      layer.fillStyle = this.grain;
      layer.fillRect(0, 0, this.layer.width, this.layer.height);
      layer.globalCompositeOperation = 'source-over';
    }
    ctx.drawImage(this.layer, 0, 0);

    /* the plate's details: the screen in front, the vents behind */
    if (facing > 0) {
      ctx.save();
      plane(ctx, zf, false);
      ctx.beginPath();
      shape.path(ctx, INSET.hole);
      ctx.fillStyle = '#060709';
      ctx.fill();
      ctx.save();
      ctx.beginPath();
      shape.path(ctx, INSET.glass);
      ctx.clip();
      this.drawScreen(this.compose(sim, state), led);
      plane(ctx, zf - HEAD.recess, false);
      ctx.drawImage(this.screen!, -SCREEN.hx, -SCREEN.hy, SCREEN.hx * 2, SCREEN.hy * 2);
      /* a reflection sliding over the glass as the head turns */
      plane(ctx, zf, false);
      const s = -0.05 - pose.yaw * 0.9 + pose.pitch * 0.5;
      const sg = ctx.createLinearGradient(-0.55 + s, -0.35, 0.15 + s, 0.35);
      sg.addColorStop(0, 'rgba(255,255,255,0)');
      sg.addColorStop(0.36, 'rgba(255,255,255,0)');
      sg.addColorStop(0.43, 'rgba(220,232,255,0.075)');
      sg.addColorStop(0.5, 'rgba(255,255,255,0)');
      sg.addColorStop(0.58, 'rgba(255,255,255,0)');
      sg.addColorStop(0.61, 'rgba(220,232,255,0.04)');
      sg.addColorStop(0.65, 'rgba(255,255,255,0)');
      ctx.fillStyle = sg;
      ctx.fillRect(-GLASS.hx, -GLASS.hy, GLASS.hx * 2, GLASS.hy * 2);
      ctx.restore();
      ctx.drawImage(this.front!, -PLATE.hx, -PLATE.hy, PLATE.hx * 2, PLATE.hy * 2);
      ctx.restore();
    } else if (facing < 0) {
      ctx.save();
      plane(ctx, -zf, true);
      ctx.drawImage(this.back!, -PLATE.hx, -PLATE.hy, PLATE.hx * 2, PLATE.hy * 2);
      ctx.restore();
    }

    if (earLz >= 0) drawMesh(ctx, earL, palette.trim);
    if (earRz >= 0) drawMesh(ctx, earR, palette.trim);
    if (!antennaBehind) antenna();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  private drawAntenna(
    ctx: CanvasRenderingContext2D,
    P: (x: number, y: number, z: number) => V3,
    U: number,
    pose: RobotPose,
    palette: Palette,
    sim: RobotSim | null,
    shown: RobotHeadState,
    lightNow: (typeof LIGHTS)[RobotHeadState],
    collar: Mesh,
    stem: boolean,
  ) {
    /* the collar, lit like the ears */
    const R = rotation(pose.yaw, pose.pitch, pose.roll);
    const pr = this.proj;
    const n = collar.pos.length / 3;
    for (let i = 0; i < n; i++) {
      const p = P(collar.pos[i * 3], collar.pos[i * 3 + 1], collar.pos[i * 3 + 2]);
      pr[i * 3] = p[0]; pr[i * 3 + 1] = p[1]; pr[i * 3 + 2] = p[2];
    }
    const q = collar.quads, nn = collar.normals;
    ctx.lineWidth = Math.max(0.6, U / 260);
    for (let k = 0; k < q.length / 4; k++) {
      const w = rotate(R, nn[k * 3], nn[k * 3 + 1], nn[k * 3 + 2]);
      if (w[2] < -0.03) continue;
      const col = shadeCss(palette.trim, w[0], w[1], w[2]);
      ctx.beginPath();
      for (let j = 0; j < 4; j++) {
        const vi = q[k * 4 + j] * 3;
        if (j) ctx.lineTo(pr[vi], pr[vi + 1]);
        else ctx.moveTo(pr[vi], pr[vi + 1]);
      }
      ctx.closePath();
      ctx.fillStyle = col;
      ctx.strokeStyle = col;
      ctx.fill();
      ctx.stroke();
    }
    if (!stem) return;

    /* the stem bends toward its tip; the ball rides on the end */
    const top = -this.shape!.hy - 0.028;
    const L = HEAD.stem;
    const ax = pose.antennaX, az = pose.antennaZ;
    const dir: V3 = [Math.sin(ax), -Math.cos(ax) * Math.cos(az), Math.sin(az)];
    const base = P(0, top, 0);
    const ctrl = P(0, top - L * 0.55, 0);
    const tip = P(dir[0] * L, top + dir[1] * L, dir[2] * L);
    const ballC = P(dir[0] * (L + HEAD.ball * 0.8), top + dir[1] * (L + HEAD.ball * 0.8), dir[2] * (L + HEAD.ball * 0.8));
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(base[0], base[1]);
    ctx.quadraticCurveTo(ctrl[0], ctrl[1], tip[0], tip[1]);
    ctx.lineWidth = U * 0.02;
    ctx.strokeStyle = '#4a5260';
    ctx.stroke();
    ctx.lineWidth = U * 0.009;
    ctx.strokeStyle = '#9aa3b1';
    ctx.stroke();
    ctx.save();
    ctx.translate(-U * 0.004, 0);
    ctx.lineWidth = U * 0.004;
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.stroke();
    ctx.restore();

    /* the bulb: frosted glass, lit from inside by the state's light */
    let colour: RGB = lightNow.ball;
    let level = lightNow.pulse(sim ? sim.face.time : 0.3, sim ? sim.face.seed : 0);
    if (sim && sim.switched < 0.3) {
      const was = LIGHTS[sim.previous];
      const k = sim.switched / 0.3;
      colour = mix(was.ball, colour, k);
      level = was.pulse(sim.face.time + 10, sim.face.seed) * (1 - k) + level * k;
    }
    if (sim && sim.age < 0.55) level *= smooth(0.1, 0.5, sim.age);
    void shown;
    const r = HEAD.ball * U * pose.sx;
    const [bx, by] = ballC;
    const frost: RGB = [168, 174, 186];
    const lit = mix(frost, mix(colour, [255, 255, 255], 0.35), level);
    /* the glass thickens toward its edge and tints with the light inside,
       so even a white bulb has a rim that reads on a pale page */
    const glassTint = mix([150, 158, 172], colour, 0.5);
    const shoulder = mix(lit, glassTint, 0.48);
    const edge = mix([70, 76, 88], mix(colour, [90, 96, 108], 0.5), level * 0.55);
    /* the hot core sits a little up and in, the filament the light comes from */
    const g = ctx.createRadialGradient(bx - r * 0.18, by - r * 0.22, r * 0.05, bx, by, r);
    g.addColorStop(0, `rgb(${mix(lit, [255, 255, 255], 0.6 + level * 0.3).map(Math.round).join(',')})`);
    g.addColorStop(0.38, `rgb(${lit.map(Math.round).join(',')})`);
    g.addColorStop(0.78, `rgb(${shoulder.map(Math.round).join(',')})`);
    g.addColorStop(1, `rgb(${edge.map(Math.round).join(',')})`);
    /* its glow, behind the bulb so it lights the air and never washes out the glass */
    if (level > 0.01) {
      ctx.globalCompositeOperation = 'lighter';
      const glow = ctx.createRadialGradient(bx, by, r * 0.6, bx, by, r * 4.2);
      const c = colour.map(Math.round).join(',');
      glow.addColorStop(0, `rgba(${c},${0.5 * level})`);
      glow.addColorStop(0.35, `rgba(${c},${0.14 * level})`);
      glow.addColorStop(1, `rgba(${c},0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(bx, by, r * 4.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    /* where the bulb sits on the stem, a little contact shade */
    const seat = ctx.createRadialGradient(bx, by + r * 0.9, 0, bx, by + r * 0.9, r * 0.7);
    seat.addColorStop(0, 'rgba(20,24,32,0.28)');
    seat.addColorStop(1, 'rgba(20,24,32,0)');
    ctx.fillStyle = seat;
    ctx.beginPath();
    ctx.arc(bx, by + r * 0.9, r * 0.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    /* a hairline at the silhouette: the glass's own edge, invisible on dark, a crisp outline on light */
    ctx.lineWidth = Math.max(0.75, r * 0.07);
    ctx.strokeStyle = 'rgba(28,32,42,0.28)';
    ctx.stroke();
    /* the window's reflection */
    const sp = ctx.createRadialGradient(bx - r * 0.38, by - r * 0.42, 0, bx - r * 0.38, by - r * 0.42, r * 0.38);
    sp.addColorStop(0, 'rgba(255,255,255,0.95)');
    sp.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sp;
    ctx.fill();
  }
}
