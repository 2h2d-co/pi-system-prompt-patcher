import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const EXTENSION_ID = "pi-system-prompt-patcher";
const CONFIG_FILE = `${EXTENSION_ID}.json`;

type Replacement = {
  target: string;
  replacement: string;
};

export default function systemPromptPatcher(pi: ExtensionAPI) {
  pi.on("before_provider_request", (event, ctx) => {
    if (!hasSystemField(event.payload)) {
      return;
    }

    const configPath = resolveConfigPath();
    const replacements = loadReplacements(configPath, ctx);
    if (!replacements) {
      return;
    }

    return patchSystemPrompt(event.payload, replacements, configPath, ctx);
  });
}

function patchSystemPrompt(
  payload: unknown,
  replacements: Replacement[],
  configPath: string,
  ctx: ExtensionContext,
): Record<string, unknown> | undefined {
  if (!isRecord(payload)) {
    reportError(ctx, `${EXTENSION_ID}: provider payload was not an object.`);
    return undefined;
  }

  const system = payload["system"];

  if (typeof system === "string") {
    const patched = applyReplacements(system, replacements, configPath, ctx);
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
        reportMissingTarget(ctx, index, target, configPath);
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
  configPath: string,
  ctx: ExtensionContext,
): string | undefined {
  let patched = text;

  for (let index = 0; index < replacements.length; index++) {
    const { target, replacement } = replacements[index]!;
    if (!patched.includes(target)) {
      reportMissingTarget(ctx, index, target, configPath);
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
  configPath: string,
) {
  reportError(
    ctx,
    [
      `${EXTENSION_ID}: replacement ${index + 1} target was not found in the request system prompt.`,
      "No prompt replacements were applied for this request.",
      "Aborting the current agent turn.",
      `Config: ${configPath}`,
      `Missing target: ${JSON.stringify(target)}`,
    ].join("\n"),
  );
  ctx.abort();
}

function loadReplacements(configPath: string, ctx: ExtensionContext): Replacement[] | undefined {
  let parsed: unknown;

  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    reportError(ctx, `${EXTENSION_ID}: failed to read ${configPath}: ${formatError(error)}`);
    return;
  }

  if (!Array.isArray(parsed)) {
    reportError(ctx, `${EXTENSION_ID}: ${configPath} must contain an array.`);
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

function resolveConfigPath(): string {
  const agentDir = process.env["PI_CODING_AGENT_DIR"] ?? join(homedir(), ".pi", "agent");
  return join(agentDir, CONFIG_FILE);
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
