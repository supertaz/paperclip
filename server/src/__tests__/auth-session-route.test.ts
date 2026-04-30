import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { actorMiddleware } from "../middleware/auth.js";

function createSelectChain(rows: unknown[]) {
  return {
    from() {
      return {
        where() {
          return Promise.resolve(rows);
        },
      };
    },
  };
}

function createDb(selectRows: unknown[][] = [[], []]) {
  return {
    select: vi
      .fn()
      .mockImplementation(() => createSelectChain(selectRows.shift() ?? [])),
  } as any;
}

describe("actorMiddleware authenticated session profile", () => {
  async function requestLocalTrustedActor(selectRows: unknown[][]) {
    const app = express();
    app.use(
      actorMiddleware(createDb(selectRows), {
        deploymentMode: "local_trusted",
      }),
    );
    app.get("/actor", (req, res) => {
      res.json(req.actor);
    });

    return await request(app)
      .get("/actor")
      .set("X-Paperclip-Run-Id", "77777777-7777-4777-8777-777777777777");
  }

  it("preserves the signed-in user name and email on the board actor", async () => {
    const app = express();
    app.use(
      actorMiddleware(createDb(), {
        deploymentMode: "authenticated",
        resolveSession: async () => ({
          session: { id: "session-1", userId: "user-1" },
          user: {
            id: "user-1",
            name: "User One",
            email: "user@example.com",
          },
        }),
      }),
    );
    app.get("/actor", (req, res) => {
      res.json(req.actor);
    });

    const res = await request(app).get("/actor");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      type: "board",
      userId: "user-1",
      userName: "User One",
      userEmail: "user@example.com",
      source: "session",
      companyIds: [],
      memberships: [],
      isInstanceAdmin: false,
    });
  });

  it("resolves local trusted run-id requests to the owning agent before route attribution", async () => {
    const res = await requestLocalTrustedActor([
        [{
          id: "77777777-7777-4777-8777-777777777777",
          agentId: "22222222-2222-4222-8222-222222222222",
          companyId: "11111111-1111-4111-8111-111111111111",
          status: "running",
        }],
        [{
          id: "22222222-2222-4222-8222-222222222222",
          companyId: "11111111-1111-4111-8111-111111111111",
          status: "active",
        }],
      ]);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      type: "agent",
      agentId: "22222222-2222-4222-8222-222222222222",
      companyId: "11111111-1111-4111-8111-111111111111",
      runId: "77777777-7777-4777-8777-777777777777",
      source: "agent_run_id",
    });
  });

  it("does not resolve local trusted run-id requests for inactive or mismatched runs", async () => {
    const cases: unknown[][][] = [
      [[]],
      [[{
        id: "77777777-7777-4777-8777-777777777777",
        agentId: null,
        companyId: "11111111-1111-4111-8111-111111111111",
        status: "running",
      }]],
      [[{
        id: "77777777-7777-4777-8777-777777777777",
        agentId: "22222222-2222-4222-8222-222222222222",
        companyId: "11111111-1111-4111-8111-111111111111",
        status: "done",
      }], [{
        id: "22222222-2222-4222-8222-222222222222",
        companyId: "11111111-1111-4111-8111-111111111111",
        status: "active",
      }]],
      [[{
        id: "77777777-7777-4777-8777-777777777777",
        agentId: "22222222-2222-4222-8222-222222222222",
        companyId: "11111111-1111-4111-8111-111111111111",
        status: "running",
      }], [{
        id: "22222222-2222-4222-8222-222222222222",
        companyId: "33333333-3333-4333-8333-333333333333",
        status: "active",
      }]],
      [[{
        id: "77777777-7777-4777-8777-777777777777",
        agentId: "22222222-2222-4222-8222-222222222222",
        companyId: "11111111-1111-4111-8111-111111111111",
        status: "running",
      }], [{
        id: "22222222-2222-4222-8222-222222222222",
        companyId: "11111111-1111-4111-8111-111111111111",
        status: "terminated",
      }]],
      [[{
        id: "77777777-7777-4777-8777-777777777777",
        agentId: "22222222-2222-4222-8222-222222222222",
        companyId: "11111111-1111-4111-8111-111111111111",
        status: "running",
      }], [{
        id: "22222222-2222-4222-8222-222222222222",
        companyId: "11111111-1111-4111-8111-111111111111",
        status: "pending_approval",
      }]],
    ];

    for (const selectRows of cases) {
      const res = await requestLocalTrustedActor(selectRows);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        type: "board",
        source: "local_implicit",
        runId: "77777777-7777-4777-8777-777777777777",
      });
    }
  });
});
