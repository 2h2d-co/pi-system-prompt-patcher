import assert from "node:assert/strict";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI): void {
  pi.registerCommand("release-test-reload", {
    handler: async (_args, ctx) => {
      await ctx.reload();
    },
  });
  pi.on("before_provider_request", (event) => {
    const payload = event.payload;
    assert.ok(payload && typeof payload === "object" && "system" in payload);
    const system = JSON.stringify(payload.system);
    assert.doesNotMatch(system, /ORIGINAL_MARKER/);
    assert.match(system, /PATCH_FIRST|PATCH_SECOND/);
    pi.appendEntry("release-test-system", {
      marker: system.includes("PATCH_SECOND") ? "PATCH_SECOND" : "PATCH_FIRST",
    });
  });
}
