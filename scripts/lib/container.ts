import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { run } from "./exec.ts";

/**
 * Running a generated ninja build inside a toolchain container.
 *
 * Ninja runs *inside* the container rather than on the host driving `docker run`
 * per compile. That keeps one container per build invocation (what the bash
 * scripts already did) and, more importantly, keeps every path consistent:
 * ninja writes .ninja_deps and reads the compiler's depfiles on the same side of
 * the mount, so nothing has to translate host paths to container paths. The
 * generated ninja files are entirely repo-relative, which is what makes that work.
 */
export type ContainerBuild = {
  image: string;
  /** Built from this Dockerfile if the image is not present locally. */
  dockerfile: string;
  ninjaFile: string;
  targets: string[];
  /** Repo root; mounted as the working directory. */
  root: string;
  /** Extra `ninja` arguments, e.g. ["-v"]. */
  ninjaArgs?: string[];
};

export async function dockerAvailable(): Promise<boolean> {
  const { status } = await run("docker", ["info"], { allowFailure: true, capture: true });
  return status === 0;
}

/**
 * Build the image if it is missing, tagging it with a hash of its Dockerfile.
 *
 * The tag is content-addressed rather than fixed because build.sh's `docker image
 * inspect || docker build` only ever asked whether an image of that *name*
 * existed. Editing the Dockerfile therefore changed nothing: the stale image kept
 * being reused until someone deleted it by hand, and the failure surfaced as a
 * confusing error from inside the container rather than as "your image is old".
 */
async function ensureImage(image: string, dockerfile: string): Promise<string> {
  const digest = createHash("sha256").update(await readFile(dockerfile)).digest("hex").slice(0, 12);
  const tagged = `${image}:${digest}`;

  const { status } = await run("docker", ["image", "inspect", tagged], {
    allowFailure: true,
    capture: true
  });
  if (status === 0) return tagged;

  console.log(`building container image ${tagged} from ${dockerfile}`);
  await run("docker", ["build", "-t", tagged, "-f", dockerfile, "."]);
  return tagged;
}

export async function runNinjaInContainer(build: ContainerBuild): Promise<void> {
  const image = await ensureImage(build.image, build.dockerfile);
  await run("docker", [
    "run",
    "--rm",
    "-v",
    `${build.root}:/build`,
    // Run as the invoking user so the objects and artifacts the container writes
    // are owned by them and not by root, which would make the next host-side
    // build (and `mise run clean`) fail on permissions.
    "-u",
    `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`,
    "-w",
    "/build",
    image,
    "ninja",
    ...(build.ninjaArgs ?? []),
    "-f",
    build.ninjaFile,
    ...build.targets
  ]);
}

/** Run the same ninja build on this machine, for hosts that have the toolchain. */
export async function runNinjaLocally(
  ninjaFile: string,
  targets: string[],
  ninjaArgs: string[] = []
): Promise<void> {
  await run("ninja", [...ninjaArgs, "-f", ninjaFile, ...targets]);
}
