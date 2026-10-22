import assert from "node:assert/strict";
import test from "node:test";
import { VERSION } from "@earendil-works/pi-coding-agent";
import { atLeastVersion, requirePiVersion } from "../extensions/index.ts";

test("requires Pi 1.4.0 or later at load time", () => {
  for (const version of ["1.4.0", "1.4.1", "1.5.0", "2.0.0"]) {
    assert.equal(atLeastVersion(version, "1.4.0"), true, version);
  }
  for (const version of [
    "0.99.0",
    "0.99.2",
    "1.0.4",
    "1.1.0",
    "1.2.0",
    "1.3.0",
    "1.3.9",
    "1.4.0-rc.1",
    "",
    "latest",
    undefined,
  ]) {
    assert.equal(atLeastVersion(version, "1.4.0"), false, String(version));
  }
  assert.doesNotThrow(() => requirePiVersion("pi-system-prompt-patcher", VERSION));
  assert.throws(() => requirePiVersion("pi-system-prompt-patcher", "1.3.0"), {
    message:
      "pi-system-prompt-patcher requires Pi 1.4.0 or later, but the running Pi reports Pi 1.3.0. " +
      "Exit Pi and start Pi 1.4.0 or later. /reload cannot upgrade the running runtime.",
  });
});
