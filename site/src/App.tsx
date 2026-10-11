import { useEffect, useState } from 'react';
import { play, setEnabled } from 'cuelume';
import { RobotHead, robotHeadShapes, robotHeadStates, type RobotHeadShape, type RobotHeadState } from 'robot-heads';

/* ?shape=circle&state=thinking&paused for screenshots */
const q = new URLSearchParams(location.search);

const shapeLabels: Record<RobotHeadShape, string> = {
  rectangle: 'Rectangle',
  square: 'Square',
  circle: 'Circle',
  hexagon: 'Hexagon',
};

const stateHints: Record<RobotHeadState, string> = {
  idle: 'Looks around, blinks, hops now and then.',
  thinking: 'Eyes up, dots pulsing, head tilted to one side.',
  searching: 'Sweeps side to side, a beam scanning the screen.',
  listening: 'Head cocked, an equaliser following the voice.',
  speaking: 'A mouth that moves with the words.',
  working: 'Head down, a progress bar filling.',
  happy: 'Bouncing, all smiles.',
  error: 'Shakes its head. Red X eyes.',
  sleeping: 'Drooped and dim, dreaming in z’s.',
};

interface Colors {
  color: string;
  trimColor: string;
  screenColor: string;
}

const DEFAULTS: Colors = { color: '#2b49a3', trimColor: '#93a6c8', screenColor: '#e8f2ff' };

const SWATCHES: Record<keyof Colors, Array<[string, string]>> = {
  color: [
    ['Cobalt', '#2b49a3'],
    ['Tomato', '#c8372d'],
    ['Tangerine', '#e2762a'],
    ['Mustard', '#e0ad1f'],
    ['Mint', '#2f8f58'],
    ['Teal', '#1f8189'],
    ['Grape', '#6a45b8'],
    ['Bubblegum', '#d9558f'],
    ['Graphite', '#3a3d44'],
    ['Porcelain', '#e6e6ea'],
  ],
  trimColor: [
    ['Steel', '#93a6c8'],
    ['Silver', '#c4c9d2'],
    ['Brass', '#c9a45c'],
    ['Copper', '#c27a52'],
    ['Black', '#2a2c31'],
  ],
  screenColor: [
    ['White', '#e8f2ff'],
    ['Ice', '#7fe7ff'],
    ['Matrix', '#7dff9a'],
    ['Amber', '#ffc46b'],
    ['Neon', '#ff8fd0'],
  ],
};

const ROW_LABELS: Record<keyof Colors, string> = { color: 'Shell', trimColor: 'Trim', screenColor: 'Screen' };
const SPEEDS = [0.5, 1, 1.5, 2];
/* the robot's sound: off, or on at a volume */
const VOLUMES = [0, 0.25, 0.5, 1];

const title = (s: string) => s[0].toUpperCase() + s.slice(1);

