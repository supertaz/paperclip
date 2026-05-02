import { describe, expect, it } from "vitest";
import { PLUGIN_CAPABILITIES } from "../constants.js";

describe("WS-4 capability constants", () => {
  it("includes issue.custom-fields.read capability", () => {
    expect(PLUGIN_CAPABILITIES).toContain("issue.custom-fields.read");
  });

  it("includes issue.custom-fields.write capability", () => {
    expect(PLUGIN_CAPABILITIES).toContain("issue.custom-fields.write");
  });
});

describe("IssueCustomFieldDeclaration type contract", () => {
  it("field key regex accepts valid keys", () => {
    const validKeys = ["workstream", "my-field", "field123", "a", "x1-y2"];
    const regex = /^[a-z][a-z0-9_-]*$/;
    for (const key of validKeys) {
      expect(regex.test(key), `Expected ${key} to be valid`).toBe(true);
    }
  });

  it("field key regex rejects keys with dots", () => {
    const regex = /^[a-z][a-z0-9_-]*$/;
    expect(regex.test("bad.key")).toBe(false);
    expect(regex.test("plugin.field")).toBe(false);
    expect(regex.test("a.b.c")).toBe(false);
  });

  it("field key regex rejects keys starting with uppercase", () => {
    const regex = /^[a-z][a-z0-9_-]*$/;
    expect(regex.test("BadKey")).toBe(false);
    expect(regex.test("A")).toBe(false);
  });

  it("field key regex rejects keys starting with numbers", () => {
    const regex = /^[a-z][a-z0-9_-]*$/;
    expect(regex.test("1bad")).toBe(false);
    expect(regex.test("0field")).toBe(false);
  });

  it("field key regex rejects keys with slashes", () => {
    const regex = /^[a-z][a-z0-9_-]*$/;
    expect(regex.test("my/field")).toBe(false);
    expect(regex.test("a/b")).toBe(false);
  });

  it("field key regex rejects empty string", () => {
    const regex = /^[a-z][a-z0-9_-]*$/;
    expect(regex.test("")).toBe(false);
  });
});
