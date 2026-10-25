/**
 * The sound cues of the quest mode.
 *
 * The cues are Web Audio only - no audio files and no dependency. Every
 * public function is guarded, because an unsupported or blocked
 * AudioContext must never throw into the render path: a missing sound is
 * acceptable, a broken page is not.
 *
 * The mute switch covers every sound of the game. The character audio is
 * played by `lib/tts.ts`'s `speak()`, so this module does **not** import it
 * - the dependency runs the other way, and the quest UI checks
 * `isSoundMuted()` before it speaks.
 */

/** The storage key of the mute switch. The value `'1'` means muted. */
export const SOUND_KEY = 'pinyin-character:game-sound';

/** The stored value of the muted state. */
const MUTED_VALUE = '1';
const UNMUTED_VALUE = '0';

// The chime: two sine partials, a fast decay, half a second.
const CHIME_PARTIALS = [880, 1320];
const CHIME_DURATION = 0.5;
const CHIME_PEAK = 0.3;

// The thud: a low sine that is rolled off by a low-pass filter.
const THUD_FREQUENCY = 160;
const THUD_DURATION = 0.18;
const THUD_FILTER_FREQUENCY = 420;
const THUD_PEAK = 0.4;

// The fanfare: three ascending notes, 90 ms apart.
const FANFARE_NOTES = [660, 880, 1320];
const FANFARE_STEP = 0.09;
const FANFARE_NOTE_DURATION = 0.18;
const FANFARE_PEAK = 0.25;

// The stamp: a short noise burst through a band-pass filter.
const STAMP_DURATION = 0.07;
const STAMP_FILTER_FREQUENCY = 1800;
const STAMP_PEAK = 0.35;

/** The gain floor - an exponential ramp cannot reach zero. */
const SILENCE = 0.0001;

type AudioContextConstructor = new () => AudioContext;

interface AudioGlobalScope {
  AudioContext?: AudioContextConstructor;
  webkitAudioContext?: AudioContextConstructor;
}

/** The lazily created context. It is kept for the whole session. */
let audioContext: AudioContext | null = null;

/**
 * The storage handle, or null when there is none.
 *
 * The game runs in the browser, but the module is also loaded on the server,
 * where there is no storage at all.
 */
function getStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
    const scope = globalThis as { localStorage?: Storage };
    if (scope.localStorage) return scope.localStorage;
  } catch (error) {
    console.warn('[game-sound] the localStorage is not accessible', error);
  }
  return null;
}

/** Is every sound of the game switched off? */
export function isSoundMuted(): boolean {
  try {
    const storage = getStorage();
    if (!storage) return false;
    return storage.getItem(SOUND_KEY) === MUTED_VALUE;
  } catch (error) {
    console.warn('[game-sound] the mute flag could not be read', error);
    return false;
  }
}

/** Switch every sound of the game on or off. */
export function setSoundMuted(muted: boolean): void {
  try {
    const storage = getStorage();
    if (!storage) {
      console.warn('[game-sound] there is no localStorage, the mute flag was not persisted');
      return;
    }
    storage.setItem(SOUND_KEY, muted ? MUTED_VALUE : UNMUTED_VALUE);
  } catch (error) {
    console.warn('[game-sound] the mute flag could not be persisted', error);
  }
}

/** The constructor of the Web Audio API, or null when the browser has none. */
function resolveAudioContextConstructor(): AudioContextConstructor | null {
  const scope = globalThis as unknown as AudioGlobalScope;
  const ctor = scope.AudioContext ?? scope.webkitAudioContext;
  return typeof ctor === 'function' ? ctor : null;
}

/**
 * The context, created on the first cue.
 *
 * A browser that has no Web Audio support simply gets no sound - the failure
 * is not cached, so a context that becomes available later is still used.
 */
function getAudioContext(): AudioContext | null {
  if (audioContext) return audioContext;
  const ctor = resolveAudioContextConstructor();
  if (!ctor) return null;
  try {
    audioContext = new ctor();
    return audioContext;
  } catch (error) {
    console.error('[game-sound] the AudioContext could not be created', error);
    return null;
  }
}

/**
 * Resume a context that the browser suspended.
 *
 * A context starts suspended until the user interacts with the page, so the
 * first cue is often silent without this. The promise is handled, because an
 * unhandled rejection would show up in the console of the game.
 */
