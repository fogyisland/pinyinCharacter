/**
 * The assessment shapes, by themselves.
 *
 * `lib/azure-assessment.ts` does the talking (it reads the config, calls
 * Azure, logs failures) and therefore pulls in server-only modules. The
 * PANEL needs only the shapes — but `import type` from that file still makes
 * the bundler follow the edge into `mysql2`, which is the failure mode this
 * site's notes already record twice. So the shapes live here, in a file with
 * no imports at all, and both sides meet on it.
 */

/** One syllable's score, as Azure returns it. */
export interface SyllableScore {
  /** The syllable (e.g. 「xué」). */
  syllable: string;
  /** 0–100. */
  accuracy: number;
  /** 0–100. */
  fluency: number;
  /** 0–100. */
  completeness: number;
  /** 0–100, or null when Azure did not score it. */
  prosody: number | null;
}

/** One phoneme inside a syllable. */
export interface PhonemeScore {
  phoneme: string;
  accuracy: number;
}

/** The assessment of one word. */
export interface Assessment {
  /** The word the learner was asked to read. */
  reference: string;
  /** What Azure heard. */
  recognised: string;
  /** 0–100 overall. */
  accuracy: number;
  fluency: number;
  completeness: number;
  /** 0–100, or null when prosody was not requested. */
  prosody: number | null;
  /** 0–100 pronunciation score. */
  pronunciation: number;
  syllables: SyllableScore[];
  phonemes: PhonemeScore[];
}
