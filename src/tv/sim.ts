/* The head's motion. Each state sets targets for a small rig — yaw,
   pitch, roll, a sway and a bob — that springs chase, so a state switch
   always eases across. Jumps are scripted on top (crouch, a parabola
   with an optional full turn, a landing squash), and the antenna is a
   wobbly spring of its own, shaken by whatever the head does. */

import type { RobotHeadCue, RobotHeadState } from '../types';
import { HEARD, type FaceParams } from './faces';
import { hash, voice } from './voice';

class Spring {
  x = 0;
  v = 0;
  constructor(x = 0) {
    this.x = x;
  }
  step(target: number, dt: number, freq: number, damping: number) {
    const w = freq * Math.PI * 2;
    this.v += (w * w * (target - this.x) - 2 * damping * w * this.v) * dt;
    this.x += this.v * dt;
  }
}

function rng(seed: number) {
  let a = Math.floor(seed * 4294967295) >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const easeInOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

interface Jump {
  age: number;
  height: number;
  spin: number;
  lean: number;
  air: number;
  poked: boolean;
  launched: boolean;
  landed: boolean;
}

const CROUCH = 0.11;

/** The sleeping head's breath, in radians a second: its bob rises on the in-breath and falls on the out-breath. */
export const SLEEP_BREATH = 1.15;

export interface RobotPose {
  yaw: number;
  pitch: number;
  roll: number;
  /* sideways and upward, in head widths */
  x: number;
  lift: number;
  /* scale about the bottom of the head */
  sx: number;
  sy: number;
  /* the antenna's lean, sideways and toward the viewer, radians */
  antennaX: number;
  antennaZ: number;
}

export class RobotSim {
  state: RobotHeadState;
  /* what the screen shows: the state, or a reaction over it */
  shown: RobotHeadState;
  previous: RobotHeadState;
  /* seconds since `shown` changed, and since the head appeared */
  switched = 10;
  age = 0;
  time = 0;
  since = 0;
  pose: RobotPose = { yaw: 0, pitch: 0, roll: 0, x: 0, lift: 0, sx: 1, sy: 1, antennaX: 0, antennaZ: 0 };
  face: FaceParams;
  /* the pointer, relative to the head's centre in CSS px, or null */
  pointer: { x: number; y: number } | null = null;
  /* moments since the last frame, for the component to hand to onCue */
  cues: RobotHeadCue[] = [];

  private yaw = new Spring();
  private pitch = new Spring();
  private roll = new Spring();
  private sway = new Spring();
  private squash = new Spring();
  private antX = new Spring();
  private antZ = new Spring();
  private lastV = { roll: 0, pitch: 0, sway: 0 };
  private jump: Jump | null = null;
  private random: () => number;
  private lookAt = { yaw: 0, pitch: 0, x: 0, y: 0 };
  private nextLook = 0.6;
  private nextBlink = 1.5;
  private blinkAge = -1;
  private nextHop = 8;
  private nextSide = 4;
  private reactUntil = -1;
  private nextNod = 2.5;
  private exhaling = false;
  /* the state's beat counter, so each beat cues once; -1 cues the first at once */
  private lastBeat = -1;
  private flips = 0;
  /* listening: whether the voice it hears was mid-phrase last step */
  private hearing = false;

  constructor(seed: number, state: RobotHeadState) {
    this.random = rng(seed);
    this.state = this.shown = this.previous = state;
    this.face = { lookX: 0, lookY: 0, blink: 0, time: 0, side: 1, seed };
    this.nextBlink = 1 + this.random() * 3;
    this.nextHop = 6 + this.random() * 6;
  }

  setState(s: RobotHeadState) {
    if (s === this.state) return;
    this.cues.push({ type: 'state', state: s, previous: this.state });
    this.state = s;
    this.since = 0;
    this.lastBeat = -1;
    this.hearing = false;
    this.nextLook = 0;
    this.nextHop = this.time + (s === 'happy' ? 0.2 : 3 + this.random() * 4);
    if (s === 'happy') this.hop(0.22, 1);
  }

  /** A click: a hop with a full turn and a happy face. */
  poke() {
    this.hop(0.24, this.random() < 0.5 ? 1 : -1, true);
    this.reactUntil = this.time + 1.6;
  }

  hop(height: number, spin: number, poked = false) {
    if (this.jump) return;
    this.jump = { age: 0, height, spin, lean: (this.random() - 0.5) * 0.3, air: 0.42 + height * 0.45, poked, launched: false, landed: false };
  }

  /* the rhythm each state keeps, as the screen shows it: a cue per beat */
  private beats() {
    const s = this.since;
    let beat = this.lastBeat;
    let accent = false;
    switch (this.state) {
      case 'thinking':
      case 'listening':
        /* a tilt to the other side; a nod */
        beat = this.flips;
        break;
      case 'searching':
        /* each pass of the beam (its face draws it at sin(s·1.6 + 0.4));
           it enters mid-pass, so the first beat waits for it to turn */
        beat = Math.floor((s * 1.6 + 0.4 + Math.PI / 2) / Math.PI);
        if (this.lastBeat < 0) this.lastBeat = beat;
        break;
      case 'speaking': {
        /* each syllable the mouth opens on, accented where stressed */
        const v = voice(s, this.face.seed);
        if (v.syllable < 0) break;
        beat = v.syllable;
        accent = v.stress;
        break;
      }
      case 'working':
        /* a segment of the progress bar; accented as it fills */
        beat = Math.floor((s / 2.6) * 12);
        accent = beat > 0 && beat % 12 === 0;
        break;
      case 'error':
        /* a shake of the head */
        beat = Math.floor(s / 2.4);
        break;
    }
    if (beat === this.lastBeat) return;
    this.lastBeat = beat;
    this.cues.push({ type: 'beat', state: this.state, accent });
  }

  update(dt: number) {
    if (!(dt > 0)) return;
    /* small steps keep the springs stable on a slow frame */
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    for (let i = 0; i < steps; i++) this.step(dt / steps);
  }

  private step(dt: number) {
    this.time += dt;
    this.since += dt;
    this.age += dt;
    this.switched += dt;
    const t = this.time;
    const rand = this.random;

    const shown: RobotHeadState = t < this.reactUntil ? 'happy' : this.state;
    if (shown !== this.shown) {
      this.previous = this.shown;
      this.shown = shown;
      this.switched = 0;
    }

    /* the state's targets */
    let yaw = 0, pitch = 0, roll = 0, sway = 0, bob = Math.sin(t * 1.9) * 0.008;
    let lookX = 0, lookY = 0;
    let freq = 1.3, damping = 0.62;
    let shake = 0;
    const p = this.pointer;
    const follows = p && (this.state === 'idle' || this.state === 'listening' || this.state === 'happy' || this.state === 'speaking');

    if (t > this.nextLook) {
      this.lookAt = {
        yaw: (rand() - 0.5) * 0.75,
        pitch: (rand() - 0.5) * 0.24,
        x: 0,
        y: 0,
      };
      this.lookAt.x = clamp(Math.round(this.lookAt.yaw * 5), -2, 2);
      this.lookAt.y = rand() < 0.3 ? -1 : rand() < 0.2 ? 1 : 0;
      this.nextLook = t + 1.4 + rand() * 2.6;
    }

    switch (this.state) {
      case 'idle':
        yaw = this.lookAt.yaw;
        pitch = this.lookAt.pitch;
        roll = -this.lookAt.yaw * 0.16;
        lookX = this.lookAt.x;
        lookY = this.lookAt.y;
        if (t > this.nextHop) {
          this.hop(0.15 + rand() * 0.07, rand() < 0.35 ? (rand() < 0.5 ? 1 : -1) : 0);
          this.nextHop = t + 7 + rand() * 7;
        }
        break;
      case 'thinking': {
        if (t > this.nextSide) {
          this.face.side = -this.face.side;
          this.flips++;
          this.nextSide = t + 3 + rand() * 2;
        }
        const s = this.face.side;
        yaw = 0.24 * s + Math.sin(t * 0.9) * 0.05;
        pitch = 0.17 + Math.sin(t * 1.3) * 0.03;
        roll = -0.13 * s;
        freq = 0.9;
        break;
      }
      case 'searching': {
        const ph = t * 1.6;
        yaw = Math.sin(ph) * 0.55;
        pitch = -0.04 + Math.sin(ph * 2) * 0.04;
        roll = Math.sin(ph) * -0.06;
        /* the eyes lead the head */
        lookX = clamp(Math.sin(ph + 0.4) * 3, -3, 3);
        freq = 2.2;
        damping = 0.8;
        break;
      }
      case 'listening': {
        /* cocked, leaning in a touch as the voice gets louder, and a nod as
           each phrase it hears comes to an end */
        const heard = voice(this.since, this.face.seed + HEARD);
        yaw = -0.14 + Math.sin(t * 0.6) * 0.03;
        pitch = 0.02 + heard.open * 0.04;
        roll = 0.17 + Math.sin(t * 0.45) * 0.03;
        if (this.hearing && !heard.talking) {
          this.pitch.v -= 0.9;
          this.flips++;
        }
        this.hearing = heard.talking;
        break;
      }
      case 'speaking': {
        /* turned to someone new each phrase, the head riding the jaw, a dip
           on each stressed syllable */
        const v = voice(this.since, this.face.seed);
        const turn = hash(v.phrase, 5, this.face.seed) - 0.5;
        yaw = turn * 0.34 + Math.sin(t * 0.7) * 0.04;
        pitch = 0.02 + v.open * 0.035 + (v.stress ? v.open * 0.03 : 0);
        roll = -turn * 0.08 + Math.sin(t * 0.9) * 0.03;
        bob += v.open * 0.01;
        freq = 1.8;
        break;
      }
      case 'working':
        yaw = Math.sin(t * 0.8) * 0.08;
        pitch = -0.16;
        roll = Math.sin(t * 0.5) * 0.04;
        bob += Math.abs(Math.sin(t * 7)) * 0.012;
        if (t > this.nextHop) {
          this.hop(0.2, rand() < 0.5 ? 1 : -1);
          this.nextHop = t + 5 + rand() * 3;
        }
        break;
      case 'happy':
        yaw = Math.sin(t * 2.2) * 0.18;
        roll = Math.sin(t * 4.4) * 0.12;
        pitch = 0.08;
        if (t > this.nextHop) {
          this.hop(0.17, rand() < 0.34 ? (rand() < 0.5 ? 1 : -1) : 0);
          this.nextHop = t + 1.05 + rand() * 0.4;
        }
        break;
      case 'error': {
        /* a shake of the head every couple of seconds */
        const c = (this.since % 2.4) / 0.7;
        shake = c < 1 ? Math.sin(c * Math.PI * 7) * 0.22 * (1 - c) : 0;
        pitch = -0.06;
        roll = -0.05;
        freq = 1.6;
        break;
      }
      case 'sleeping':
        pitch = -0.34;
        roll = 0.13;
        yaw = 0.06;
        bob = Math.sin(t * SLEEP_BREATH) * 0.016;
        /* the bob falling is the out-breath */
        if (Math.cos(t * SLEEP_BREATH) < 0 !== this.exhaling) {
          this.exhaling = !this.exhaling;
          this.cues.push({ type: 'breath', out: this.exhaling });
        }
        freq = 0.55;
        damping = 0.9;
        if (t > this.nextNod) {
          this.pitch.v -= 0.5;
          this.nextNod = t + 5 + rand() * 4;
        }
        break;
    }

    if (follows && p) {
      yaw = clamp(p.x / 260, -1, 1) * 0.55;
      pitch = -clamp(p.y / 260, -1, 1) * 0.32;
      roll = -yaw * 0.12 + (this.state === 'listening' ? 0.12 : 0);
      lookX = clamp(p.x / 120, -2.4, 2.4);
      lookY = clamp(p.y / 160, -1.4, 1.4);
    }

    this.yaw.step(yaw, dt, freq, damping);
    this.pitch.step(pitch, dt, freq, damping);
    this.roll.step(roll, dt, freq, damping);
    this.sway.step(sway, dt, 1.2, 0.7);

    /* the jump */
    let lift = 0, spin = 0, lean = 0;
    let squashTarget = 0;
    const j = this.jump;
    if (j) {
      j.age += dt;
      if (j.age < CROUCH) {
        squashTarget = 0.14;
      } else {
        const ap = (j.age - CROUCH) / j.air;
        if (ap < 1) {
          if (!j.launched) {
            j.launched = true;
            this.cues.push({ type: 'hop', poked: j.poked, height: j.height, air: j.air });
          }
          if (ap < 0.06 && this.squash.x > 0.05) {
            /* leaving the ground: spring up into a stretch, the antenna lagging */
            this.squash.v = -2.6;
            this.antZ.v -= 3;
          }
          lift = 4 * j.height * ap * (1 - ap);
          spin = j.spin * Math.PI * 2 * easeInOut(clamp(ap * 1.08, 0, 1));
          lean = j.lean * Math.sin(ap * Math.PI);
          squashTarget = ap < 0.5 ? -0.05 : 0;
        } else if (!j.landed) {
          j.landed = true;
          this.cues.push({ type: 'land' });
          this.squash.v += 3.2;
          this.antX.v += (rand() < 0.5 ? -1 : 1) * (2.5 + rand() * 2);
          this.antZ.v += 3.5;
        } else if (j.age - CROUCH - j.air > 0.35) {
          this.jump = null;
        }
      }
    }
    this.squash.step(squashTarget, dt, 3.2, 0.32);

    this.beats();

    /* blinks */
    if (t > this.nextBlink) {
      this.blinkAge = 0;
      if (this.state === 'idle') this.cues.push({ type: 'beat', state: 'idle', accent: false });
      this.nextBlink = t + 2.2 + rand() * 3.5;
      if (rand() < 0.2) this.nextBlink = t + 0.35;
    }
    let blink = 0;
    if (this.blinkAge >= 0) {
      this.blinkAge += dt;
      blink = Math.sin(clamp(this.blinkAge / 0.17, 0, 1) * Math.PI);
      if (this.blinkAge > 0.17) this.blinkAge = -1;
    }

    /* the antenna, pushed about by how the head accelerates */
    const rollAcc = (this.roll.v - this.lastV.roll) / dt;
    const pitchAcc = (this.pitch.v - this.lastV.pitch) / dt;
    const swayAcc = (this.sway.v - this.lastV.sway) / dt;
    this.lastV = { roll: this.roll.v, pitch: this.pitch.v, sway: this.sway.v };
    const aw = 2.3;
    this.antX.v -= (rollAcc * 0.05 + swayAcc * 0.3) * dt * 6;
    this.antZ.v -= pitchAcc * 0.05 * dt * 6;
    this.antX.step(0, dt, aw, 0.09);
    this.antZ.step(0, dt, aw, 0.09);
    this.antX.x = clamp(this.antX.x, -0.7, 0.7);
    this.antZ.x = clamp(this.antZ.x, -0.7, 0.7);

    const sq = this.squash.x;
    this.pose = {
      yaw: this.yaw.x + spin + shake,
      pitch: this.pitch.x,
      roll: this.roll.x + lean,
      x: this.sway.x,
      lift: lift + bob,
      sx: 1 + sq * 0.55,
      sy: 1 - sq,
      antennaX: this.antX.x,
      antennaZ: this.antZ.x,
    };
    this.face.lookX = lookX;
    this.face.lookY = lookY;
    this.face.blink = this.state === 'sleeping' ? 0 : blink;
    this.face.time = this.since;
  }
}

/** The still pose of a state, for reduced motion and paused heads. */
export function restPose(state: RobotHeadState): RobotPose {
  const base: RobotPose = { yaw: 0, pitch: 0, roll: 0, x: 0, lift: 0, sx: 1, sy: 1, antennaX: 0, antennaZ: 0 };
  switch (state) {
    case 'thinking': return { ...base, yaw: 0.24, pitch: 0.17, roll: -0.13 };
    case 'searching': return { ...base, yaw: 0.3, roll: -0.04 };
    case 'listening': return { ...base, yaw: -0.14, pitch: 0.02, roll: 0.17 };
    case 'working': return { ...base, pitch: -0.16 };
    case 'happy': return { ...base, pitch: 0.08, roll: 0.06 };
    case 'error': return { ...base, pitch: -0.06, roll: -0.05 };
    case 'sleeping': return { ...base, pitch: -0.34, roll: 0.13, yaw: 0.06 };
    default: return { ...base, yaw: -0.18, pitch: 0.04, roll: 0.03 };
  }
}
