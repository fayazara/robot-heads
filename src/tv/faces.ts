/* What the screen shows: an LED matrix, one brightness per cell, composed
   every frame from the state and the face's live parameters (where the
   eyes look, how far a blink has closed them).

   Faces are drawn on a 22 × 14 face area — the eyes at columns 6–8 and
   13–15, rows 5–8, symmetric about the middle — centred on a matrix that
   covers the whole screen, whatever its shape. Effects that belong to the
   screen rather than the face (the search beam) run across all of it. */

import type { RobotHeadState } from '../types';
import { voice, type Voice } from './voice';

export const COLS = 22;
export const ROWS = 14;

export interface FaceParams {
  /* where the eyes look, in cells */
  lookX: number;
  lookY: number;
  /* 0 open … 1 shut */
  blink: number;
  /* seconds in the state */
  time: number;
  /* thinking turns to one side, then the other */
  side: number;
  seed: number;
}

export interface Grid {
  v: Float32Array;
  /* the whole matrix */
  cols: number;
  rows: number;
  /* where the face area starts in it */
  ox: number;
  oy: number;
}

/** A matrix of `cols` × `rows` (each at least the face area, by even steps) with the face area centred. */
export function makeGrid(cols: number, rows: number): Grid {
  const c = COLS + 2 * Math.max(0, Math.ceil((cols - COLS) / 2));
  const r = ROWS + 2 * Math.max(0, Math.ceil((rows - ROWS) / 2));
  return { v: new Float32Array(c * r), cols: c, rows: r, ox: (c - COLS) / 2, oy: (r - ROWS) / 2 };
}

/* in face-area coordinates; the matrix reaches past them on every side by ox, oy */
const put = (g: Grid, c: number, r: number, v: number) => {
  const x = c + g.ox, y = r + g.oy;
  if (x < 0 || y < 0 || x >= g.cols || y >= g.rows) return;
  const i = y * g.cols + x;
  if (v > g.v[i]) g.v[i] = v;
};

const rect = (g: Grid, c: number, r: number, w: number, h: number, v: number) => {
  for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) put(g, x, y, v);
};

/* a sprite: '#' full, '+' half, '.' off */
const sprite = (g: Grid, c: number, r: number, rows: string[], v: number) => {
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] === '#') put(g, c + x, r + y, v);
      else if (row[x] === '+') put(g, c + x, r + y, v * 0.5);
    }
  });
};

const EYE_L = 6;
const EYE_R = 13;
const EYE_TOP = 5;

/* two block eyes, 3 wide and `h` tall, closing toward their middle */
function eyes(g: Grid, f: FaceParams, h = 4, v = 1, dy = 0, lid = 0) {
  const dx = Math.round(f.lookX);
  const ly = Math.round(f.lookY) + dy;
  const open = Math.max(1, Math.round(h - (h - 1) * f.blink));
  const top = EYE_TOP + Math.floor((4 - h) / 2) + ly + Math.floor((h - open) / 2);
  for (const c of [EYE_L, EYE_R]) {
    /* a heavy lid dims the top row */
    if (lid > 0 && open > 1) {
      rect(g, c + dx, top, 3, 1, v * (1 - lid));
      rect(g, c + dx, top + 1, 3, open - 1, v);
    } else rect(g, c + dx, top, 3, open, v);
  }
}

const noise = (x: number) => {
  /* a smooth 1D value noise from a few incommensurate sines */
  return 0.5 + 0.25 * Math.sin(x * 1.7) + 0.15 * Math.sin(x * 3.1 + 1.3) + 0.1 * Math.sin(x * 5.3 + 4.1);
};

/* the voice listening hears: another speaker, out of step with its own */
export const HEARD = 0.37;

/* a mouth on the voice: a line when shut; open, shaped by the vowel —
   'ee' wide and short, 'ah' tall, 'oo' a small ring */
