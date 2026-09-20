import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import extension, {
  type BeforeProviderRequestHandler,
  type JsonValue,
  type PromptPatcherApi,
  type PromptPatcherContext,
} from "../extensions/index.ts";

const SETTINGS_FILE = "pi-system-prompt-patcher.json";
const CULT_FIXTURE_FILE = "cult-system-prompt-replacements.json";
const CULT_FIXTURE_URL = new URL(`./fixtures/${CULT_FIXTURE_FILE}`, import.meta.url);

type Replacement = {
  target: string;
  replacement: string;
};

test("ignores payloads without system instructions", () => {
  const handler = registerExtension();
  const { ctx, notifications } = createContext();

  const result = handler(
    {
      payload: {
        instructions: "unchanged",
        messages: [{ role: "user", content: "unchanged" }],
      },
    },
    ctx,
  );

  assert.equal(result, undefined);
  assert.deepEqual(notifications, []);
});

test("ignores providers without a configured replacement file", () => {
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

test("applies ordered replacements from the provider file", () => {
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

test("uses an exact model file instead of the provider file", () => {
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

test("falls back to the provider file when the model is not configured", () => {
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

test("supports providers configured only for specific models", () => {
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

test("patches text blocks without mutating the provider payload", () => {
  withProviderReplacements([{ target: "old", replacement: "new" }], () => {
    const handler = registerExtension();
    const { ctx } = createContext();
    const textBlock = { type: "text", text: "old value", cache_control: { type: "ephemeral" } };
    const payload = {
      system: [textBlock, { type: "image", source: "preserved" }, "preserved"],
    };

    const result = handler({ payload }, ctx);

    assert.deepEqual(result, {
      system: [
        { type: "text", text: "new value", cache_control: { type: "ephemeral" } },
        { type: "image", source: "preserved" },
        "preserved",
      ],
    });
    assert.equal(textBlock.text, "old value");
  });
});

test("patches every system instruction without changing conversation or tool blocks", () => {
  withProviderReplacements([{ target: "old", replacement: "new" }], () => {
    const handler = registerExtension();
    const { ctx, aborts, notifications } = createContext();
    const toolAddition = {
      type: "tool_addition",
      tool: { type: "tool_reference", name: "old" },
    };
    const toolRemoval = {
      type: "tool_removal",
      tool: { type: "tool_reference", name: "old" },
    };
    const payload = {
      system: [{ type: "text", text: "old base" }],
      messages: [
        { role: "user", content: "old user" },
        { role: "assistant", content: [{ type: "text", text: "old response" }] },
        { role: "system", content: "old update old" },
        {
          role: "system",
          content: [
            { type: "text", text: "old section", cache_control: { type: "ephemeral" } },
            toolAddition,
            toolRemoval,
            { type: "other", text: "old metadata" },
          ],
        },
      ],
    };
    const original = structuredClone(payload);

    const result = handler({ payload }, ctx);

    assert.deepEqual(result, {
      system: [{ type: "text", text: "new base" }],
      messages: [
        original.messages[0],
        original.messages[1],
        { role: "system", content: "new update new" },
        {
          role: "system",
          content: [
            { type: "text", text: "new section", cache_control: { type: "ephemeral" } },
            toolAddition,
            toolRemoval,
            { type: "other", text: "old metadata" },
          ],
        },
      ],
    });
    assert.deepEqual(payload, original);
    assert.equal(aborts.count, 0);
    assert.deepEqual(notifications, []);
  });
});

test("applies ordered replacements across separate system instruction fragments", () => {
  withProviderReplacements(
    [
      { target: "alpha", replacement: "beta" },
      { target: "beta", replacement: "gamma" },
      { target: "later", replacement: "updated" },
    ],
    () => {
      const handler = registerExtension();
      const { ctx } = createContext();
      const payload = {
        system: "alpha",
        messages: [
          { role: "system", content: [{ type: "text", text: "beta later" }] },
          { role: "user", content: "alpha beta later" },
        ],
      };

      assert.deepEqual(handler({ payload }, ctx), {
        system: "gamma",
        messages: [
          { role: "system", content: [{ type: "text", text: "gamma updated" }] },
          { role: "user", content: "alpha beta later" },
        ],
      });
    },
  );
});

test("patches system messages when the top-level system field is absent", () => {
  withProviderReplacements([{ target: "old", replacement: "new" }], () => {
    const handler = registerExtension();
    const { ctx } = createContext();
    const payload = {
      messages: [
        { role: "system", content: "old" },
        { role: "system", content: [{ type: "text", text: "old" }] },
      ],
    };

    assert.deepEqual(handler({ payload }, ctx), {
      messages: [
        { role: "system", content: "new" },
        { role: "system", content: [{ type: "text", text: "new" }] },
      ],
    });
    assert.equal(Object.hasOwn(payload, "system"), false);
  });
});

test("does not accept target matches in conversation or tool metadata", (t) => {
  t.mock.method(console, "error", () => {});
  withProviderReplacements([{ target: "missing", replacement: "new" }], () => {
    const handler = registerExtension();
    const { ctx, aborts, notifications } = createContext();
    const payload = {
      system: "base",
      messages: [
        { role: "user", content: "missing" },
        { role: "assistant", content: [{ type: "text", text: "missing" }] },
        {
          role: "system",
          content: [
            { type: "tool_addition", tool: { type: "tool_reference", name: "missing" } },
            { type: "other", text: "missing" },
          ],
        },
      ],
    };

    assert.equal(handler({ payload }, ctx), undefined);
    assert.equal(aborts.count, 1);
    assert.match(getOnlyNotification(notifications), /replacement 1 target was not found/);
  });
});

test("discards patches to all system fragments when a later target is absent", (t) => {
  t.mock.method(console, "error", () => {});
  withProviderReplacements(
    [
      { target: "present", replacement: "patched" },
      { target: "missing", replacement: "unused" },
    ],
    () => {
      const handler = registerExtension();
      const { ctx, aborts, notifications } = createContext();
      const payload = {
        system: "present",
        messages: [
          { role: "system", content: "present" },
          { role: "system", content: [{ type: "text", text: "present" }] },
        ],
      };
      const original = structuredClone(payload);

      assert.equal(handler({ payload }, ctx), undefined);
      assert.deepEqual(payload, original);
      assert.equal(aborts.count, 1);
      assert.match(getOnlyNotification(notifications), /replacement 2 target was not found/);
    },
  );
});

test("loads the representative cult replacement fixture", () => {
  const fixtureText = readFileSync(CULT_FIXTURE_URL, "utf8");
  const replacements = parseReplacements(fixtureText);
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

test("aborts the turn and leaves the payload unchanged when a target is missing", (t) => {
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
      const notification = getOnlyNotification(notifications);
      assert.match(notification, /replacement 2 target was not found/);
      assert.match(notification, /Missing target: "missing"/);
      assert.deepEqual(errors, notifications);
    },
  );
});

test("reports invalid settings and sends the original request", (t) => {
  withFiles({ providers: [] }, {}, () => {
    t.mock.method(console, "error", () => {});
    const handler = registerExtension();
    const { ctx, aborts, notifications } = createContext();

    const result = handler({ payload: { system: "old" } }, ctx);

    assert.equal(result, undefined);
    assert.equal(aborts.count, 0);
    assert.match(getOnlyNotification(notifications), /must contain a providers object/);
  });
});

test("reports an invalid replacement file and sends the original request", (t) => {
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
      assert.match(getOnlyNotification(notifications), /must contain an array/);
    },
  );
});

function registerExtension(): BeforeProviderRequestHandler {
  let handler: BeforeProviderRequestHandler | undefined;
  const pi: PromptPatcherApi = {
    on(_event, candidate) {
      handler = candidate;
    },
  };

  extension(pi);

  assert.ok(handler);
  return handler;
}

function getOnlyNotification(notifications: string[]): string {
  assert.equal(notifications.length, 1);
  const notification = notifications[0];
  assert.ok(notification);
  return notification;
}

function createContext(model = { provider: "cult", id: "ritual-1" }) {
  const aborts = { count: 0 };
  const notifications: string[] = [];
  const ctx: PromptPatcherContext = {
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
  };

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

function withFiles(
  settings: JsonValue,
  replacementFiles: Record<string, JsonValue>,
  run: () => void,
) {
  const directory = mkdtempSync(join(tmpdir(), "pi-system-prompt-patcher-"));
  const previousAgentDir = process.env["PI_CODING_AGENT_DIR"];

  try {
    process.env["PI_CODING_AGENT_DIR"] = directory;
    writeFileSync(join(directory, SETTINGS_FILE), JSON.stringify(settings), "utf8");
    for (const [file, contents] of Object.entries(replacementFiles)) {
      writeFileSync(
        join(directory, file),
        isString(contents) ? contents : JSON.stringify(contents),
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

function parseReplacements(value: string): Replacement[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every(isReplacement)) {
    throw new Error("Expected a replacement array.");
  }
  return parsed;
}

function isReplacement(value: unknown): value is Replacement {
  return (
    typeof value === "object" &&
    value !== null &&
    "target" in value &&
    "replacement" in value &&
    typeof value.target === "string" &&
    typeof value.replacement === "string"
  );
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
