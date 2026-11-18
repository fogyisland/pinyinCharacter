/**
 * The types of the capability probe.
 *
 * They live here, and not in `capability.ts`, because BOTH the probes
 * (`probes.ts`) and the orchestration (`capability.ts`) need them — and a
 * `probes.ts` that imported them from `capability.ts` would close a
 * runtime import cycle (`capability.ts → probes.ts → capability.ts`),
 * where the second import can find `undefined` where it expects a value.
 *
 * ⚠️ The shapes are UNCHANGED: they were moved verbatim out of
 * `capability.ts`, and `capability.ts` re-exports them, so every
 * `import { CapabilityReport } from '@/lib/webfont/capability'` keeps
 * working.
 */

/** The report the admin panel renders. */
export interface CapabilityReport {
  /** The verdict: false when any capability is missing. */
  ok: boolean;
  /** The node version the server runs on. */
  node: string;
  python: { available: boolean; version: string | null; error: string | null };
  fonttools: { available: boolean; version: string | null; error: string | null; remedy: string | null };
  network: { available: boolean; checkedUrl: string; error: string | null };
  /**
   * The disk row — the two directories the pipeline writes into.
   *
   * `stagingDir` is where ① downloads the source fonts and where the
   * probe file is written (and deleted again). `fontDir` is where the
   * apply (release) step writes the published subsets — ③ writes into
   * the staging output directory, NOT here (design §3.3); it is only
   * CHECKED for writability, never written to. `available` is true only
   * when both of them are usable.
   */
  disk: {
    available: boolean;
    stagingDir: string;
    fontDir: string;
    error: string | null;
  };
  toolchain: { subsetFont: boolean; typescript: boolean; tsx: boolean };
  sources: { filename: string; label: string; present: boolean; size: number | null }[];
  /** What is missing, in Chinese, one entry per missing thing, with the remedy. */
  missing: string[];
}

/** What a command answered. */
export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs a command without a shell and reports what it answered. */
export type RunCommand = (bin: string, args: string[]) => Promise<CommandResult>;

/**
 * Everything the probe touches outside of this process, so a test can
 * replace it.
 */
export interface ProbeOptions {
  /**
   * Where the source fonts are staged, and where the disk probe writes
   * its probe file (and deletes it again). Defaults to the pipeline's
   * staging dir.
   */
  stagingDir?: string;
  /**
   * The font root the disk row checks for writability. It is never
   * written to. Defaults to the subsetter's font root.
   */
  fontDir?: string;
  /** Runs a command. Defaults to `execFile` without a shell. */
  runCommand?: RunCommand;
  /** Performs the upstream HEAD request. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Resolves a package by name. Defaults to node's own resolver. */
  resolveModule?: (specifier: string) => string | null;
}

/** The python probe, and what it found. */
export interface PythonOutcome {
  available: boolean;
  version: string | null;
  error: string | null;
  /** True when the interpreter is simply not installed. */
  notInstalled: boolean;
}

/** The fontTools probe, and what it found. */
export interface FontToolsOutcome {
  available: boolean;
  version: string | null;
  error: string | null;
}

/** The outcome of the disk probe's two halves. */
export interface DiskCheck {
  ok: boolean;
  error: string | null;
}
