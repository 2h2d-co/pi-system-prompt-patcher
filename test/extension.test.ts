import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import extension from "../extensions/pi-system-prompt-patcher/index.ts";

const CONFIG_FILE = "pi-system-prompt-patcher.json";

type BeforeProviderRequestEvent = {
  payload: unknown;
};

type BeforeProviderRequestHandler = (
  event: BeforeProviderRequestEvent,
  ctx: ExtensionContext,
) => unknown;

void test("ignores payloads without a system field", () => {
  const handler = registerExtension();
  const { ctx, notifications } = createContext();

  const result = handler({ payload: { instructions: "unchanged" } }, ctx);

  assert.equal(result, undefined);
  assert.deepEqual(notifications, []);
});

void test("applies ordered replacements to every match in a string prompt", () => {
  withConfig(
    [
      { target: "alpha", replacement: "beta" },
      { target: "beta", replacement: "gamma" },
    ],
    () => {
      const handler = registerExtension();
      const { ctx } = createContext();
      const payload = { system: "alpha alpha beta", metadata: "preserved" };

      const result = handler({ payload }, ctx);

      assert.deepEqual(result, {
        system: "gamma gamma gamma",
        metadata: "preserved",
      });
      assert.deepEqual(payload, { system: "alpha alpha beta", metadata: "preserved" });
    },
  );
});

void test("patches text blocks without mutating the provider payload", () => {
  withConfig([{ target: "old", replacement: "new" }], () => {
    const handler = registerExtension();
    const { ctx } = createContext();
    const payload = {
      system: [
        { type: "text", text: "old value", cache_control: { type: "ephemeral" } },
        { type: "image", source: "preserved" },
        "preserved",
      ],
    };

    const result = handler({ payload }, ctx);

    assert.deepEqual(result, {
      system: [
        { type: "text", text: "new value", cache_control: { type: "ephemeral" } },
        { type: "image", source: "preserved" },
        "preserved",
      ],
    });
    assert.equal((payload.system[0] as { text: string }).text, "old value");
  });
});

void test("aborts the turn and leaves the payload unchanged when a target is missing", (t) => {
  withConfig(
    [
      { target: "present", replacement: "patched" },
      { target: "missing", replacement: "unused" },
    ],
    () => {
      const errors: string[] = [];
      t.mock.method(console, "error", (message: string) => errors.push(message));
      const handler = registerExtension();
      const { ctx, aborts, notifications } = createContext();
      const payload = { system: "present" };

      const result = handler({ payload }, ctx);

      assert.equal(result, undefined);
      assert.deepEqual(payload, { system: "present" });
      assert.equal(aborts.count, 1);
      assert.equal(notifications.length, 1);
      assert.match(notifications[0]!, /replacement 2 target was not found/);
      assert.match(notifications[0]!, /Missing target: "missing"/);
      assert.deepEqual(errors, notifications);
    },
  );
});

void test("reports invalid configuration and sends the original request", (t) => {
  withConfig({ target: "old", replacement: "new" }, () => {
    t.mock.method(console, "error", () => {});
    const handler = registerExtension();
    const { ctx, aborts, notifications } = createContext();

    const result = handler({ payload: { system: "old" } }, ctx);

    assert.equal(result, undefined);
    assert.equal(aborts.count, 0);
    assert.equal(notifications.length, 1);
    assert.match(notifications[0]!, /must contain an array/);
  });
});

function registerExtension(): BeforeProviderRequestHandler {
  let handler: BeforeProviderRequestHandler | undefined;
  const pi = {
    on(event: string, candidate: BeforeProviderRequestHandler) {
      if (event === "before_provider_request") {
        handler = candidate;
      }
    },
  } as unknown as ExtensionAPI;

  extension(pi);

  assert.ok(handler);
  return handler;
}

function createContext() {
  const aborts = { count: 0 };
  const notifications: string[] = [];
  const ctx = {
    hasUI: true,
    abort() {
      aborts.count += 1;
    },
    ui: {
      notify(message: string) {
        notifications.push(message);
      },
    },
  } as unknown as ExtensionContext;

  return { ctx, aborts, notifications };
}

function withConfig(config: unknown, run: () => void) {
  const directory = mkdtempSync(join(tmpdir(), "pi-system-prompt-patcher-"));
  const previousAgentDir = process.env["PI_CODING_AGENT_DIR"];

  try {
    process.env["PI_CODING_AGENT_DIR"] = directory;
    writeFileSync(join(directory, CONFIG_FILE), JSON.stringify(config), "utf8");
    run();
  } finally {
    if (previousAgentDir === undefined) {
      delete process.env["PI_CODING_AGENT_DIR"];
    } else {
      process.env["PI_CODING_AGENT_DIR"] = previousAgentDir;
    }
    rmSync(directory, { recursive: true, force: true });
  }
}
