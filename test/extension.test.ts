import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import extension from "../extensions/pi-system-prompt-patcher/index.ts";

const SETTINGS_FILE = "pi-system-prompt-patcher.json";
const CULT_FIXTURE_FILE = "cult-system-prompt-replacements.json";
const CULT_FIXTURE_URL = new URL(`./fixtures/${CULT_FIXTURE_FILE}`, import.meta.url);

type BeforeProviderRequestEvent = {
  payload: unknown;
};

type BeforeProviderRequestHandler = (
  event: BeforeProviderRequestEvent,
  ctx: ExtensionContext,
) => unknown;

type Replacement = {
  target: string;
  replacement: string;
};

void test("ignores payloads without a system field", () => {
  const handler = registerExtension();
  const { ctx, notifications } = createContext();

  const result = handler({ payload: { instructions: "unchanged" } }, ctx);

  assert.equal(result, undefined);
  assert.deepEqual(notifications, []);
});

void test("ignores providers without a configured replacement file", () => {
  withFiles(
    {
      providers: {
        cult: {
          replacementFile: "cult.json",
        },
      },
    },
    {},
    () => {
      const handler = registerExtension();
      const { ctx, notifications } = createContext({
        provider: "other-provider",
        id: "other-model",
      });

      const result = handler({ payload: { system: "unchanged" } }, ctx);

      assert.equal(result, undefined);
      assert.deepEqual(notifications, []);
    },
  );
});

void test("applies ordered replacements from the provider file", () => {
  withProviderReplacements(
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

void test("uses an exact model file instead of the provider file", () => {
  withFiles(
    {
      providers: {
        cult: {
          replacementFile: "provider.json",
          models: {
            "ritual-2": "model.json",
          },
        },
      },
    },
    {
      "provider.json": [{ target: "old", replacement: "provider" }],
      "model.json": [{ target: "old", replacement: "model" }],
    },
    () => {
      const handler = registerExtension();
      const { ctx } = createContext({ provider: "cult", id: "ritual-2" });

      const result = handler({ payload: { system: "old" } }, ctx);

      assert.deepEqual(result, { system: "model" });
    },
  );
});

void test("falls back to the provider file when the model is not configured", () => {
  withFiles(
    {
      providers: {
        cult: {
          replacementFile: "provider.json",
          models: {
            "ritual-2": "model.json",
          },
        },
      },
    },
    {
      "provider.json": [{ target: "old", replacement: "provider" }],
      "model.json": [{ target: "old", replacement: "model" }],
    },
    () => {
      const handler = registerExtension();
      const { ctx } = createContext({ provider: "cult", id: "ritual-1" });

      const result = handler({ payload: { system: "old" } }, ctx);

      assert.deepEqual(result, { system: "provider" });
    },
  );
});

void test("supports providers configured only for specific models", () => {
  withFiles(
    {
      providers: {
        cult: {
          models: {
            "ritual-2": "model.json",
          },
        },
      },
    },
    {
      "model.json": [{ target: "old", replacement: "model" }],
    },
    () => {
      const handler = registerExtension();
      const configured = createContext({ provider: "cult", id: "ritual-2" });
      const unconfigured = createContext({ provider: "cult", id: "ritual-1" });

      assert.deepEqual(handler({ payload: { system: "old" } }, configured.ctx), {
        system: "model",
      });
      assert.equal(handler({ payload: { system: "old" } }, unconfigured.ctx), undefined);
      assert.deepEqual(unconfigured.notifications, []);
    },
  );
});

void test("patches text blocks without mutating the provider payload", () => {
  withProviderReplacements([{ target: "old", replacement: "new" }], () => {
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

void test("loads the representative cult replacement fixture", () => {
  const fixtureText = readFileSync(CULT_FIXTURE_URL, "utf8");
  const replacements = JSON.parse(fixtureText) as Replacement[];
  const original = replacements.map(({ target }) => target).join("\n");
  const expected = replacements.reduce(
    (text, { target, replacement }) => text.replaceAll(target, replacement),
    original,
  );

  withFiles(
    {
      providers: {
        cult: {
          replacementFile: CULT_FIXTURE_FILE,
        },
      },
    },
    {
      [CULT_FIXTURE_FILE]: fixtureText,
    },
    () => {
      const handler = registerExtension();
      const { ctx } = createContext();

      const result = handler({ payload: { system: original } }, ctx);

      assert.deepEqual(result, { system: expected });
    },
  );
});

void test("aborts the turn and leaves the payload unchanged when a target is missing", (t) => {
  withProviderReplacements(
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

void test("reports invalid settings and sends the original request", (t) => {
  withFiles({ providers: [] }, {}, () => {
    t.mock.method(console, "error", () => {});
    const handler = registerExtension();
    const { ctx, aborts, notifications } = createContext();

    const result = handler({ payload: { system: "old" } }, ctx);

    assert.equal(result, undefined);
    assert.equal(aborts.count, 0);
    assert.equal(notifications.length, 1);
    assert.match(notifications[0]!, /must contain a providers object/);
  });
});

void test("reports an invalid replacement file and sends the original request", (t) => {
  withFiles(
    {
      providers: {
        cult: {
          replacementFile: "invalid.json",
        },
      },
    },
    {
      "invalid.json": { target: "old", replacement: "new" },
    },
    () => {
      t.mock.method(console, "error", () => {});
      const handler = registerExtension();
      const { ctx, aborts, notifications } = createContext();

      const result = handler({ payload: { system: "old" } }, ctx);

      assert.equal(result, undefined);
      assert.equal(aborts.count, 0);
      assert.equal(notifications.length, 1);
      assert.match(notifications[0]!, /must contain an array/);
    },
  );
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

function createContext(model = { provider: "cult", id: "ritual-1" }) {
  const aborts = { count: 0 };
  const notifications: string[] = [];
  const ctx = {
    hasUI: true,
    model,
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

function withProviderReplacements(replacements: Replacement[], run: () => void) {
  withFiles(
    {
      providers: {
        cult: {
          replacementFile: "replacements.json",
        },
      },
    },
    {
      "replacements.json": replacements,
    },
    run,
  );
}

function withFiles(settings: unknown, replacementFiles: Record<string, unknown>, run: () => void) {
  const directory = mkdtempSync(join(tmpdir(), "pi-system-prompt-patcher-"));
  const previousAgentDir = process.env["PI_CODING_AGENT_DIR"];

  try {
    process.env["PI_CODING_AGENT_DIR"] = directory;
    writeFileSync(join(directory, SETTINGS_FILE), JSON.stringify(settings), "utf8");
    for (const [file, contents] of Object.entries(replacementFiles)) {
      writeFileSync(
        join(directory, file),
        typeof contents === "string" ? contents : JSON.stringify(contents),
        "utf8",
      );
    }
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
