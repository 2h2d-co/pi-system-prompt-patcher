import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";
import { archiveEntries, packageArchive } from "./package-archive.ts";

// Each temporary directory has no package.json, so an accidental npm pack would fail.
async function workspace(t: { after: (fn: () => Promise<void>) => void }): Promise<string> {
  const temporary = await mkdtemp(join(tmpdir(), "patcher-archive-test-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  return temporary;
}

test("uses an absolute candidate without packing the working directory", async (t) => {
  const temporary = await workspace(t);
  const candidate = join(temporary, "candidate.tgz");
  await writeFile(candidate, "synthetic candidate");
  assert.equal(await packageArchive(temporary, temporary, candidate), await realpath(candidate));
  assert.equal(await readFile(candidate, "utf8"), "synthetic candidate");
  assert.deepEqual(await readdir(temporary), ["candidate.tgz"]);
});

test("resolves a relative candidate from the current working directory", async (t) => {
  const temporary = await workspace(t);
  const candidate = join(temporary, "candidate.tgz");
  await writeFile(candidate, "synthetic candidate");
  const supplied = relative(process.cwd(), candidate);
  assert.notEqual(supplied, candidate);
  assert.equal(await packageArchive(temporary, temporary, supplied), await realpath(candidate));
  assert.deepEqual(await readdir(temporary), ["candidate.tgz"]);
});

test("rejects an empty, missing, directory, or empty-file candidate without a fallback", async (t) => {
  const temporary = await workspace(t);
  await mkdir(join(temporary, "directory.tgz"));
  await writeFile(join(temporary, "empty.tgz"), "");
  await assert.rejects(packageArchive(temporary, temporary, ""), /must not be empty/);
  await assert.rejects(packageArchive(temporary, temporary, join(temporary, "missing.tgz")), {
    code: "ENOENT",
  });
  await assert.rejects(
    packageArchive(temporary, temporary, join(temporary, "directory.tgz")),
    /is not a regular file/,
  );
  await assert.rejects(
    packageArchive(temporary, temporary, join(temporary, "empty.tgz")),
    /is empty/,
  );
  assert.deepEqual((await readdir(temporary)).sort(), ["directory.tgz", "empty.tgz"]);
});

test("packs the working directory when no candidate is supplied", async (t) => {
  const temporary = await workspace(t);
  const source = join(temporary, "source");
  await mkdir(source);
  await writeFile(
    join(source, "package.json"),
    JSON.stringify({ name: "synthetic-live-test", version: "1.0.0" }),
  );
  const archive = await packageArchive(source, temporary, undefined);
  assert.equal(archive, join(temporary, "synthetic-live-test-1.0.0.tgz"));
  assert.ok((await readFile(archive)).length > 0);
  assert.deepEqual(archiveEntries(archive), ["package/package.json"]);
});

test("rejects malformed archive contents without packing another candidate", async (t) => {
  const temporary = await workspace(t);
  const candidate = join(temporary, "invalid.tgz");
  await writeFile(candidate, "not an archive");
  const archive = await packageArchive(temporary, temporary, candidate);
  assert.throws(() => archiveEntries(archive));
  assert.deepEqual(await readdir(temporary), ["invalid.tgz"]);
});
