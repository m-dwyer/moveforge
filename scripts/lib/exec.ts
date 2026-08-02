import { spawn } from "node:child_process";

export type RunOptions = {
  /** Extra environment on top of the current process env. */
  env?: Record<string, string | undefined>;
  /** Capture stdout instead of inheriting it. stderr is always inherited. */
  capture?: boolean;
  /** Return the exit status instead of throwing on non-zero. */
  allowFailure?: boolean;
  /** Working directory for the child. Defaults to the current one. */
  cwd?: string;
};

export type RunResult = {
  status: number;
  stdout: string;
};

/**
 * Spawn a command without a shell and wait for it.
 *
 * No shell means no quoting rules to get wrong: every argument is passed
 * through verbatim, so a module directory or output path containing a space is
 * not a latent bug the way it is in the bash these scripts replaced.
 */
export async function run(command: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : process.env,
    stdio: ["ignore", options.capture ? "pipe" : "inherit", "inherit"]
  });

  let stdout = "";
  if (options.capture && child.stdout) {
    child.stdout.setEncoding("utf8");
    for await (const chunk of child.stdout) stdout += chunk as string;
  }

  const status = await new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => resolve(signal ? 128 : (code ?? 1)));
  });

  if (status !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${args.join(" ")} exited ${status}`);
  }
  return { status, stdout };
}

/** Run a command and return its trimmed stdout. */
export async function capture(command: string, args: string[]): Promise<string> {
  return (await run(command, args, { capture: true })).stdout.trim();
}

/** True if `command` resolves on PATH. */
export async function commandExists(command: string): Promise<boolean> {
  const { status } = await run("sh", ["-c", `command -v ${command} >/dev/null 2>&1`], {
    allowFailure: true,
    capture: true
  });
  return status === 0;
}

/**
 * Fail with a message and no stack trace.
 *
 * These are build scripts: a missing toolchain is a thing for the reader to go
 * fix, not a defect in the script, and a Node stack trace on top of it only
 * buries the sentence that says what to do.
 */
export function die(message: string): never {
  console.error(message);
  process.exit(1);
}
