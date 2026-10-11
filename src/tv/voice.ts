/* A voice, as a pure function of time: phrases of words of syllables,
   with pauses between. Speaking draws its mouth from it and nods along;
   listening hears another one on its equaliser and nods as each phrase
   ends. Pure, so the face, the motion, the light and the sound cues all
   agree on what is being said without sharing any state. */

/* a phrase and the pause after it */
const PERIOD = 3.2;
const SYLLABLES_PER_SECOND = 5;

export interface Voice {
  /* in a phrase, rather than the pause after one */
  talking: boolean;
  /* which phrase, counting from the start */
  phrase: number;
  /* the syllable under way, unique across phrases; -1 between words and phrases */
  syllable: number;
  /* the syllable's first beat carries the stress */
  stress: boolean;
  /* 0 'ah', 1 'ee', 2 'oo' */
  vowel: 0 | 1 | 2;
  /* how open the mouth is, and how loud, 0–1 */
  open: number;
  /* 0–1 through the syllable */
  progress: number;
}

/* a repeatable 0–1 from a few integers */
export function hash(a: number, b: number, seed: number): number {
  const x = Math.sin(a * 12.9898 + b * 78.233 + seed * 37.719) * 43758.5453;
  return x - Math.floor(x);
}

const SILENT = { syllable: -1, stress: false, vowel: 0 as const, open: 0, progress: 0 };

export function voice(t: number, seed: number): Voice {
  const phrase = Math.max(0, Math.floor(t / PERIOD));
  const at = t - phrase * PERIOD;
  /* 1.5–2.6 s of talk, then the rest of the period to breathe */
  const length = 1.5 + 1.1 * hash(phrase, 0, seed);
  if (at >= length) return { talking: false, phrase, ...SILENT };

  const count = Math.max(3, Math.round(length * SYLLABLES_PER_SECOND));
  const span = length / count;
  const j = Math.min(count - 1, Math.floor(at / span));
  const progress = at / span - j;
  /* a gap between words: the mouth shuts for a beat */
  if (j > 0 && hash(phrase, j * 3 + 1, seed) < 0.16) return { talking: true, phrase, ...SILENT };

  const stress = j === 0 || hash(phrase, j * 3 + 2, seed) > 0.78;
  const size = (0.45 + 0.55 * hash(phrase, j * 3, seed)) * (stress ? 1 : 0.8);
  /* opens fast, closes toward the next consonant */
  const open = size * Math.pow(Math.sin(Math.PI * Math.min(1, progress / 0.85)), 0.6);
  const vowel = Math.floor(hash(phrase, j * 3 + 7, seed) * 3) as 0 | 1 | 2;
  return { talking: true, phrase, syllable: phrase * 64 + j, stress, vowel, open, progress };
}