function mouth(g: Grid, v: Voice) {
  const h = v.open < 0.1 ? 0 : v.open < 0.33 ? 1 : v.open < 0.6 ? 2 : 3;
  if (h === 0) {
    rect(g, 9, 11, 4, 1, 0.45);
    return;
  }
  const w = v.vowel === 1 ? 8 : v.vowel === 0 ? 6 : 4;
  /* 'ee' never drops far; 'oo' is never a mere line */
  const rows = v.vowel === 1 ? Math.min(h, 2) : v.vowel === 2 ? Math.max(h, 2) : h;
  const x = 11 - w / 2;
  const top = rows === 1 ? 11 : 10;
  for (let y = 0; y < rows; y++) {
    const edge = rows === 3 && (y === 0 || y === 2);
    for (let c = 0; c < w; c++) {
      /* round the corners of a tall mouth, and leave its middle dark */
      if (edge && (c === 0 || c === w - 1)) continue;
      const inside = rows === 3 && y === 1 && c > 0 && c < w - 1;
      put(g, x + c, top + y, inside ? 0.22 : 1);
    }
  }
}

/* how an equaliser spreads a vowel across its bars, 0–1 across, by vowel */
const FORMANTS: Array<Array<[number, number]>> = [
  [[0.45, 0.28]],
  [[0.2, 0.14], [0.78, 0.16]],
  [[0.22, 0.2]],
];

function spectrum(x: number, vowel: 0 | 1 | 2) {
  let v = 0.18;
  for (const [at, wide] of FORMANTS[vowel]) v = Math.max(v, Math.exp(-(((x - at) / wide) ** 2)));
  return v;
}

const CARET = ['..#..', '.#.#.', '#...#'];
const CROSS = ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'];
const Z_BIG = ['####', '..#.', '.#..', '####'];
const Z_SMALL = ['###', '.#.', '###'];

