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
export interface InstanceOutcome {
  /** What happened. */
  status: 'ok' | 'skip' | 'fail';
  /** The clipped file name, when the clip produced one. */
  out?: string;
  /** The axis of the clipped font, when it could be read. */
  axis?: WeightAxis;
  /** Why the clip failed. */
  reason?: string;
}

/**
 * What happened to one target of the axis clip.
 */
export interface InstanceResult {
  /** The source file of the target. */
  source: string;
  /** The file the clip lands in. */
  out: string;
  /** Whether the clip ran or was skipped. */
  status: 'done' | 'skipped';
  /** The size of the clipped file, null when there is none. */
  bytes: number | null;
  /** Why the target was skipped, null when it was clipped. */
  reason: string | null;
}

/** The options of a run of the axis clip. */
export interface InstanceAllOptions {
  /**
   * The directory the fonts live in.
   *
   * It defaults to STAGING_DIR.
   */
  stagingDir?: string;
  /**
   * Clip the axis instances again, even when they are already there.
   */
  force?: boolean;
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

/**
 * The outcome of the fontTools probe.
 *
 * The three failure modes need three different remedies, so they are
 * told apart: `interpreterMissing` means the Python interpreter never
 * started (it is missing, or it cannot be executed), `moduleMissing`
 * means Python ran but has no fontTools, and neither means the
 * interpreter ran fontTools and fontTools failed.
 */
export interface FontToolsProbe {
  /** Did the probe succeed? */
  ok: boolean;
  /** Did the interpreter fail because fontTools is not installed? */
  moduleMissing: boolean;
  /** Did the probe fail because the Python interpreter could not be started? */
  interpreterMissing: boolean;
  /** A one line summary of what happened. */
  detail: string;
}

/** Run the fontTools probe and describe its outcome. */
export declare function describeFontTools(): FontToolsProbe;

/** Clip one variable font and verify the result. */
export declare function instanceOne(
  target: InstancerTarget,
  options?: InstanceAllOptions,
): Promise<InstanceOutcome>;

/**
 * Clip every variable font, and say what happened to each one.
 *
 * A target whose axis instance is already there is skipped; a failure
 * throws and says why.
 */
export declare function instanceAll(
  opts?: InstanceAllOptions,
): Promise<InstanceResult[]>;
