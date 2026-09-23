import assert from "node:assert/strict";
import childProcess, { type SpawnSyncOptions } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

// These tests evaluate scripts/release.ts with every child process intercepted. No real
// Git, npm, Mise, Pi, or provider call happens, and no temporary archive survives.
const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const packageName = "pi-system-prompt-patcher";
const releasedVersion = manifestVersion();
const candidate = "synthetic release archive";
const digest = createHash("sha256").update(candidate).digest("hex");
const files = readFileSync(join(root, ".github/npm-package-files"), "utf8")
  .trim()
  .split("\n")
  .map((path) => ({ path, mode: 0o644 }));

type Scenario = {
  branch?: string;
  status?: string;
  originMain?: string;
  tagExists?: boolean;
  live?: number | "spawn-error";
  rebuild?: string;
  version?: string;
};

type Harness = {
  calls: string[];
  archives: string[];
  cwds: Map<string, string>;
  liveEnv: NodeJS.ProcessEnv | undefined;
  liveArchive: string | undefined;
  liveContents: string | undefined;
  spawnError: Error;
  signed: () => boolean;
  run: () => Promise<unknown>;
};

function manifestVersion(): string {
  const manifest: unknown = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.ok(manifest && typeof manifest === "object" && "version" in manifest);
  assert.ok(typeof manifest.version === "string");
  return manifest.version;
}

function harness(t: TestContext, scenario: Scenario): Harness {
  const version = scenario.version ?? releasedVersion;
  const tag = `v${version}`;
  const previousArgv = process.argv;
  const previousNpm = process.env["npm_execpath"];
  const calls: string[] = [];
  const archives: string[] = [];
  const cwds = new Map<string, string>();
  const spawnError = Object.assign(new Error("spawn mise ENOENT"), { code: "ENOENT" });
  let signed = false;
  let liveEnv: NodeJS.ProcessEnv | undefined;
  let liveArchive: string | undefined;
  let liveContents: string | undefined;
  process.argv = [process.execPath, join(root, "scripts/release.ts"), version];
  process.env["npm_execpath"] = "synthetic-npm";
  // The release script reports its result through console.log; keep the test output clean.
  t.mock.method(console, "log", () => undefined);
  const mocked = t.mock.method(
    childProcess,
    "spawnSync",
    (command: string, args: string[] = [], options: SpawnSyncOptions = {}) => {
      const operation =
        command === process.execPath
          ? ["npm", ...args.slice(1)].join(" ")
          : [command, ...args].join(" ");
      calls.push(operation);
      cwds.set(operation, String(options.cwd));
      let stdout = "";
      let status: number | null = 0;
      let error: Error | undefined;
      if (command === "git") {
        assert.equal(options.cwd, root);
        const verb = args[0];
        if (verb === "branch") stdout = scenario.branch ?? "main";
        else if (verb === "status") stdout = scenario.status ?? "";
        else if (verb === "fetch" || verb === "add" || verb === "checkout-index") stdout = "";
        else if (verb === "rev-parse" && args.includes("--verify")) {
          status = scenario.tagExists ? 0 : 1;
        } else if (verb === "rev-parse" && args.includes("origin/main")) {
          stdout = scenario.originMain ?? "initial-commit";
        } else if (verb === "rev-parse") stdout = signed ? "release-commit" : "initial-commit";
        else if (verb === "diff") stdout = "package-lock.json\npackage.json";
        else if (verb === "commit") signed = true;
        else if (verb === "-c" || verb === "tag") stdout = "";
        else if (verb === "cat-file") stdout = "commit";
        else if (verb === "log") {
          stdout = args.includes("--pretty=%s") ? `release: ${tag}` : digest;
        } else throw new Error(`Unexpected Git command: ${operation}`);
      } else if (command === process.execPath) {
        assert.equal(args[0], "synthetic-npm");
        assert.equal(typeof options.cwd, "string");
        const cwd = String(options.cwd);
        const verb = args[1];
        if (verb === "version") {
          assert.equal(cwd, root);
          assert.deepEqual(args.slice(2), [version, "--no-git-tag-version", "--ignore-scripts"]);
        } else if (verb === "ci") {
          assert.notEqual(cwd, root);
          writeFileSync(join(cwd, "package.json"), JSON.stringify({ scripts: {} }));
        } else if (verb === "pack") {
          assert.notEqual(cwd, root);
          const output = args[args.indexOf("--pack-destination") + 1];
          assert.ok(output);
          const filename = `${packageName}-${version}.tgz`;
          const archive = join(output, filename);
          const contents = archives.length === 0 ? candidate : (scenario.rebuild ?? candidate);
          writeFileSync(archive, contents);
          archives.push(archive);
          stdout = JSON.stringify([{ name: packageName, version, filename, files }]);
        } else throw new Error(`Unexpected npm command: ${operation}`);
      } else if (command === "mise") {
        assert.deepEqual(args, ["run", "test:live"]);
        liveEnv = options.env;
        liveArchive = options.env?.["PI_PACKAGE_ARCHIVE"];
        // The candidate must exist while the live validation runs.
        liveContents = liveArchive === undefined ? undefined : readFileSync(liveArchive, "utf8");
        if (scenario.live === "spawn-error") {
          error = spawnError;
          status = null;
        } else {
          status = scenario.live ?? 0;
        }
      } else throw new Error(`Unexpected child command: ${operation}`);
      return {
        pid: 0,
        output: [null, stdout, ""],
        stdout,
        stderr: "",
        status,
        signal: null,
        error,
      };
    },
  );
  syncBuiltinESMExports();
  t.after(() => {
    mocked.mock.restore();
    syncBuiltinESMExports();
    process.argv = previousArgv;
    if (previousNpm === undefined) delete process.env["npm_execpath"];
    else process.env["npm_execpath"] = previousNpm;
  });
  const script = new URL(`../scripts/release.ts?scenario=${t.name}`, import.meta.url);
  return {
    calls,
    archives,
    cwds,
    get liveEnv() {
      return liveEnv;
    },
    get liveArchive() {
      return liveArchive;
    },
    get liveContents() {
      return liveContents;
    },
    spawnError,
    signed: () => signed,
    run: () => import(script.href),
  };
}

