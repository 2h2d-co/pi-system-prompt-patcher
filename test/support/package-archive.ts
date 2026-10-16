import { execFileSync } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

/**
 * Select the package archive under test.
 *
 * A supplied candidate (`PI_PACKAGE_ARCHIVE`) is resolved from the current working directory
 * and must be an existing, non-empty regular file. It never falls back to packing the
 * worktree. Without a candidate, the worktree at `root` is packed into `temporary`.
 */
export async function packageArchive(
  root: string,
  temporary: string,
  supplied: string | undefined,
): Promise<string> {
  if (supplied !== undefined) {
    if (supplied.length === 0) {
      throw new Error("PI_PACKAGE_ARCHIVE must not be empty.");
    }
    const candidate = resolve(supplied);
    const info = await stat(candidate);
    if (!info.isFile()) {
      throw new Error(`PI_PACKAGE_ARCHIVE ${candidate} is not a regular file.`);
    }
    if (info.size === 0) {
      throw new Error(`PI_PACKAGE_ARCHIVE ${candidate} is empty.`);
    }
    return realpath(candidate);
  }
  const output = execFileSync(
    "npm",
    [
      "pack",
      "--json",
      "--ignore-scripts",
      "--allow-directory=all",
      "--pack-destination",
      temporary,
    ],
    { cwd: root, encoding: "utf8" },
  );
  const parsed: unknown = JSON.parse(output);
  const filename = Array.isArray(parsed) && parsed.length === 1 ? packedFilename(parsed[0]) : "";
  if (filename.length === 0) {
    throw new Error("npm pack did not report exactly one package.");
  }
  return join(temporary, filename);
}

function packedFilename(value: unknown): string {
  if (typeof value !== "object" || value === null || !("filename" in value)) return "";
  return typeof value.filename === "string" ? value.filename : "";
}

export function archiveEntries(archive: string): string[] {
  return execFileSync("tar", ["-tzf", archive], { encoding: "utf8", stdio: "pipe" })
    .trim()
    .split("\n")
    .sort();
}
