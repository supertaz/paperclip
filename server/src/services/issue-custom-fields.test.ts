import { beforeAll, afterAll, afterEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@paperclipai/db/schema";
import { applyPendingMigrations } from "@paperclipai/db/client";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "@paperclipai/db/test-embedded-postgres";
import { issueCustomFieldService } from "./issue-custom-fields.js";

let sqlClient: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let cleanup: () => Promise<void>;
let embeddedPostgresSupported = false;

beforeAll(async () => {
  const support = await getEmbeddedPostgresTestSupport();
  embeddedPostgresSupported = support.supported;
  if (!embeddedPostgresSupported) return;

  const testDb = await startEmbeddedPostgresTestDatabase("paperclip-icf-svc-");
  cleanup = testDb.cleanup;
  await applyPendingMigrations(testDb.connectionString);
  sqlClient = postgres(testDb.connectionString, { max: 5, onnotice: () => {} });
  db = drizzle(sqlClient, { schema });
});

afterAll(async () => {
  await sqlClient?.end();
  await cleanup?.();
});

type TestParents = { companyId: string; issueId: string; pluginId: string };

async function insertParents(): Promise<TestParents> {
  if (!embeddedPostgresSupported) throw new Error("embedded postgres not supported");
  const [company] = await db.insert(schema.companies).values({ name: "test-co" }).returning({ id: schema.companies.id });
  const [plugin] = await db.insert(schema.plugins).values({
    pluginKey: `test.plugin.${Math.random().toString(36).slice(2)}`,
    packageName: "test-plugin",
    version: "1.0.0",
    apiVersion: 1,
    manifestJson: { customFields: [{ key: "workstream", label: "Workstream", type: "text", scope: "issue" }] } as unknown as schema.plugins["$inferInsert"]["manifestJson"],
  }).returning({ id: schema.plugins.id });
  const [issue] = await db.insert(schema.issues).values({
    companyId: company.id,
    title: "Test issue",
    status: "backlog",
    priority: "medium",
    originKind: "manual",
    requestDepth: 0,
    originFingerprint: "default",
  }).returning({ id: schema.issues.id });
  return { companyId: company.id, issueId: issue.id, pluginId: plugin.id };
}

describe("issueCustomFieldService", () => {
  it("set and listForIssue round-trip", async () => {
    if (!embeddedPostgresSupported) return;
    const { companyId, issueId, pluginId } = await insertParents();
    const svc = issueCustomFieldService(db);

    await svc.set({ companyId, issueId, pluginId, key: "workstream", value: "clone-3", fieldType: "text", fieldLabel: "Workstream" });
    const fields = await svc.listForIssue({ companyId, issueId, pluginId });

    expect(fields).toHaveLength(1);
    expect(fields[0].key).toBe("workstream");
    expect(fields[0].valueText).toBe("clone-3");
    expect(fields[0].pluginId).toBe(pluginId);
  });

  it("unset soft-deletes the field row", async () => {
    if (!embeddedPostgresSupported) return;
    const { companyId, issueId, pluginId } = await insertParents();
    const svc = issueCustomFieldService(db);

    await svc.set({ companyId, issueId, pluginId, key: "workstream", value: "clone-3", fieldType: "text", fieldLabel: "Workstream" });
    await svc.unset({ companyId, issueId, pluginId, key: "workstream" });
    const fields = await svc.listForIssue({ companyId, issueId, pluginId });

    expect(fields).toHaveLength(0);
  });

  it("unset on non-existent row is noop (no error)", async () => {
    if (!embeddedPostgresSupported) return;
    const { companyId, issueId, pluginId } = await insertParents();
    const svc = issueCustomFieldService(db);

    await expect(svc.unset({ companyId, issueId, pluginId, key: "workstream" })).resolves.not.toThrow();
  });

  it("re-set after unset inserts new live row", async () => {
    if (!embeddedPostgresSupported) return;
    const { companyId, issueId, pluginId } = await insertParents();
    const svc = issueCustomFieldService(db);

    await svc.set({ companyId, issueId, pluginId, key: "workstream", value: "v1", fieldType: "text", fieldLabel: "Workstream" });
    await svc.unset({ companyId, issueId, pluginId, key: "workstream" });
    await svc.set({ companyId, issueId, pluginId, key: "workstream", value: "v2", fieldType: "text", fieldLabel: "Workstream" });

    const fields = await svc.listForIssue({ companyId, issueId, pluginId });
    expect(fields).toHaveLength(1);
    expect(fields[0].valueText).toBe("v2");
  });

  it("rejects invalid field key (dots)", async () => {
    if (!embeddedPostgresSupported) return;
    const { companyId, issueId, pluginId } = await insertParents();
    const svc = issueCustomFieldService(db);

    await expect(
      svc.set({ companyId, issueId, pluginId, key: "bad.key", value: "v1", fieldType: "text", fieldLabel: "Label" })
    ).rejects.toThrow(/invalid field key/i);
  });

  it("rejects invalid field key (uppercase)", async () => {
    if (!embeddedPostgresSupported) return;
    const { companyId, issueId, pluginId } = await insertParents();
    const svc = issueCustomFieldService(db);

    await expect(
      svc.set({ companyId, issueId, pluginId, key: "BadKey", value: "v1", fieldType: "text", fieldLabel: "Label" })
    ).rejects.toThrow(/invalid field key/i);
  });

  it("tenant guard: rejects set if issue not in company", async () => {
    if (!embeddedPostgresSupported) return;
    const { issueId, pluginId } = await insertParents();
    const { companyId: otherCompanyId } = await insertParents();
    const svc = issueCustomFieldService(db);

    await expect(
      svc.set({ companyId: otherCompanyId, issueId, pluginId, key: "workstream", value: "v1", fieldType: "text", fieldLabel: "Label" })
    ).rejects.toThrow(/not found|unauthorized/i);
  });

  it("listForIssue scoped to pluginId only", async () => {
    if (!embeddedPostgresSupported) return;
    const { companyId, issueId, pluginId } = await insertParents();
    const { pluginId: otherPluginId } = await insertParents();
    const svc = issueCustomFieldService(db);

    await svc.set({ companyId, issueId, pluginId, key: "workstream", value: "mine", fieldType: "text", fieldLabel: "Workstream" });
    await svc.set({ companyId, issueId, pluginId: otherPluginId, key: "workstream", value: "theirs", fieldType: "text", fieldLabel: "Workstream" });

    const fields = await svc.listForIssue({ companyId, issueId, pluginId });
    expect(fields).toHaveLength(1);
    expect(fields[0].valueText).toBe("mine");
  });

  it("set stores valueNumber for number type", async () => {
    if (!embeddedPostgresSupported) return;
    const { companyId, issueId, pluginId } = await insertParents();
    const svc = issueCustomFieldService(db);

    await svc.set({ companyId, issueId, pluginId, key: "score", value: "42.5", fieldType: "number", fieldLabel: "Score" });
    const fields = await svc.listForIssue({ companyId, issueId, pluginId });

    expect(fields).toHaveLength(1);
    expect(fields[0].valueText).toBe("42.5");
    expect(fields[0].valueNumber).toBe(42.5);
  });

  it("rejects invalid url type value (javascript: scheme)", async () => {
    if (!embeddedPostgresSupported) return;
    const { companyId, issueId, pluginId } = await insertParents();
    const svc = issueCustomFieldService(db);

    await expect(
      svc.set({ companyId, issueId, pluginId, key: "docs", value: "javascript:alert(1)", fieldType: "url", fieldLabel: "Docs" })
    ).rejects.toThrow(/invalid.*url|scheme/i);
  });

  it("rejects invalid url type value (data: scheme)", async () => {
    if (!embeddedPostgresSupported) return;
    const { companyId, issueId, pluginId } = await insertParents();
    const svc = issueCustomFieldService(db);

    await expect(
      svc.set({ companyId, issueId, pluginId, key: "docs", value: "data:text/html,<h1>xss</h1>", fieldType: "url", fieldLabel: "Docs" })
    ).rejects.toThrow(/invalid.*url|scheme/i);
  });

  it("rejects invalid number value (NaN string)", async () => {
    if (!embeddedPostgresSupported) return;
    const { companyId, issueId, pluginId } = await insertParents();
    const svc = issueCustomFieldService(db);

    await expect(
      svc.set({ companyId, issueId, pluginId, key: "score", value: "not-a-number", fieldType: "number", fieldLabel: "Score" })
    ).rejects.toThrow(/invalid.*number/i);
  });

  it("rejects number value with embedded XSS (partial number string)", async () => {
    if (!embeddedPostgresSupported) return;
    const { companyId, issueId, pluginId } = await insertParents();
    const svc = issueCustomFieldService(db);

    await expect(
      svc.set({ companyId, issueId, pluginId, key: "score", value: "1<script>", fieldType: "number", fieldLabel: "Score" })
    ).rejects.toThrow(/invalid.*number/i);
  });
});
