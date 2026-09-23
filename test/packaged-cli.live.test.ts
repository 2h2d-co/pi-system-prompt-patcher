import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { RpcClient } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/rpc/rpc-client.js";
import { archiveEntries, packageArchive } from "./package-archive.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const piVersion = "0.87.0";

function systemPrompt(revision: number): string {
  return `Reply with exactly ORIGINAL_MARKER and no other text. Prompt revision: PROMPT_REVISION_${revision}.`;
}

async function assistantTexts(client: RpcClient): Promise<string[]> {
  const texts: string[] = [];
  for (const message of await client.getMessages()) {
    if (message.role !== "assistant") continue;
    assert.equal(message.errorMessage, undefined);
    texts.push(
      message.content
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("")
        .trim(),
    );
  }
  return texts;
}

test(
  `packaged Patcher works through the Pi ${piVersion} CLI and live Anthropic`,
  {
    skip: process.env["PI_PATCHER_LIVE_TEST"] !== "1",
    timeout: 240_000,
  },
  async (t) => {
    const token = process.env["PI_PATCHER_LIVE_API_KEY"];
    assert.ok(token, "PI_PATCHER_LIVE_API_KEY is required");
    const temporary = await mkdtemp(join(tmpdir(), "patcher-cli-live-"));
    t.after(() => rm(temporary, { recursive: true, force: true }));
    const archive = await packageArchive(root, temporary, process.env["PI_PACKAGE_ARCHIVE"]);
    const files = archiveEntries(archive);
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
    // Bind the CLI's package metadata to the selected executable so an inherited
    // PI_PACKAGE_DIR cannot describe a different runtime.
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
      piVersion,
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
    const promptFile = join(env.PI_CODING_AGENT_DIR, "SYSTEM.md");
    await writeFile(promptFile, systemPrompt(1));
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
    const sessionFile = join(temporary, "session.jsonl");
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
        sessionFile,
        "-e",
        join(temporary, "package"),
        "-e",
        join(root, "test/fixtures/cli-observer.ts"),
      ],
    };
    let client = new RpcClient(options);
    t.after(async () => client.stop());
    await client.start();
    async function turn(expectedMarker: string, expectedRevision: number): Promise<void> {
      const events = await client.promptAndWait(
        "Return the marker required by your system instructions.",
        undefined,
        90_000,
      );
      assert.deepEqual(
        events.filter((event: { type: string }) => event.type === "extension_error"),
        [],
      );
      assert.equal(await client.getLastAssistantText(), expectedMarker);
      const observations = (await client.getEntries()).entries.filter(
        (entry) => entry.type === "custom" && entry.customType === "release-test-system",
      );
      const latest = observations.at(-1);
      assert.ok(latest?.type === "custom");
      assert.deepEqual(latest.data, { marker: expectedMarker, revision: expectedRevision });
      assert.doesNotMatch(client.getStderr(), /Failed to load extension|not a function/);
    }
    await turn("PATCH_FIRST", 1);
    await writeFile(
      replacements,
      JSON.stringify([{ target: "ORIGINAL_MARKER", replacement: "PATCH_SECOND" }]),
    );
    await turn("PATCH_SECOND", 1);
    // A reload must deliver the rewritten SYSTEM.md to the provider, not only re-run the
    // patcher against the previous prompt.
    await writeFile(promptFile, systemPrompt(2));
    await client.prompt("/release-test-reload");
    await turn("PATCH_SECOND", 2);
    const before = await client.getState();
    assert.ok(before.sessionFile);
    assert.equal(await realpath(before.sessionFile), await realpath(sessionFile));
    const history = await assistantTexts(client);
    assert.deepEqual(history, ["PATCH_FIRST", "PATCH_SECOND", "PATCH_SECOND"]);
    const entriesBefore = (await client.getEntries()).entries.map((entry) => entry.id);
    assert.ok(entriesBefore.length > 0);
    await client.stop();
    // A restart must resume the persisted session rather than start a fresh one.
    client = new RpcClient(options);
    await client.start();
    const after = await client.getState();
    assert.equal(after.sessionId, before.sessionId);
    assert.equal(after.sessionFile, before.sessionFile);
    assert.deepEqual(await assistantTexts(client), history);
    const entriesAfter = new Set((await client.getEntries()).entries.map((entry) => entry.id));
    assert.ok(entriesBefore.every((id) => entriesAfter.has(id)));
    await turn("PATCH_SECOND", 2);
    assert.deepEqual(await assistantTexts(client), [...history, "PATCH_SECOND"]);
    await client.stop();
    t.diagnostic(
      `Pi ${piVersion}: packed extension, real Anthropic payloads, config reload, prompt reload, and resume passed`,
    );
  },
);
