import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { RpcClient } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/rpc/rpc-client.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test(
  "published Patcher works through the Pi 0.87 CLI and live Anthropic",
  {
    skip: process.env["PI_PATCHER_LIVE_TEST"] !== "1",
    timeout: 240_000,
  },
  async (t) => {
    const token = process.env["PI_PATCHER_LIVE_API_KEY"];
    assert.ok(token, "PI_PATCHER_LIVE_API_KEY is required");
    const temporary = await mkdtemp(join(tmpdir(), "patcher-cli-live-"));
    t.after(() => rm(temporary, { recursive: true, force: true }));
    let archive = process.env["PI_PACKAGE_ARCHIVE"];
    if (!archive) {
      execFileSync(
        "npm",
        ["pack", "--ignore-scripts", "--allow-directory=all", "--pack-destination", temporary],
        { cwd: root, stdio: "pipe" },
      );
      const manifest: unknown = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
      assert.ok(manifest && typeof manifest === "object" && "version" in manifest);
      assert.ok(typeof manifest.version === "string");
      archive = join(temporary, `pi-system-prompt-patcher-${manifest.version}.tgz`);
    }
    const files = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" })
      .trim()
      .split("\n")
      .sort();
    const expected = (await readFile(join(root, ".github/npm-package-files"), "utf8"))
      .trim()
      .split("\n")
      .map((file) => `package/${file}`)
      .sort();
    assert.deepEqual(files, expected);
    execFileSync("tar", ["-xzf", archive, "-C", temporary]);
    const cli = await realpath(
      process.env["PI_TEST_CLI_PATH"] ??
        join(root, "node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js"),
    );
    const piRoot = resolve(dirname(cli), "../..");
    const env = {
      HOME: temporary,
      PI_CODING_AGENT_DIR: join(temporary, "agent"),
      PI_PACKAGE_DIR: piRoot,
      PI_OFFLINE: "1",
      PI_TELEMETRY: "0",
      PI_PATCHER_LIVE_API_KEY: token,
    };
    assert.equal(
      execFileSync(process.execPath, [cli, "--version"], {
        env: { ...process.env, ...env },
        encoding: "utf8",
      }).trim(),
      "0.87.0",
    );
    await mkdir(env.PI_CODING_AGENT_DIR);
    await writeFile(
      join(env.PI_CODING_AGENT_DIR, "models.json"),
      JSON.stringify({
        providers: { anthropic: { apiKey: "$PI_PATCHER_LIVE_API_KEY" } },
      }),
    );
    await writeFile(
      join(env.PI_CODING_AGENT_DIR, "settings.json"),
      JSON.stringify({
        retry: { enabled: false, provider: { timeoutMs: 60_000, maxRetries: 0 } },
        compaction: { enabled: false },
      }),
    );
    await writeFile(
      join(env.PI_CODING_AGENT_DIR, "SYSTEM.md"),
      "Reply with exactly ORIGINAL_MARKER and no other text.",
    );
    await writeFile(
      join(env.PI_CODING_AGENT_DIR, "pi-system-prompt-patcher.json"),
      JSON.stringify({
        providers: { anthropic: { replacementFile: "replacements.json" } },
      }),
    );
    const replacements = join(env.PI_CODING_AGENT_DIR, "replacements.json");
    await writeFile(
      replacements,
      JSON.stringify([{ target: "ORIGINAL_MARKER", replacement: "PATCH_FIRST" }]),
    );
    const options = {
      cliPath: cli,
      cwd: temporary,
      env,
      provider: "anthropic",
      model: "claude-sonnet-5",
      args: [
        "--offline",
        "--no-skills",
        "--no-prompt-templates",
        "--no-context-files",
        "--no-tools",
        "--thinking",
        "low",
        "--session",
        join(temporary, "session.jsonl"),
        "-e",
        join(temporary, "package"),
        "-e",
        join(root, "test/fixtures/cli-observer.ts"),
      ],
    };
    let client = new RpcClient(options);
    t.after(async () => client.stop());
    await client.start();
    async function turn(expectedMarker: string): Promise<void> {
      const events = await client.promptAndWait(
        "Return the marker required by your system instructions.",
        undefined,
        90_000,
      );
      assert.deepEqual(
        events.filter((event: { type: string }) => event.type === "extension_error"),
        [],
      );
      const assistants = (await client.getMessages()).filter(
        (message) => message.role === "assistant",
      );
      const assistant = assistants.at(-1);
      assert.ok(assistant);
      assert.equal(assistant.errorMessage, undefined);
      assert.equal(await client.getLastAssistantText(), expectedMarker);
      const observations = (await client.getEntries()).entries.filter(
        (entry) => entry.type === "custom" && entry.customType === "release-test-system",
      );
      const latest = observations.at(-1);
      assert.ok(latest?.type === "custom");
      assert.deepEqual(latest.data, { marker: expectedMarker });
      assert.doesNotMatch(client.getStderr(), /Failed to load extension|not a function/);
    }
    await turn("PATCH_FIRST");
    await writeFile(
      replacements,
      JSON.stringify([{ target: "ORIGINAL_MARKER", replacement: "PATCH_SECOND" }]),
    );
    await turn("PATCH_SECOND");
    await writeFile(
      join(env.PI_CODING_AGENT_DIR, "SYSTEM.md"),
      "Current instruction: reply with exactly ORIGINAL_MARKER and no other text.",
    );
    await client.prompt("/release-test-reload");
    await turn("PATCH_SECOND");
    await client.stop();
    client = new RpcClient(options);
    await client.start();
    await turn("PATCH_SECOND");
    await client.stop();
    t.diagnostic(
      "Pi 0.87.0: packed extension, real Anthropic payloads, config reload, prompt reload, and resume passed",
    );
  },
);
