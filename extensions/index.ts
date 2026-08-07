import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const EXTENSION_ID = "pi-system-prompt-patcher";
const SETTINGS_FILE = `${EXTENSION_ID}.json`;

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

export default function systemPromptPatcher(pi: ExtensionAPI) {
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
  payload: unknown,
  replacements: Replacement[],
  replacementPath: string,
  ctx: ExtensionContext,
): Record<string, unknown> | undefined {
  if (!isRecord(payload)) {
    reportError(ctx, `${EXTENSION_ID}: provider payload was not an object.`);
    return undefined;
  }

  const system = payload["system"];

  if (typeof system === "string") {
    const patched = applyReplacements(system, replacements, replacementPath, ctx);
    return patched === undefined ? undefined : { ...payload, system: patched };
  }

  if (Array.isArray(system)) {
    let blocks = system.map((block) => (isRecord(block) ? { ...block } : block));

    for (let index = 0; index < replacements.length; index++) {
      const { target, replacement } = replacements[index]!;
      let found = false;

      blocks = blocks.map((block) => {
        if (!isRecord(block)) {
          return block;
        }
        const text = block["text"];
        if (typeof text !== "string") {
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
  ctx: ExtensionContext,
): string | undefined {
  let patched = text;

  for (let index = 0; index < replacements.length; index++) {
    const { target, replacement } = replacements[index]!;
    if (!patched.includes(target)) {
      reportMissingTarget(ctx, index, target, replacementPath);
      return;
    }

    patched = patched.replaceAll(target, replacement);
  }

  return patched;
}

function reportMissingTarget(
  ctx: ExtensionContext,
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

function loadSettings(settingsPath: string, ctx: ExtensionContext): Settings | undefined {
  let parsed: unknown;

  try {
    parsed = JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch (error) {
    reportError(ctx, `${EXTENSION_ID}: failed to read ${settingsPath}: ${formatError(error)}`);
    return;
  }

  if (!isRecord(parsed) || !isRecord(parsed["providers"])) {
    reportError(ctx, `${EXTENSION_ID}: ${settingsPath} must contain a providers object.`);
    return;
  }

  const providers: Record<string, ProviderSettings> = {};

  for (const [provider, value] of Object.entries(parsed["providers"])) {
    if (provider.length === 0) {
      reportError(ctx, `${EXTENSION_ID}: provider names in ${settingsPath} must not be empty.`);
      return;
    }

    if (!isRecord(value)) {
      reportError(ctx, `${EXTENSION_ID}: provider ${JSON.stringify(provider)} must be an object.`);
      return;
    }

    let replacementFile: string | undefined;
    if (Object.hasOwn(value, "replacementFile")) {
      if (typeof value["replacementFile"] !== "string" || value["replacementFile"].length === 0) {
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
      if (!isRecord(value["models"])) {
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
        if (typeof modelReplacementFile !== "string" || modelReplacementFile.length === 0) {
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
  ctx: ExtensionContext,
): Replacement[] | undefined {
  let parsed: unknown;

  try {
    parsed = JSON.parse(readFileSync(replacementPath, "utf8"));
  } catch (error) {
    reportError(ctx, `${EXTENSION_ID}: failed to read ${replacementPath}: ${formatError(error)}`);
    return;
  }

  if (!Array.isArray(parsed)) {
    reportError(ctx, `${EXTENSION_ID}: ${replacementPath} must contain an array.`);
    return;
  }

  const replacements: Replacement[] = [];

  for (let index = 0; index < parsed.length; index++) {
    const item = parsed[index];
    if (!isRecord(item)) {
      reportError(ctx, `${EXTENSION_ID}: replacement ${index + 1} must be an object.`);
      return;
    }

    const { target, replacement } = item;
    if (typeof target !== "string" || target.length === 0) {
      reportError(
        ctx,
        `${EXTENSION_ID}: replacement ${index + 1} must have a non-empty string target.`,
      );
      return;
    }

    if (typeof replacement !== "string") {
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

function reportError(ctx: ExtensionContext, message: string) {
  console.error(message);
  if (ctx.hasUI) {
    ctx.ui.notify(message, "error");
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasSystemField(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && Object.hasOwn(value, "system");
}
