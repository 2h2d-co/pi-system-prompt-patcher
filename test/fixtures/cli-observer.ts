import assert from "node:assert/strict";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Records what the patched provider payload carried as system instructions. The live test
 * compares the marker with the assistant reply and the prompt revision with the SYSTEM.md
 * revision Pi was expected to load, so a no-op reload or a stale prompt is detected.
 */
export default function (pi: ExtensionAPI): void {
  pi.registerCommand("release-test-reload", {
    handler: async (_args, ctx) => {
      await ctx.reload();
    },
  });
  pi.on("before_provider_request", (event) => {
    const payload = event.payload;
    assert.ok(payload && typeof payload === "object" && "system" in payload);
    const fragments = [JSON.stringify(payload.system)];
    const messages: unknown = "messages" in payload ? payload.messages : undefined;
    if (Array.isArray(messages)) {
      for (const message of messages.filter((entry: unknown) => isSystemMessage(entry))) {
        fragments.push(JSON.stringify(message));
      }
    }
    const system = fragments.join("\n");
    assert.doesNotMatch(system, /ORIGINAL_MARKER/);
    assert.match(system, /PATCH_FIRST|PATCH_SECOND/);
    // The latest fragment that names a revision reflects the prompt currently in effect.
    const revisions = fragments.flatMap((fragment) =>
      [...fragment.matchAll(/PROMPT_REVISION_(\d+)/g)].map((match) => Number(match[1])),
    );
    pi.appendEntry("release-test-system", {
      marker: system.includes("PATCH_SECOND") ? "PATCH_SECOND" : "PATCH_FIRST",
      revision: revisions.at(-1) ?? null,
    });
  });
}

function isSystemMessage(value: unknown): boolean {
  return typeof value === "object" && value !== null && "role" in value && value.role === "system";
}
