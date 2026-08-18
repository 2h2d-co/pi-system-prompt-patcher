import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const EXTENSION_ID = "pi-system-prompt-patcher";
const SETTINGS_FILE = `${EXTENSION_ID}.json`;

export type JsonPrimitive = boolean | null | number | string;

export type JsonValue = JsonObject | JsonPrimitive | JsonValue[];

export type JsonObject = {
  [key: string]: JsonValue;
};

export type PromptPatcherContext = {
  model: { provider: string; id: string } | undefined;
  hasUI: boolean;
  abort(): void;
  ui: {
    notify(message: string, level: "error"): void;
  };
};

export type BeforeProviderRequestHandler = (
  event: { payload: unknown },
  ctx: PromptPatcherContext,
) => JsonObject | undefined;

export type PromptPatcherApi = {
  on(event: "before_provider_request", handler: BeforeProviderRequestHandler): void;
};

type ProviderPayload = JsonObject & {
  system: JsonValue;
};

type Replacement = {
  target: string;
  replacement: string;
};

type ProviderSettings = {
  replacementFile?: string;
  models: Record<string, string>;
};

type Settings = {
  providers: Record<string, ProviderSettings>;
};

export default function systemPromptPatcher(pi: PromptPatcherApi) {
  pi.on("before_provider_request", (event, ctx) => {
    if (!ctx.model || !hasSystemField(event.payload)) {
      return;
    }

    const settingsPath = resolveSettingsPath();
    const settings = loadSettings(settingsPath, ctx);
    if (!settings) {
      return;
    }

    const configuredPath = selectReplacementFile(settings, ctx.model.provider, ctx.model.id);
    if (!configuredPath) {
      return;
    }

    const replacementPath = resolveConfiguredPath(configuredPath, settingsPath);
    const replacements = loadReplacements(replacementPath, ctx);
    if (!replacements) {
      return;
    }

    return patchSystemPrompt(event.payload, replacements, replacementPath, ctx);
  });
}

function patchSystemPrompt(
  payload: ProviderPayload,
  replacements: Replacement[],
  replacementPath: string,
  ctx: PromptPatcherContext,
): JsonObject | undefined {
  const system = payload["system"];

  if (isString(system)) {
    const patched = applyReplacements(system, replacements, replacementPath, ctx);
    return patched === undefined ? undefined : { ...payload, system: patched };
  }

  if (Array.isArray(system)) {
    let blocks = system.map((block) => (isJsonObject(block) ? { ...block } : block));

    for (const [index, { target, replacement }] of replacements.entries()) {
      let found = false;

      blocks = blocks.map((block) => {
        if (!isJsonObject(block)) {
          return block;
        }
        const text = block["text"];
        if (!isString(text)) {
          return block;
        }
        if (text.includes(target)) {
          found = true;
        }
        return { ...block, text: text.replaceAll(target, replacement) };
      });

      if (!found) {
        reportMissingTarget(ctx, index, target, replacementPath);
        return undefined;
      }
    }

    return { ...payload, system: blocks };
  }

  reportError(ctx, `${EXTENSION_ID}: provider payload did not contain a supported system prompt.`);
  return undefined;
}

function applyReplacements(
  text: string,
  replacements: Replacement[],
  replacementPath: string,
  ctx: PromptPatcherContext,
): string | undefined {
  let patched = text;

  for (const [index, { target, replacement }] of replacements.entries()) {
    if (!patched.includes(target)) {
      reportMissingTarget(ctx, index, target, replacementPath);
      return;
    }

    patched = patched.replaceAll(target, replacement);
  }

  return patched;
}

function reportMissingTarget(
  ctx: PromptPatcherContext,
  index: number,
  target: string,
  replacementPath: string,
) {
  reportError(
    ctx,
    [
      `${EXTENSION_ID}: replacement ${index + 1} target was not found in the request system prompt.`,
      "No prompt replacements were applied for this request.",
      "Aborting the current agent turn.",
      `Replacement file: ${replacementPath}`,
      `Missing target: ${JSON.stringify(target)}`,
    ].join("\n"),
  );
  ctx.abort();
}

