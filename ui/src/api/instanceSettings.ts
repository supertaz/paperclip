import type {
  InstanceExperimentalSettings,
  InstanceGeneralSettings,
  PatchInstanceGeneralSettings,
  PatchInstanceExperimentalSettings,
} from "@paperclipai/shared";
import { api } from "./client";

export interface SystemPauseState {
  paused: boolean;
  pausedAt: string | null;
  pauseReason: string | null;
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
    api.get<SystemPauseState>("/admin/status"),
  getAgentQueuedCounts: () =>
    api.get<AgentQueuedCount[]>("/admin/agents/queued-counts"),
  adminUnpause: () =>
    api.post<SystemPauseState>("/admin/unpause", {}),
  adminPause: (reason?: string) =>
    api.post<SystemPauseState>("/admin/pause", { reason }),
};
