import type {
  InstanceExperimentalSettings,
  InstanceGeneralSettings,
  PatchInstanceGeneralSettings,
  PatchInstanceExperimentalSettings,
} from "@paperclipai/shared";
import { api } from "./client";

export interface InstanceAdminStatus {
  paused: boolean;
  pauseReason: string | null;
  pausedAt: string | null;
  queuedRunCount: number;
}

export interface AgentQueuedCount {
  agentId: string;
  queuedCount: number;
}

export const instanceSettingsApi = {
  getGeneral: () =>
    api.get<InstanceGeneralSettings>("/instance/settings/general"),
  updateGeneral: (patch: PatchInstanceGeneralSettings) =>
    api.patch<InstanceGeneralSettings>("/instance/settings/general", patch),
  getExperimental: () =>
    api.get<InstanceExperimentalSettings>("/instance/settings/experimental"),
  updateExperimental: (patch: PatchInstanceExperimentalSettings) =>
    api.patch<InstanceExperimentalSettings>("/instance/settings/experimental", patch),
  getAdminStatus: () =>
    api.get<InstanceAdminStatus>("/admin/status"),
  adminUnpause: () =>
    api.post<InstanceAdminStatus>("/admin/unpause", {}),
  getAgentQueuedCounts: () =>
    api.get<AgentQueuedCount[]>("/admin/agents/queued-counts"),
};
