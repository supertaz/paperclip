import { Router, type Request } from "express";
import type { Db } from "@paperclipai/db";
import { patchInstanceExperimentalSettingsSchema, patchInstanceGeneralSettingsSchema } from "@paperclipai/shared";
import { z } from "zod";
import { forbidden } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { instanceSettingsService, logActivity } from "../services/index.js";
import { assertBoardOrgAccess, getActorInfo } from "./authz.js";
import { logger } from "../middleware/logger.js";

function assertCanManageInstanceSettings(req: Request) {
  if (req.actor.type !== "board") {
    throw forbidden("Board access required");
  }
  if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) {
    return;
  }
  throw forbidden("Instance admin access required");
}

export function instanceSettingsRoutes(db: Db) {
  const router = Router();
  const svc = instanceSettingsService(db);

  router.get("/instance/settings/general", async (req, res) => {
    // General settings (e.g. keyboardShortcuts) are readable by any
    // authenticated org member or instance admin. Only PATCH requires instance-admin.
    assertBoardOrgAccess(req);
    res.json(await svc.getGeneral());
  });

  router.patch(
    "/instance/settings/general",
    validate(patchInstanceGeneralSettingsSchema),
    async (req, res) => {
      assertCanManageInstanceSettings(req);
      const updated = await svc.updateGeneral(req.body);
      const actor = getActorInfo(req);
      const companyIds = await svc.listCompanyIds();
      await Promise.all(
        companyIds.map((companyId) =>
          logActivity(db, {
            companyId,
            actorType: actor.actorType,
            actorId: actor.actorId,
            agentId: actor.agentId,
            runId: actor.runId,
            action: "instance.settings.general_updated",
            entityType: "instance_settings",
            entityId: updated.id,
            details: {
              general: updated.general,
              changedKeys: Object.keys(req.body).sort(),
            },
          }),
        ),
      );
      res.json(updated.general);
    },
  );

  router.get("/instance/settings/experimental", async (req, res) => {
    // Experimental settings are readable by any authenticated org member
    // or instance admin. Only PATCH requires instance-admin.
    assertBoardOrgAccess(req);
    res.json(await svc.getExperimental());
  });

  router.patch(
    "/instance/settings/experimental",
    validate(patchInstanceExperimentalSettingsSchema),
    async (req, res) => {
      assertCanManageInstanceSettings(req);
      const updated = await svc.updateExperimental(req.body);
      const actor = getActorInfo(req);
      const companyIds = await svc.listCompanyIds();
      await Promise.all(
        companyIds.map((companyId) =>
          logActivity(db, {
            companyId,
            actorType: actor.actorType,
            actorId: actor.actorId,
            agentId: actor.agentId,
            runId: actor.runId,
            action: "instance.settings.experimental_updated",
            entityType: "instance_settings",
            entityId: updated.id,
            details: {
              experimental: updated.experimental,
              changedKeys: Object.keys(req.body).sort(),
            },
          }),
        ),
      );
      res.json(updated.experimental);
    },
  );

  router.get("/admin/status", async (req, res) => {
    assertCanManageInstanceSettings(req);
    const state = await svc.getSystemPauseState();
    res.json(state);
  });

  router.post("/admin/pause", validate(z.object({ reason: z.string().optional() })), async (req, res) => {
    assertCanManageInstanceSettings(req);
    await svc.pause(req.body.reason);
    const state = await svc.getSystemPauseState();
    const actor = getActorInfo(req);
    logger.warn({ actor, reason: req.body.reason }, "system paused by operator");
    const companyIds = await svc.listCompanyIds();
    await Promise.all(
      companyIds.map((companyId) =>
        logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "instance.system.paused",
          entityType: "instance_settings",
          entityId: "system",
          details: { reason: req.body.reason ?? null },
        }),
      ),
    );
    res.json(state);
  });

  router.post("/admin/unpause", async (req, res) => {
    assertCanManageInstanceSettings(req);
    await svc.unpause();
    const state = await svc.getSystemPauseState();
    const actor = getActorInfo(req);
    logger.info({ actor }, "system unpaused by operator");
    const companyIds = await svc.listCompanyIds();
    await Promise.all(
      companyIds.map((companyId) =>
        logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "instance.system.unpaused",
          entityType: "instance_settings",
          entityId: "system",
          details: {},
        }),
      ),
    );
    res.json(state);
  });

  return router;
}