/* the stage head fills the room it is given, within reason */
function useStageSize() {
  const measure = () => {
    const w = window.innerWidth, h = window.innerHeight;
    /* the size is the resting robot itself; its hops reach past it */
    if (w < 900) return Math.max(160, Math.min(w - 96, 260));
    /* centred on the screen, so it keeps the controls' width clear on both sides */
    const room = Math.min(w - 2 * (300 + 40 + 40), h - 300);
    return Math.round(Math.max(170, Math.min(room * 0.62, 330)));
  };
  const [size, setSize] = useState(measure);
  useEffect(() => {
    const on = () => setSize(measure());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return size;
}

function Dock({ shape, onChange, colors, antenna }: { shape: RobotHeadShape; onChange: (s: RobotHeadShape) => void; colors: Colors; antenna: boolean }) {
  return (
    <nav className="dock" aria-label="Shape">
      {robotHeadShapes.map((s) => (
        <button key={s} className="dock-item" data-cuelume-select aria-pressed={s === shape} aria-label={shapeLabels[s]} onClick={() => onChange(s)}>
          <span className="dock-icon">
            <RobotHead shape={s} size={52} interactive={false} floorShadow={false} antenna={antenna} paused={q.has('paused')} aria-hidden {...colors} />
          </span>
          <span className="dock-tip">{shapeLabels[s]}</span>
        </button>
      ))}
    </nav>
  );
}

function Swatches({ name, value, onChange }: { name: keyof Colors; value: string; onChange: (v: string) => void }) {
  const known = SWATCHES[name].find(([, hex]) => hex === value);
  return (
    <div className="control">
      <div className="control-head">
        <span className="control-label">{ROW_LABELS[name]}</span>
        <span className="control-value">{known ? known[0] : value}</span>
      </div>
      <div className="swatches">
        {SWATCHES[name].map(([label, hex]) => (
          <button
            key={hex}
            className="swatch"
            data-cuelume-select
            style={{ background: hex }}
            title={label}
            aria-label={`${ROW_LABELS[name]}: ${label}`}
            aria-pressed={hex === value}
            onClick={() => onChange(hex)}
          />
        ))}
        <label className="swatch swatch-custom" title="Custom" aria-pressed={!known} style={known ? undefined : { background: value }}>
          <input type="color" data-cuelume-select value={value} aria-label={`${ROW_LABELS[name]}: custom colour`} onChange={(e) => onChange(e.target.value)} />
        </label>
      </div>
    </div>
  );
}

type Theme = 'dark' | 'light';

function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'));
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try {
      localStorage.setItem('robot-heads-theme', next);
    } catch {
      /* private mode: the choice lasts the visit */
    }
  };
  return [theme, toggle] as const;
}

function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const light = theme === 'light';
  return (
    <button className="theme" data-cuelume-toggle onClick={onToggle} aria-label={light ? 'Switch to dark mode' : 'Switch to light mode'} title={light ? 'Dark mode' : 'Light mode'}>
      {light ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
        </svg>
      )}
    </button>
  );
}

/* the controls' own clicks, off until turned on; cuelume doesn't
   remember the setting, so the playground does */
function useSound() {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem('robot-heads-sound') === 'on';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    setEnabled(on);
  }, [on]);
  const toggle = () => {
    setOn(!on);
    try {
      localStorage.setItem('robot-heads-sound', on ? 'off' : 'on');
    } catch {
      /* private mode: the choice lasts the visit */
    }
  };
  return [on, toggle] as const;
}

function SoundToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button className="theme" data-cuelume-toggle onClick={onToggle} aria-pressed={on} aria-label="Interface sounds" title={on ? 'Mute interface sounds' : 'Unmute interface sounds'}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M11 5 6 9H3v6h3l5 4V5Z" />
        {on ? <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /> : <path d="m16 9 6 6M22 9l-6 6" />}
      </svg>
    </button>
  );
}

interface PropLine {
  key: string;
  /* the prop's name and value; strings are quoted, anything else goes in braces */
  name: string;
  value: string | number | boolean;
  on: boolean;
  /* a string that is code, like an object, rather than text */
  expr?: boolean;
}

const quoted = (l: PropLine) => typeof l.value === 'string' && !l.expr;
const propText = (l: PropLine) => (quoted(l) ? `${l.name}="${l.value}"` : `${l.name}={${l.value}}`);

/* one prop, coloured like GitHub's own theme */
function PropTokens({ line }: { line: PropLine }) {
  return (
    <>
      <span className="tok-attr">{line.name}</span>
      <span className="tok-punct">=</span>
      {quoted(line) ? (
        <span className="tok-string">"{line.value}"</span>
      ) : (
        <>
          <span className="tok-punct">{'{'}</span>
          <span className="tok-number">{String(line.value)}</span>
          <span className="tok-punct">{'}'}</span>
        </>
      )}
    </>
  );
}

/* the snippet, one line per prop; a prop line opens and closes on its own,
   so the block grows a line at a time instead of jumping */
