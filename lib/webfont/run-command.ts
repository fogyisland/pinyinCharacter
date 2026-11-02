/**
 * The default child-process runner of the font pipeline.
 *
 * It exists so that the pipeline itself never has to know how a process is
 * started: `pipeline.ts` only calls a function with this shape, which the
 * tests can replace with a fake. That is what keeps the test suite from
 * shelling out to node.
 *
 * Two rules the runner must not break:
 *
 *  1. **No shell.** The arguments go over as an argv array, so a path with
 *     a space in it is a path with a space in it, not the beginning of a
 *     command injection.
 *  2. **The env is an OVERLAY.** `opts.env` is merged ONTO `process.env`,
 *     never used as a replacement. A replacement would strip `PATH`,
 *     `SYSTEMROOT` and `TEMP`, and the child could not start at all.
 */
import { spawn } from 'node:child_process';

/** The options the runner accepts. */
export interface RunCommandOptions {
  /** The working directory of the child. */
  cwd?: string;
  /** Variables layered ON TOP of `process.env` — not a replacement. */
  env?: Record<string, string>;
}

/** What the runner reports back. */
export interface RunCommandResult {
  /** The exit code; `null` when the child was stopped by a signal. */
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs a command and waits for it to finish.
 *
 * A non-zero exit code is a **result**, not an exception: the caller
 * decides what a failing exit means (the verifier's findings are worth
 * reading, and the pipeline turns them into a job error).
 */
export async function runCommand(
  bin: string,
  args: string[],
  opts: RunCommandOptions = {},
): Promise<RunCommandResult> {
  return new Promise<RunCommandResult>((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env ?? {}) },
      // No shell: the argv array is passed through as it is.
      shell: false,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.on('error', (error: Error) => {
      reject(error);
    });

    child.on('close', (code: number | null) => {
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}
