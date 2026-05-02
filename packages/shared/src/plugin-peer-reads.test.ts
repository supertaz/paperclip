import { describe, expect, it } from "vitest";
import { PLUGIN_CAPABILITIES } from "./constants.js";
import type { PaperclipPluginManifestV1, PluginPeerReadsDeclaration } from "./types/plugin.js";

describe("WF-3 peer-reads capability", () => {
  it("PLUGIN_CAPABILITIES includes plugins.peer-reads.read", () => {
    expect(PLUGIN_CAPABILITIES).toContain("plugins.peer-reads.read");
  });
});

describe("WF-3 manifest peer-reads declaration", () => {
  it("PaperclipPluginManifestV1 accepts peerReads with allow list", () => {
    const manifest: Pick<PaperclipPluginManifestV1, "peerReads"> = {
      peerReads: {
        allow: [
          { entityType: "gitea-pr", consumers: ["paperclip.workflows"] },
        ],
      },
    };
    expect(manifest.peerReads?.allow[0].entityType).toBe("gitea-pr");
    expect(manifest.peerReads?.allow[0].consumers).toContain("paperclip.workflows");
  });

  it("PluginPeerReadsDeclaration allows empty consumers array (validated at host level)", () => {
    const decl: PluginPeerReadsDeclaration = {
      allow: [{ entityType: "my-entity", consumers: [] }],
    };
    expect(decl.allow).toHaveLength(1);
  });

  it("PaperclipPluginManifestV1 peerReads is optional", () => {
    const manifest: Partial<Pick<PaperclipPluginManifestV1, "peerReads">> = {};
    expect(manifest.peerReads).toBeUndefined();
  });
});
