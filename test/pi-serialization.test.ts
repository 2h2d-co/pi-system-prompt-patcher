import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import extension, {
  type BeforeProviderRequestHandler,
  type JsonObject,
  type JsonValue,
  type PromptPatcherContext,
} from "../extensions/index.ts";

for (const supportsMidConvoSystemMessages of [false, true]) {
  test(`patches Pi Anthropic serialization with mid-conversation support ${supportsMidConvoSystemMessages}`, async (t) => {
    const directory = mkdtempSync(join(tmpdir(), "pi-prompt-patcher-serialization-"));
    const previousAgentDir = process.env["PI_CODING_AGENT_DIR"];
    process.env["PI_CODING_AGENT_DIR"] = directory;
    t.after(() => {
      if (previousAgentDir === undefined) delete process.env["PI_CODING_AGENT_DIR"];
      else process.env["PI_CODING_AGENT_DIR"] = previousAgentDir;
      rmSync(directory, { recursive: true, force: true });
    });
    writeFileSync(
      join(directory, "pi-system-prompt-patcher.json"),
      JSON.stringify({ providers: { anthropic: { replacementFile: "replacements.json" } } }),
    );
    writeFileSync(
      join(directory, "replacements.json"),
      JSON.stringify([
        { target: "alpha", replacement: "patched" },
        { target: "later", replacement: "updated" },
      ]),
    );

    const runtime = await ModelRuntime.create({
      authPath: join(directory, "auth.json"),
      modelsPath: null,
      modelsStorePath: join(directory, "models-store.json"),
      allowModelNetwork: false,
    });
    await runtime.setRuntimeApiKey("anthropic", "synthetic-test-key");
    const baseModel = runtime.getModel("anthropic", "claude-sonnet-4-5");
    assert.ok(baseModel);
    const model = {
      ...baseModel,
      baseUrl: "https://example.invalid",
      compat: { ...baseModel.compat, supportsMidConvoSystemMessages },
    };
    const ctx: PromptPatcherContext = {
      model,
      hasUI: false,
      abort() {
        assert.fail("System instruction targets should all be present");
      },
      ui: {
        notify() {
          assert.fail("Valid replacements should not produce a notification");
        },
      },
    };
    let handler: BeforeProviderRequestHandler | undefined;
    extension({
      on(_event, candidate) {
        handler = candidate;
      },
    });
    assert.ok(handler);
    const patch = handler;
    let captured: JsonObject | undefined;
    const result = await runtime.completeSimple(
      model,
      {
        messages: [
          {
            role: "system",
            content: "alpha base",
            sections: { policy: "alpha initial" },
            timestamp: 0,
          },
          { role: "user", content: "alpha first user", timestamp: 1 },
          {
            role: "system",
            content: "",
            sections: { policy: "alpha later" },
            timestamp: 2,
          },
          { role: "user", content: "alpha second user", timestamp: 3 },
        ],
      },
      {
        onPayload(payload) {
          const original = structuredClone(payload);
          captured = patch({ payload }, ctx);
          assert.deepEqual(payload, original);
          // Capture the real serializer output without making a provider request.
          throw new Error("Synthetic request captured before transport");
        },
      },
    );

    assert.equal(result.stopReason, "error");
    assert.match(result.errorMessage ?? "", /Synthetic request captured before transport/);
    assert.ok(captured);
    assert.match(promptText(captured["system"]), /patched base/);
    const messages = captured["messages"];
    assert.ok(Array.isArray(messages));
    const systemMessages = messages.filter(
      (message) => isObject(message) && message["role"] === "system",
    );
    assert.equal(systemMessages.length, supportsMidConvoSystemMessages ? 1 : 0);
    const systemText = [
      promptText(captured["system"]),
      ...systemMessages.map((message) => (isObject(message) ? promptText(message["content"]) : "")),
    ].join("\n");
    assert.match(systemText, /patched updated/);
    assert.doesNotMatch(systemText, /alpha/);
    assert.ok(
      messages.some(
        (message) =>
          isObject(message) &&
          message["role"] === "user" &&
          promptText(message["content"]).includes("alpha first user"),
      ),
    );
  });
}

function promptText(content: JsonValue | undefined): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) =>
      isObject(block) && block["type"] === "text" && typeof block["text"] === "string"
        ? block["text"]
        : "",
    )
    .join("\n");
}

function isObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