export const FACES: Record<RobotHeadState, (g: Grid, f: FaceParams) => void> = {
  idle(g, f) {
    eyes(g, f);
  },

  thinking(g, f) {
    /* eyes up toward the side it is turned to, lids heavy, a row of dots */
    eyes(g, { ...f, lookX: f.lookX + f.side * 1.4, lookY: f.lookY - 1.2 }, 3, 1, 0, 0.45);
    for (let i = 0; i < 3; i++) {
      const p = (f.time * 1.6 - i * 0.22) % 1;
      const pulse = p < 0.35 ? Math.sin((p / 0.35) * Math.PI) : 0;
      rect(g, 6 + i * 4, 11 - (pulse > 0.5 ? 1 : 0), 2, 2, 0.28 + 0.72 * pulse);
    }
  },

  searching(g, f) {
    eyes(g, f);
    /* a beam sweeping across the whole screen, top to bottom, with a trail */
    const first = -g.ox, last = COLS - 1 + g.ox;
    const sweep = first + (Math.sin(f.time * 1.6 + 0.4) * 0.5 + 0.5) * (last - first);
    const dir = Math.cos(f.time * 1.6 + 0.4) > 0 ? -1 : 1;
    for (let k = 0; k < 5; k++) {
      const c = Math.round(sweep + dir * k);
      const v = 0.32 * (1 - k / 5);
      for (let r = -g.oy; r < ROWS + g.oy; r++) put(g, c, r, v);
    }
  },

  listening(g, f) {
    /* attentive: eyes up and bright while the voice talks, softer between */
    const heard = voice(f.time, f.seed + HEARD);
    eyes(g, f, 4, heard.talking ? 1 : 0.8, -1);
    /* an equaliser on what it hears: each syllable's vowel spread across
       the bars, settling to a dim floor in the pauses */
    for (let i = 0; i < 12; i++) {
      const shimmer = 0.75 + 0.25 * noise(f.time * 9 + i * 1.7 + f.seed * 10);
      const level = heard.open * spectrum(i / 11, heard.vowel) * shimmer;
      const h = Math.max(1, Math.round(level * 4.4));
      for (let k = 0; k < h; k++) put(g, 5 + i, 12 - k, h === 1 && !heard.open ? 0.3 : 0.8 - k * 0.12);
    }
  },

  speaking(g, f) {
    const v = voice(f.time, f.seed);
    /* the eyes lift on a stressed syllable, as brows would */
    const lift = v.stress && v.progress < 0.45 ? -1 : 0;
    eyes(g, f, 4, 1, -1 + lift);
    mouth(g, v);
  },

  working(g, f) {
    /* focused: flat eyes looking down at the job, a progress bar */
    eyes(g, { ...f, lookY: f.lookY + 1 }, 2, 1, 0);
    const p = (f.time / 2.6) % 1;
    const fill = Math.round(p * 12);
    for (let i = 0; i < 12; i++) put(g, 5 + i, 11, i < fill ? 0.95 : 0.16);
    put(g, 4, 11, 0.4);
    put(g, 17, 11, 0.4);
  },

  happy(g, f) {
    const hop = Math.round(Math.max(0, Math.sin(f.time * 5.6)) * -1);
    sprite(g, EYE_L - 1, EYE_TOP + hop, CARET, 1);
    sprite(g, EYE_R - 1, EYE_TOP + hop, CARET, 1);
    /* a wide smile */
    sprite(g, 7, 10 + hop, ['#......#', '.######.'], 0.9);
  },

  error(g, f) {
    const on = Math.sin(f.time * 7) > -0.6 ? 1 : 0.55;
    sprite(g, EYE_L - 1, 4, CROSS, on);
    sprite(g, EYE_R - 1, 4, CROSS, on);
    for (let i = 0; i < 8; i++) put(g, 7 + i, i % 2 ? 11 : 12, 0.8);
  },

  sleeping(g, f) {
    /* shut eyes, curved down at the ends, dim */
    for (const c of [EYE_L, EYE_R]) {
      put(g, c - 1, 7, 0.32);
      rect(g, c, 8, 3, 1, 0.42);
      put(g, c + 3, 7, 0.32);
    }
    /* a z rising and fading, a small one after it */
    for (const [delay, big] of [[0, true], [1.1, false]] as const) {
      const p = ((f.time + delay) / 2.2) % 1;
      const v = Math.sin(p * Math.PI) * 0.6;
      const y = Math.round(5 - p * 5);
      const x = 16 + Math.round(p * 2);
      sprite(g, x, y, big ? Z_BIG : Z_SMALL, v);
    }
  },
};

/** The light the screen and the antenna ball carry in a state. */
export interface StateLight {
  /* LED colour on the screen, null for the head's own */
  screen: [number, number, number] | null;
  ball: [number, number, number];
  /* how bright the antenna ball is at time t, for a head with this seed */
  pulse: (t: number, seed: number) => number;
}

const steady = (v: number) => () => v;

export const LIGHTS: Record<RobotHeadState, StateLight> = {
  idle: { screen: null, ball: [255, 250, 240], pulse: (t) => 0.75 + 0.1 * Math.sin(t * 1.4) },
  thinking: { screen: null, ball: [255, 184, 64], pulse: (t) => 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * 4.2)) },
  searching: { screen: null, ball: [90, 220, 255], pulse: (t) => ((t * 2.4) % 1 < 0.18 ? 1 : 0.25) },
  listening: { screen: null, ball: [96, 255, 150], pulse: (t, seed) => 0.65 + 0.35 * voice(t, seed + HEARD).open },
  speaking: { screen: null, ball: [255, 250, 240], pulse: (t, seed) => 0.45 + 0.55 * voice(t, seed).open },
  working: { screen: null, ball: [110, 160, 255], pulse: (t) => ((t * 1.7) % 1 < 0.5 ? 1 : 0.35) },
  happy: { screen: null, ball: [255, 130, 200], pulse: (t) => 0.8 + 0.2 * Math.sin(t * 8) },
  error: { screen: [255, 70, 64], ball: [255, 60, 50], pulse: (t) => ((t * 3) % 1 < 0.5 ? 1 : 0.15) },
  sleeping: { screen: null, ball: [255, 250, 240], pulse: steady(0) },
};