function resumeContext(context: AudioContext): void {
  if (context.state !== 'suspended') return;
  try {
    const pending = context.resume();
    if (pending && typeof pending.then === 'function') {
      pending.then(undefined, (error: unknown) => {
        console.warn('[game-sound] the AudioContext could not be resumed', error);
      });
    }
  } catch (error) {
    console.warn('[game-sound] the AudioContext could not be resumed', error);
  }
}

/** A gain node with an exponential decay, connected to the speakers. */
function createDecayingGain(
  context: AudioContext,
  startAt: number,
  duration: number,
  peak: number,
): GainNode {
  const gain = context.createGain();
  gain.gain.setValueAtTime(SILENCE, startAt);
  gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.01);
  gain.gain.exponentialRampToValueAtTime(SILENCE, startAt + duration);
  gain.connect(context.destination);
  return gain;
}

/** The short, bright chime of a correct answer. */
export function playChime(): void {
  try {
    if (isSoundMuted()) return;
    const context = getAudioContext();
    if (!context) return;
    resumeContext(context);

    const startAt = context.currentTime;
    const gain = createDecayingGain(context, startAt, CHIME_DURATION, CHIME_PEAK);
    for (const frequency of CHIME_PARTIALS) {
      const oscillator = context.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, startAt);
      oscillator.connect(gain);
      oscillator.start(startAt);
      oscillator.stop(startAt + CHIME_DURATION);
    }
  } catch (error) {
    console.error('[game-sound] the chime could not be played', error);
  }
}

/** The dull thud of a wrong answer. */
export function playThud(): void {
  try {
    if (isSoundMuted()) return;
    const context = getAudioContext();
    if (!context) return;
    resumeContext(context);

    const startAt = context.currentTime;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(THUD_FILTER_FREQUENCY, startAt);
    const gain = createDecayingGain(context, startAt, THUD_DURATION, THUD_PEAK);
    filter.connect(gain);

    const oscillator = context.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(THUD_FREQUENCY, startAt);
    oscillator.connect(filter);
    oscillator.start(startAt);
    oscillator.stop(startAt + THUD_DURATION);
  } catch (error) {
    console.error('[game-sound] the thud could not be played', error);
  }
}

/** The three ascending notes of a finished level. */
export function playFanfare(): void {
  try {
    if (isSoundMuted()) return;
    const context = getAudioContext();
    if (!context) return;
    resumeContext(context);

    const startAt = context.currentTime;
    FANFARE_NOTES.forEach((frequency, index) => {
      const noteAt = startAt + index * FANFARE_STEP;
      const gain = createDecayingGain(context, noteAt, FANFARE_NOTE_DURATION, FANFARE_PEAK);
      const oscillator = context.createOscillator();
      oscillator.type = 'triangle';
      oscillator.frequency.setValueAtTime(frequency, noteAt);
      oscillator.connect(gain);
      oscillator.start(noteAt);
      oscillator.stop(noteAt + FANFARE_NOTE_DURATION);
    });
  } catch (error) {
    console.error('[game-sound] the fanfare could not be played', error);
  }
}

/** The short noise burst of a stamp - a character was written into the book. */
export function playStamp(): void {
  try {
    if (isSoundMuted()) return;
    const context = getAudioContext();
    if (!context) return;
    resumeContext(context);

    const startAt = context.currentTime;
    const frameCount = Math.max(1, Math.floor(context.sampleRate * STAMP_DURATION));
    const buffer = context.createBuffer(1, frameCount, context.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < frameCount; index += 1) {
      // The noise fades out over the burst, so it reads as a stamp and not
      // as a hiss.
      channel[index] = (Math.random() * 2 - 1) * (1 - index / frameCount);
    }

    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(STAMP_FILTER_FREQUENCY, startAt);
    filter.Q.setValueAtTime(0.8, startAt);
    const gain = context.createGain();
    gain.gain.setValueAtTime(STAMP_PEAK, startAt);
    gain.gain.exponentialRampToValueAtTime(SILENCE, startAt + STAMP_DURATION);
    filter.connect(gain);
    gain.connect(context.destination);

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(filter);
    source.start(startAt);
    source.stop(startAt + STAMP_DURATION);
  } catch (error) {
    console.error('[game-sound] the stamp could not be played', error);
  }
}
