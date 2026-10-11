import type { CSSProperties, HTMLAttributes } from 'react';

/** What the robot is doing: each state has its own face on the screen, its own motion and its own antenna light. */
export type RobotHeadState =
  | 'idle'
  | 'thinking'
  | 'searching'
  | 'listening'
  | 'speaking'
  | 'working'
  | 'happy'
  | 'error'
  | 'sleeping';

/**
 * A moment in the animation, handed to `onCue`: a state switch, a hop as
 * it leaves the ground (`poked` when a click set it off; `height` in head
 * heights, `air` the seconds until it lands), a landing, a sleeping head's breath
 * turning over (`out` on the out-breath, as the head sinks), or a beat of
 * the rhythm a state keeps for as long as it lasts: idle blinks, thinking
 * tilts, each pass of the search beam, listening nods, speaking syllables,
 * working progress segments (`accent` as the bar fills) and error shakes.
 */
export type RobotHeadCue =
  | { type: 'state'; state: RobotHeadState; previous: RobotHeadState }
  | { type: 'hop'; poked: boolean; height: number; air: number }
  | { type: 'land' }
  | { type: 'breath'; out: boolean }
  | { type: 'beat'; state: RobotHeadState; accent: boolean };

/**
 * What can make a sound: each state's beat (happy's is its bounce, and
 * sleeping's is a loop that breathes), and the moments any state shares.
 * `asleep` and `awake` play as the head drops off and wakes; `switch` on
 * every change of state.
 */
export type RobotHeadSound = RobotHeadState | 'hop' | 'land' | 'switch' | 'asleep' | 'awake';

/** Tune the built-in sounds. */
export interface RobotHeadSoundOptions {
  /** 0–1, scales every sound. Default `1`. */
  volume?: number;
  /**
   * Swap or silence a sound: a URL (or data URI) of an audio file to play
   * instead, or `false` for none. `sleeping` loops; the rest play once a beat.
   */
  sounds?: Partial<Record<RobotHeadSound, string | false>>;
}

/** The head's build. Only the TV head so far. */
export type RobotHeadModel = 'tv';

/** The outline of the head, seen from the front. Every shape carries the same screen, ears and antenna. */
export type RobotHeadShape = 'rectangle' | 'square' | 'circle' | 'hexagon';

/**
 * Any other attribute (`className`, `style`, `onClick`, `aria-label`, …)
 * goes on the element: the `size` × `size` box the robot rests in. A `ref`
 * reaches the canvas inside it.
 */
export interface RobotHeadProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'color'> {
  /** Which head. Default `tv`. */
  model?: RobotHeadModel;
  /** The head's outline: `rectangle` (default), `square`, `circle` or `hexagon`. */
  shape?: RobotHeadShape;
  /** What it is doing. Default `idle`. */
  state?: RobotHeadState;
  /** The box the robot rests in, in px; hops and the glow reach past it. Default `160`. */
  size?: number;
  /** Colour of the shell. Default a deep glossy blue. */
  color?: string;
  /** Colour of the ears and the antenna's collar. Default a pale steel. */
  trimColor?: string;
  /** Colour of the LEDs on the screen. Default a cool white. */
  screenColor?: string;
  /** Multiplier on every animation's speed. Default `1`. */
  speed?: number;
  /** Freeze every animation on its current frame. */
  paused?: boolean;
  /** Follow the pointer with the eyes and head, and hop and spin on a click. Default `true`. */
  interactive?: boolean;
  /**
   * Show the antenna's stem and its light. Default `true`. Turn it off for
   * small sizes, such as avatars in a list: the knob on top stays, and the
   * head grows to fill the room the antenna took.
   */
  antenna?: boolean;
  /** Draw the soft shadow on the floor under the head. Default `true`. */
  floorShadow?: boolean;
  /**
   * Play sound effects in time with the animation: `true` for the built-in
   * set (CC0 sounds, loaded only when first turned on), or options to set
   * the volume and swap or silence sounds. Default `false`. Browsers keep
   * audio silent until the user first interacts with the page, and a paused
   * head is quiet.
   */
  sound?: boolean | RobotHeadSoundOptions;
  /**
   * Called with each moment in the animation, on the frame it happens: for
   * sound effects, or anything else that should keep time with the head.
   * Silent while paused or under reduced motion.
   */
  onCue?: (cue: RobotHeadCue) => void;
  /** 0–1, offsets the blinks and glances so a row of heads does not move in unison. */
  seed?: number;
  className?: string;
  style?: CSSProperties;
}
