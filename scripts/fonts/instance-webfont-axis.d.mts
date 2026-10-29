/**
 * Type declarations for scripts/fonts/instance-webfont-axis.mjs.
 *
 * The script itself is plain ESM JavaScript so it can be run with a bare
 * `node` (no build step, no tsx loader). This sibling declaration file
 * gives TypeScript the types it needs when the unit test imports the
 * helpers, and keeps `tsc --noEmit` honest about the shapes involved.
 */

/** One variable font that gets clipped, and the file the clip lands in. */
export interface InstancerTarget {
  /** The source file name inside the staging directory. */
  src: string;
  /** The output file name inside the staging directory. */
  out: string;
}

/** The `wght` axis of a font, read from its `fvar` table. */
export interface WeightAxis {
  /** The lowest weight the font offers. */
  min: number;
  /** The weight the font renders at when no weight is asked for. */
  default: number;
  /** The highest weight the font offers. */
  max: number;
}

/** The outcome of clipping one variable font. */
export interface InstanceResult {
  /** What happened. */
  status: 'ok' | 'skip' | 'fail';
  /** The clipped file name, when the clip produced one. */
  out?: string;
  /** The axis of the clipped font, when it could be read. */
  axis?: WeightAxis;
  /** Why the clip failed. */
  reason?: string;
}

/** Where the downloaded sources live. Gitignored, never committed. */
export declare const STAGING_DIR: string;

/** The variable fonts that get clipped, and the file each clip is written to. */
export declare const INSTANCER_TARGETS: InstancerTarget[];

/** The Python interpreter that runs fontTools. */
export declare const PYTHON_BIN: string;

/** The axis range the site renders. */
export declare const WEIGHT_MIN: number;

/** The axis range the site renders. */
export declare const WEIGHT_MAX: number;

/** The axis the clip has to produce. */
export declare const EXPECTED_AXIS: WeightAxis;

/** The command line of the clip. */
export declare function instancerArgs(src: string, out: string): string[];

/** The `wght` axis of a font, read from its `fvar` table. */
export declare function readWeightAxis(buffer: Buffer): WeightAxis | null;

/** Is fontTools installed? */
export declare function probeFontTools(): boolean;

/** Clip one variable font and verify the result. */
export declare function instanceOne(target: InstancerTarget): Promise<InstanceResult>;
