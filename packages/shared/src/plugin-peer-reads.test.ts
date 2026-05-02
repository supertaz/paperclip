import { describe, expect, it } from "vitest";
import { PLUGIN_CAPABILITIES } from "./constants.js";

describe("WF-3 peer-reads capability", () => {
  it("PLUGIN_CAPABILITIES includes plugins.peer-reads.read", () => {
    expect(PLUGIN_CAPABILITIES).toContain("plugins.peer-reads.read");
  });
});
