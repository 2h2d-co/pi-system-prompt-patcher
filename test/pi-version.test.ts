import assert from "node:assert/strict";
import test from "node:test";
import { VERSION } from "@earendil-works/pi-coding-agent";
import { atLeastVersion, requirePiVersion } from "../extensions/index.ts";

test("requires Pi 1.5.2 or later at load time", () => {
  for (const version of ["1.5.2", "1.5.3", "1.6.0", "2.0.0"]) {
    assert.equal(atLeastVersion(version, "1.5.2"), true, version);
  }
  for (const version of [
    "0.99.0",
    "0.99.2",
    "1.0.4",
    "1.1.0",
    "1.2.0",
    "1.3.0",
    "1.4.0",
    "1.4.9",
    "1.5.0",
    "1.5.1",
    "1.5.2-rc.1",
    "",
    "latest",
    undefined,
  ]) {
    assert.equal(atLeastVersion(version, "1.5.2"), false, String(version));
  }
  assert.doesNotThrow(() => requirePiVersion("pi-system-prompt-patcher", VERSION));
  assert.throws(() => requirePiVersion("pi-system-prompt-patcher", "1.5.1"), {
    message:
      "pi-system-prompt-patcher requires Pi 1.5.2 or later, but the running Pi reports Pi 1.5.1. " +
      "Exit Pi and start Pi 1.5.2 or later. /reload cannot upgrade the running runtime.",
  });
});