function loadSettings(settingsPath: string, ctx: PromptPatcherContext): Settings | undefined {
  let parsed: unknown;

  try {
    parsed = JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }
    reportError(ctx, `${EXTENSION_ID}: failed to read ${settingsPath}: ${formatError(error)}`);
    return;
  }

  if (!isJsonObject(parsed) || !isJsonObject(parsed["providers"])) {
    reportError(ctx, `${EXTENSION_ID}: ${settingsPath} must contain a providers object.`);
    return;
  }

  const providers: Record<string, ProviderSettings> = {};

  for (const [provider, value] of Object.entries(parsed["providers"])) {
    if (provider.length === 0) {
      reportError(ctx, `${EXTENSION_ID}: provider names in ${settingsPath} must not be empty.`);
      return;
    }

    if (!isJsonObject(value)) {
      reportError(ctx, `${EXTENSION_ID}: provider ${JSON.stringify(provider)} must be an object.`);
      return;
    }

    let replacementFile: string | undefined;
    if (Object.hasOwn(value, "replacementFile")) {
      if (!isString(value["replacementFile"]) || value["replacementFile"].length === 0) {
        reportError(
          ctx,
          `${EXTENSION_ID}: provider ${JSON.stringify(provider)} must have a non-empty string replacementFile.`,
        );
        return;
      }
      replacementFile = value["replacementFile"];
    }

    const models: Record<string, string> = {};
    if (Object.hasOwn(value, "models")) {
      if (!isJsonObject(value["models"])) {
        reportError(
          ctx,
          `${EXTENSION_ID}: provider ${JSON.stringify(provider)} models must be an object.`,
        );
        return;
      }

      for (const [model, modelReplacementFile] of Object.entries(value["models"])) {
        if (model.length === 0) {
          reportError(
            ctx,
            `${EXTENSION_ID}: model names for provider ${JSON.stringify(provider)} must not be empty.`,
          );
          return;
        }
        if (!isString(modelReplacementFile) || modelReplacementFile.length === 0) {
          reportError(
            ctx,
            `${EXTENSION_ID}: model ${JSON.stringify(model)} for provider ${JSON.stringify(provider)} must map to a non-empty replacement file path.`,
          );
          return;
        }
        models[model] = modelReplacementFile;
      }
    }

    if (replacementFile === undefined && Object.keys(models).length === 0) {
      reportError(
        ctx,
        `${EXTENSION_ID}: provider ${JSON.stringify(provider)} must configure replacementFile or at least one model.`,
      );
      return;
    }

    providers[provider] = replacementFile === undefined ? { models } : { replacementFile, models };
  }

  return { providers };
}

function selectReplacementFile(
  settings: Settings,
  provider: string,
  model: string,
): string | undefined {
  const providerSettings = settings.providers[provider];
  if (!providerSettings) {
    return;
  }

  return providerSettings.models[model] ?? providerSettings.replacementFile;
}

function resolveConfiguredPath(configuredPath: string, settingsPath: string): string {
  if (configuredPath === "~") {
    return homedir();
  }
  if (/^~[\\/]/.test(configuredPath)) {
    return resolve(homedir(), configuredPath.slice(2));
  }
  return resolve(dirname(settingsPath), configuredPath);
}

function loadReplacements(
  replacementPath: string,
  ctx: PromptPatcherContext,
): Replacement[] | undefined {
  let parsed: unknown;

  try {
    parsed = JSON.parse(readFileSync(replacementPath, "utf8"));
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }
    reportError(ctx, `${EXTENSION_ID}: failed to read ${replacementPath}: ${formatError(error)}`);
    return;
  }

  if (!Array.isArray(parsed)) {
    reportError(ctx, `${EXTENSION_ID}: ${replacementPath} must contain an array.`);
    return;
  }

  const replacementItems: unknown[] = parsed;
  const replacements: Replacement[] = [];

  for (const [index, item] of replacementItems.entries()) {
    if (!isJsonObject(item)) {
      reportError(ctx, `${EXTENSION_ID}: replacement ${index + 1} must be an object.`);
      return;
    }

    const { target, replacement } = item;
    if (!isString(target) || target.length === 0) {
      reportError(
        ctx,
        `${EXTENSION_ID}: replacement ${index + 1} must have a non-empty string target.`,
      );
      return;
    }

    if (!isString(replacement)) {
      reportError(ctx, `${EXTENSION_ID}: replacement ${index + 1} must have a string replacement.`);
      return;
    }

    replacements.push({ target, replacement });
  }

  return replacements;
}

function resolveSettingsPath(): string {
  const agentDir = process.env["PI_CODING_AGENT_DIR"] ?? join(homedir(), ".pi", "agent");
  return join(agentDir, SETTINGS_FILE);
}

function reportError(ctx: PromptPatcherContext, message: string) {
  console.error(message);
  if (ctx.hasUI) {
    ctx.ui.notify(message, "error");
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every(isJsonValue);
  return typeof value === "object" && Object.values(value).every(isJsonValue);
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && isJsonValue(value) && value !== null && !Array.isArray(value);
}

function hasSystemField(value: unknown): value is ProviderPayload {
  return isJsonObject(value) && Object.hasOwn(value, "system");
}