function liveCalls(calls: string[]): number {
  return calls.filter((call) => call === "mise run test:live").length;
}

test("release validates the exact candidate archive once before signing and tagging", async (t) => {
  const release = harness(t, {});
  await release.run();
  assert.equal(liveCalls(release.calls), 1);
  assert.equal(release.cwds.get("mise run test:live"), root);
  assert.equal(release.liveArchive, release.archives[0]);
  assert.ok(release.liveArchive?.startsWith("/"));
  assert.equal(release.liveContents, candidate);
  assert.equal(release.liveEnv?.["npm_execpath"], "synthetic-npm");
  assert.ok(release.signed());
  assert.ok(release.calls.includes(`git tag v${releasedVersion}`));
  assert.equal(release.archives.length, 2);
  assert.ok(release.archives.every((archive) => !existsSync(archive)));
  const liveIndex = release.calls.indexOf("mise run test:live");
  const commitIndex = release.calls.findIndex((call) => call.startsWith("git commit "));
  const rebuildIndex = release.calls.findLastIndex((call) =>
    call.startsWith("git checkout-index "),
  );
  const tagIndex = release.calls.indexOf(`git tag v${releasedVersion}`);
  assert.ok(liveIndex < commitIndex && commitIndex < rebuildIndex && rebuildIndex < tagIndex);
  assert.match(
    release.calls[commitIndex] ?? "",
    new RegExp(
      `^git commit -S -m release: v${releasedVersion.replaceAll(".", "\\.")} -m Npm-Artifact-SHA256: ${digest}$`,
    ),
  );
});

test("release stops before signing when the live validation exits nonzero", async (t) => {
  const release = harness(t, { live: 1 });
  await assert.rejects(release.run(), /mise run test:live exited with 1/);
  assert.equal(liveCalls(release.calls), 1);
  assert.ok(release.calls.some((call) => call.startsWith("npm version ")));
  assert.ok(release.calls.includes("git add package-lock.json package.json"));
  assert.equal(release.signed(), false);
  assert.ok(!release.calls.some((call) => call.startsWith("git commit ")));
  assert.ok(!release.calls.some((call) => call.startsWith("git tag ")));
  assert.equal(release.archives.length, 1);
  assert.ok(release.archives.every((archive) => !existsSync(archive)));
});

test("release stops before signing when the live validation cannot start", async (t) => {
  const release = harness(t, { live: "spawn-error" });
  await assert.rejects(release.run(), (error: unknown) => error === release.spawnError);
  assert.equal(liveCalls(release.calls), 1);
  assert.equal(release.signed(), false);
  assert.ok(!release.calls.some((call) => call.startsWith("git tag ")));
  assert.equal(release.archives.length, 1);
});

for (const [description, scenario, message] of [
  ["a branch other than main", { branch: "topic" }, /must be created from main/],
  ["a dirty worktree or index", { status: " M README.md" }, /clean worktree and index/],
  ["a missing changelog section", { version: "9.9.9" }, /CHANGELOG\.md has no 9\.9\.9 section/],
  ["HEAD behind origin/main", { originMain: "remote-commit" }, /does not match origin\/main/],
  ["an existing release tag", { tagExists: true }, /already exists/],
] as const) {
  test(`release refuses ${description} before changing anything`, async (t) => {
    const release = harness(t, scenario);
    await assert.rejects(release.run(), message);
    assert.equal(liveCalls(release.calls), 0);
    assert.ok(!release.calls.some((call) => call.startsWith("npm ")));
    assert.ok(!release.calls.some((call) => call.startsWith("git add ")));
    assert.equal(release.signed(), false);
    assert.equal(release.archives.length, 0);
  });
}

test("release keeps the signed commit but refuses to tag an irreproducible rebuild", async (t) => {
  const release = harness(t, { rebuild: "different archive bytes" });
  await assert.rejects(release.run(), /not reproducible/);
  assert.equal(liveCalls(release.calls), 1);
  assert.ok(release.signed());
  assert.ok(!release.calls.some((call) => call.startsWith("git tag ")));
  assert.equal(release.archives.length, 2);
  assert.ok(release.archives.every((archive) => !existsSync(archive)));
});
