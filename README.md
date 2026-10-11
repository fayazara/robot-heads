# robot-heads

Animated 3D robot heads for React. Glossy, TV-headed bots with an LED-matrix face that shows what your agent is doing — thinking, searching, listening, speaking and more — in four shapes, with a springy antenna, knob ears and a light on top that changes with the state.

Drawn on a 2D canvas: no WebGL, no runtime dependencies.

**[Playground →](https://robot-heads.fayaz.workers.dev)**

## Install

```bash
npm install robot-heads
```

React 18 or newer is a peer dependency.

## Quick start

```tsx
import { RobotHead } from 'robot-heads';

function Agent({ status }: { status: 'idle' | 'thinking' | 'speaking' }) {
  return <RobotHead state={status} size={160} />;
}
```

## Shapes

One head, four outlines. Every shape carries the same screen, ears, antenna, screws and back panel, and moves the same way.

```tsx
<RobotHead shape="rectangle" />  {/* the classic TV (default) */}
<RobotHead shape="square" />
<RobotHead shape="circle" />     {/* a porthole */}
<RobotHead shape="hexagon" />    {/* a nut, flat on top */}
```

The list is exported as `robotHeadShapes`.

## States

Each state has its own face on the screen, its own motion and its own antenna light. Switching states plays a short glitch and cross-fade, and the head eases into its new pose.

| State | Screen | Motion |
|---|---|---|
| `idle` | block eyes that blink and glance | looks around, hops now and then |
| `thinking` | heavy-lidded eyes looking up, three pulsing dots | head tilted up, switching sides; amber light pulses |
| `searching` | darting eyes, a beam sweeping the whole screen | head sweeps side to side; cyan beacon |
| `listening` | alert eyes over an equaliser that hears phrases, each vowel its own shape | head cocked, leaning in as the voice rises, a nod as each phrase ends; green light that follows the voice |
| `speaking` | a mouth that shapes each syllable (wide, tall or round), pausing between words and phrases; eyes lift on stressed syllables | turns to someone new each phrase, bobbing with the jaw; light that follows the voice |
| `working` | focused eyes looking down, a progress bar | busy bobbing, a hop with a spin now and then |
| `happy` | `^ ^` eyes and a smile | bouncy hops |
| `error` | red `X X` eyes | shakes its head; red light blinks |
| `sleeping` | closed eyes and rising z's | head drooped, slow breathing; light off |

The list is exported as `robotHeadStates`.

## Props

```tsx
<RobotHead
  shape="rectangle"       // rectangle, square, circle or hexagon
  state="idle"            // what it is doing (above)
  size={160}              // px, the box the robot rests in (below)
  color="#2b49a3"         // the shell
  trimColor="#93a6c8"     // the ears and the antenna's collar
  screenColor="#e8f2ff"   // the LEDs
  speed={1}               // multiplier on every animation
  paused={false}          // hold the state's still pose
  interactive             // follow the pointer, hop and spin on a click
  antenna                 // the antenna's stem and light; off, the knob stays
  floorShadow             // the soft shadow under the head
  sound={false}           // sound effects in time with the animation (below)
  onCue={(cue) => {}}     // the moments those sounds follow, for your own
  seed={0.3}              // 0–1, desyncs blinks and glances in a row of heads
/>
```

Any other attribute (`className`, `style`, `onClick`, `aria-label`, …) goes on the element, and a `ref` reaches the `<canvas>` inside it.

## Sizing and layout

`size` is the robot itself: the element is a `size` × `size` box with the robot at rest centred in it, filling it, antenna included. It lines up with text, sits in a flex row, and centres like an icon or an avatar would.

Its motion is not part of that box. Hops, the antenna's glow and the floor's shadow draw past its edges — like a CSS `box-shadow`, they overflow without taking any room in your layout, and only the box takes clicks. So margins, flex and grid treat it as exactly `size` × `size`; the one thing to watch is a parent with `overflow: hidden` right round it, which would cut off a hop.

## Behaviour

- **Pointer play.** With `interactive` on (the default), the head and eyes follow a nearby pointer, and a click makes it hop with a full spin and a happy face.
- **Small sizes.** For avatars in a list, `antenna={false}` drops the antenna's stem and its light, keeping the knob on top, so the head itself fills more of the box (the square, circle and hexagon grow; the wide rectangle is already as big as its width allows).
- **Sound.** Off by default. `sound` plays effects in time with the animation, each state keeping a beat for as long as it lasts:

  | State | Sound |
  |---|---|
  | `idle` | a soft tick on each blink |
  | `thinking` | a questioning chime each time it tilts its head |
  | `searching` | a curious chirp with each pass of the beam, higher one way than the other |
  | `listening` | a rising blip as it nods at the end of each phrase |
  | `speaking` | babble, a pitched pluck per syllable, stressed ones louder |
  | `working` | a tick per progress segment, a chime as the bar fills |
  | `happy` | a bright pep on each bounce |
  | `error` | a buzz with each shake of the head |
  | `sleeping` | a cat's purr, looped, swelling with each breath |

  A glitch plays on every state switch, a power-down and power-up as it falls asleep and wakes, and a springy boing whenever it jumps, rising as it does, then a landing. The sounds are CC0: the effects by [Kenney](https://kenney.nl) by way of [soundcn](https://soundcn.xyz), the purr ["purring.m4a" by anchicheng98](https://freesound.org/people/anchicheng98/sounds/509949/) on Freesound. They load only when a head first turns sound on, and the purr only when one first falls asleep, so the package costs nothing extra without them. A paused head is quiet, and browsers keep audio silent until the user first interacts with the page.

  Set the volume, or swap or silence any sound with a URL or `false`:

  ```tsx
  <RobotHead
    sound={{
      volume: 0.6,
      sounds: { sleeping: '/purr.mp3', idle: false },
    }}
  />
  ```

  The keys are the states plus `hop`, `land`, `switch`, `asleep` and `awake`. `sleeping` loops; the rest play once a beat. For anything else, `onCue` hands you the same moments the sounds follow (a state switch, a hop, a landing, a beat, a breath) to play through your own audio.


- **Reduced motion.** With `prefers-reduced-motion: reduce`, or `paused`, the still pose of the state is drawn instead of the animation.
- **Accessible by default.** The canvas has `role="img"` and an `aria-label` naming the state ("Robot, thinking"); pass your own `aria-label` to override it.
- **Cheap to run many.** Every head on the page shares one animation loop, which sleeps while the tab is hidden, and heads of the same shape and size share their baked textures.

## How it is drawn

The head is real geometry: a shell with a rolled edge — its outline a convex polygon of corner centres grown by a corner radius, so one builder makes every shape — lathed knob ears and an antenna collar, built once as quad meshes. Each frame it is turned with the pose and projected, back faces are culled, and every quad is lit by a small studio model: a key light, a fill, a sky dome, a softbox and the key's window caught as clear-coat reflections with Fresnel, a cool back light rimming the silhouette, and a filmic tone curve.

The flat front and back are plates drawn in their own plane with baked relief: the lip rolling into the screen hole, the rubber gasket, the shadow the lip casts onto the glass, screws, and vents on the back. The glass sits a little behind the bezel, so it slides against it as the head turns. The LED matrix covers the whole screen, the face centred on it; the LEDs are drawn crisp, then bloomed from a one-pixel-per-LED image scaled up smooth. The antenna is a damped spring that whips when the head hops, lands or tilts, topped with a frosted bulb lit from inside.

## Development

The repo is a pnpm workspace: the library at the root, the playground in `site/` — a React app on [Vite](https://vite.dev) served by a [Cloudflare Worker](https://developers.cloudflare.com/workers/). The playground runs on the library's source, so edits hot-reload there.

```bash
pnpm install
pnpm run dev       # the playground
pnpm run build     # the library, to dist/
pnpm run typecheck
pnpm run deploy    # build and deploy the playground Worker
```

```
src/            the library
  RobotHead.tsx   the component
  tv/             the TV head: geometry, lighting, faces, motion, renderer
site/           the playground (Vite + Cloudflare Worker)
```

## License

[MIT](LICENSE) © [Fayaz Ahmed](https://x.com/fayazara)

The playground is set in [Open Runde](https://github.com/lauridskern/open-runde) by Laurids Kern, under the SIL Open Font License 1.1 (`site/public/fonts/OFL.txt`). The font is not part of the npm package.
