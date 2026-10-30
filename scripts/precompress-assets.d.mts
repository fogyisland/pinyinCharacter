/**
 * Type declarations for scripts/precompress-assets.mjs.
 *
 * The script itself is plain ESM JavaScript so it can be run with a bare
 * `node` (no build step, no tsx loader). This sibling declaration file
 * gives TypeScript the types it needs when the unit test imports the
 * helpers, and keeps `tsc --noEmit` honest about the shapes involved.
 *
 * The tool writes brotli and gzip sidecars next to the static assets. It
 * only ADDS files — it never deletes anything — and a directory that is not
 * there is reported and skipped rather than counted as a failure.
 */

/** The options every entry point of the precompressor takes. */
export interface PrecompressOptions {
  /**
   * Rewrite the sidecars even when the ones on disk are newer than their
   * source. Without it, an up to date sidecar is left alone.
   */
  force?: boolean;
}

/** What one precompression did. */
export interface PrecompressFileResult {
  /** The file that was inspected. */
  file: string;
  /** The size of the source file in bytes, 0 when it is unknown. */
  bytesIn: number;
  /**
   * The size of the brotli sidecar this call wrote, in bytes. It is 0 when
   * the call wrote nothing — the file was skipped or the write failed.
   */
  bytesOut: number;
  /** What happened to the file. */
  status: 'written' | 'skipped' | 'failed';
}

/** What a whole tree of precompressions did. */
export interface PrecompressTreeResult {
  /** The number of files that got a fresh sidecar. */
  written: number;
  /** The number of files that were left alone. */
  skipped: number;
  /** The number of files that could not be precompressed. */
  failed: number;
  /**
   * The bytes the brotli sidecars save against their sources: the sum of
   * the source bytes minus the brotli bytes over every written file.
   */
  savedBytes: number;
}

/**
 * The extensions of the files that are worth compressing: they are text, so
 * brotli and gzip actually shrink them.
 */
export declare const COMPRESSIBLE_EXTENSIONS: Set<string>;

/**
 * The extensions that are already compressed, or that carry no text at all.
 * A file in this set is never given a sidecar.
 */
export declare const SKIPPED_EXTENSIONS: Set<string>;

/**
 * Whether a file is worth compressing.
 *
 * A file is compressible when its extension is in `COMPRESSIBLE_EXTENSIONS`
 * and NOT in `SKIPPED_EXTENSIONS`.
 */
export declare function isCompressible(filePath: string): boolean;

/**
 * Precompress one file: write a `.br` and a `.gz` next to it.
 *
 * The file is left alone when it is not compressible, or when its brotli
 * sidecar is already newer than the file itself (unless `force` says
 * otherwise). A failure is reported by name, never swallowed.
 */
export declare function precompressFile(
  filePath: string,
  options?: PrecompressOptions,
): Promise<PrecompressFileResult>;

/**
 * Walk a directory tree and precompress every file in it.
 *
 * The listing of a directory is taken once, before any file in it is
 * touched, so the sidecars the run writes are never counted as sources.
 */
export declare function precompressTree(
  dir: string,
  options?: PrecompressOptions,
): Promise<PrecompressTreeResult>;