function Snippet({ lines }: { lines: PropLine[] }) {
  /* a closing line keeps its last value while it folds away: each open
     line's value is remembered as it renders (React's way of adjusting
     state from props, no effect needed) */
  const [last, setLast] = useState<Record<string, PropLine>>({});
  const stale = lines.filter((l) => l.on && last[l.key]?.value !== l.value);
  if (stale.length) setLast({ ...last, ...Object.fromEntries(stale.map((l) => [l.key, l])) });
  return (
    <pre className="code">
      <code>
        <span className="code-line">
          <span className="tok-punct">{'<'}</span>
          <span className="tok-tag">RobotHead</span>
        </span>
        {lines.map((l) => (
          <span key={l.key} className="code-prop" data-open={l.on}>
            <span className="code-prop-inner">
              {'  '}
              <PropTokens line={l.on ? l : last[l.key] ?? l} />
            </span>
          </span>
        ))}
        <span className="code-line tok-punct">{'/>'}</span>
      </code>
    </pre>
  );
}

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (key: string, text: string) =>
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(key);
      play('success');
      setTimeout(() => setCopied(null), 1400);
    }, () => {});
  return [copied, copy] as const;
}

export default function App() {
  const [state, setState] = useState<RobotHeadState>((q.get('state') as RobotHeadState) ?? 'idle');
  const [shape, setShapeState] = useState<RobotHeadShape>((q.get('shape') as RobotHeadShape) ?? 'rectangle');
  const [colors, setColors] = useState<Colors>(DEFAULTS);
  const [speed, setSpeed] = useState(1);
  const [antenna, setAntenna] = useState(!q.has('noantenna'));
  const [paused, setPaused] = useState(q.has('paused'));
  const [copied, copy] = useCopy();
  const [theme, toggleTheme] = useTheme();
  const [uiSound, toggleUiSound] = useSound();
  /* the robot's own sound: off, as the component's is, until asked for */
  const [volume, setVolume] = useState(0);
  const sound = volume > 0;
  const size = useStageSize();
  const setShape = (s: RobotHeadShape) => {
    setShapeState(s);
    const u = new URL(location.href);
    u.searchParams.set('shape', s);
    history.replaceState(null, '', u);
  };
  const changed = colors.color !== DEFAULTS.color || colors.trimColor !== DEFAULTS.trimColor || colors.screenColor !== DEFAULTS.screenColor || speed !== 1 || paused || !antenna || sound;
  const lines: PropLine[] = [
    { key: 'shape', name: 'shape', value: shape, on: true },
    { key: 'state', name: 'state', value: state, on: true },
    { key: 'color', name: 'color', value: colors.color, on: colors.color !== DEFAULTS.color },
    { key: 'trimColor', name: 'trimColor', value: colors.trimColor, on: colors.trimColor !== DEFAULTS.trimColor },
    { key: 'screenColor', name: 'screenColor', value: colors.screenColor, on: colors.screenColor !== DEFAULTS.screenColor },
    { key: 'speed', name: 'speed', value: speed, on: speed !== 1 },
    { key: 'antenna', name: 'antenna', value: antenna, on: !antenna },
    { key: 'sound', name: 'sound', value: volume === 1 ? true : `{ volume: ${volume} }`, expr: volume !== 1, on: sound },
  ];
  const snippet = `<RobotHead\n${lines.filter((l) => l.on).map((l) => `  ${propText(l)}\n`).join('')}/>`;

  return (
    <div className="app">
      <Dock shape={shape} onChange={setShape} colors={colors} antenna={antenna} />

      <header className="masthead">
        <div className="byline">
          <span className="name">robot-heads</span>
          <span className="by">by</span>
          <a className="author" href="https://x.com/fayazara" target="_blank" rel="noopener noreferrer">
            <img src="https://github.com/fayazara.png?size=64" alt="" width={24} height={24} />
            Fayaz Ahmed
          </a>
        </div>
        <div className="masthead-end">
          <button className="install" onClick={() => copy('install', 'npm i robot-heads')}>
            npm i robot-heads
            <span className="install-copy">{copied === 'install' ? 'Copied' : 'Copy'}</span>
          </button>
          <a className="icon-link" href="https://github.com/fayazara/robot-heads" target="_blank" rel="noopener noreferrer" aria-label="robot-heads on GitHub" title="GitHub">
            {/* Icon from Material Design Icons by Pictogrammers - https://github.com/Templarian/MaterialDesign/blob/master/LICENSE */}
            <svg viewBox="0 0 24 24" aria-hidden>
              <path fill="currentColor" d="M12 2A10 10 0 0 0 2 12c0 4.42 2.87 8.17 6.84 9.5c.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34c-.46-1.16-1.11-1.47-1.11-1.47c-.91-.62.07-.6.07-.6c1 .07 1.53 1.03 1.53 1.03c.87 1.52 2.34 1.07 2.91.83c.09-.65.35-1.09.63-1.34c-2.22-.25-4.55-1.11-4.55-4.92c0-1.11.38-2 1.03-2.71c-.1-.25-.45-1.29.1-2.64c0 0 .84-.27 2.75 1.02c.79-.22 1.65-.33 2.5-.33s1.71.11 2.5.33c1.91-1.29 2.75-1.02 2.75-1.02c.55 1.35.2 2.39.1 2.64c.65.71 1.03 1.6 1.03 2.71c0 3.82-2.34 4.66-4.57 4.91c.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0 0 12 2" />
            </svg>
          </a>
          <SoundToggle on={uiSound} onToggle={toggleUiSound} />
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
      </header>

      <main className="stage" aria-label="Preview">
        <RobotHead shape={shape} state={state} size={size} paused={paused} speed={speed} antenna={antenna} sound={sound && { volume }} {...colors} />
        <div className="caption">
          <h1 className="font-bold">{title(state)}</h1>
          <p>{stateHints[state]}</p>
        </div>
      </main>

      <aside className="controls" aria-label="Controls">
        {(Object.keys(SWATCHES) as Array<keyof Colors>).map((key) => (
          <Swatches key={key} name={key} value={colors[key]} onChange={(v) => setColors((c) => ({ ...c, [key]: v }))} />
        ))}

        <div className="control">
          <div className="control-head">
            <span className="control-label">Antenna</span>
          </div>
          <div className="segments" role="group" aria-label="Antenna">
            {[true, false].map((v) => (
              <button key={String(v)} className="segment" data-cuelume-select aria-pressed={v === antenna} onClick={() => setAntenna(v)}>
                {v ? 'On' : 'Off'}
              </button>
            ))}
          </div>
        </div>

        <div className="control">
          <div className="control-head">
            <span className="control-label">Speed</span>
            <button className="text-button" data-cuelume-toggle onClick={() => setPaused(!paused)}>{paused ? 'Play' : 'Pause'}</button>
          </div>
          <div className="segments" role="group" aria-label="Speed">
            {SPEEDS.map((v) => (
              <button key={v} className="segment" data-cuelume-select aria-pressed={v === speed} onClick={() => setSpeed(v)}>
                {v}×
              </button>
            ))}
          </div>
        </div>

        <div className="control">
          <div className="control-head">
            <span className="control-label">Sound</span>
          </div>
          <div className="segments" role="group" aria-label="Sound">
            {VOLUMES.map((v) => (
              <button key={v} className="segment" data-cuelume-select aria-pressed={v === volume} onClick={() => setVolume(v)}>
                {v ? `${v * 100}%` : 'Off'}
              </button>
            ))}
          </div>
        </div>

        <div className="control">
          <div className="control-head">
            <span className="control-label">Usage</span>
            <span className="control-actions">
              <button
                className="text-button reset"
                data-cuelume-tap
                aria-hidden={!changed}
                tabIndex={changed ? 0 : -1}
                onClick={() => {
                  setColors(DEFAULTS);
                  setSpeed(1);
                  setAntenna(true);
                  setPaused(false);
                  setVolume(0);
                }}
              >
                Reset
              </button>
              <button className="text-button" onClick={() => copy('snippet', snippet)}>{copied === 'snippet' ? 'Copied' : 'Copy'}</button>
            </span>
          </div>
          <Snippet lines={lines} />
        </div>
      </aside>

      <nav className="states" aria-label="State">
        {robotHeadStates.map((s) => (
          <button key={s} className="state" data-cuelume-select aria-pressed={s === state} onClick={() => setState(s)}>
            <span className="state-head">
              <RobotHead shape={shape} state={s} size={72} paused={paused} speed={speed} antenna={antenna} interactive={false} aria-hidden {...colors} />
            </span>
            <span className="state-name">{title(s)}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

