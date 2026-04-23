import { z } from "zod";
import { DEFAULT_FEEDBACK_DATA_SHARING_PREFERENCE } from "../types/feedback.js";
import {
  DAILY_RETENTION_PRESETS,
  WEEKLY_RETENTION_PRESETS,
  MONTHLY_RETENTION_PRESETS,
  DEFAULT_BACKUP_RETENTION,
  DEFAULT_RUNAWAY_SETTINGS,
} from "../types/instance.js";
import { feedbackDataSharingPreferenceSchema } from "./feedback.js";

function presetSchema<T extends readonly number[]>(presets: T, label: string) {
  return z.number().refine(
    (v): v is T[number] => (presets as readonly number[]).includes(v),
    { message: `${label} must be one of: ${presets.join(", ")}` },
  );
}

export const backupRetentionPolicySchema = z.object({
  dailyDays: presetSchema(DAILY_RETENTION_PRESETS, "dailyDays").default(DEFAULT_BACKUP_RETENTION.dailyDays),
  weeklyWeeks: presetSchema(WEEKLY_RETENTION_PRESETS, "weeklyWeeks").default(DEFAULT_BACKUP_RETENTION.weeklyWeeks),
  monthlyMonths: presetSchema(MONTHLY_RETENTION_PRESETS, "monthlyMonths").default(DEFAULT_BACKUP_RETENTION.monthlyMonths),
});

export const runawayDetectorSettingsSchema = z.object({
  fastThresholdCount: z.number().int().min(1).default(DEFAULT_RUNAWAY_SETTINGS.fastThresholdCount),
  fastWindowSec: z.number().int().min(1).default(DEFAULT_RUNAWAY_SETTINGS.fastWindowSec),
  slowThresholdCount: z.number().int().min(1).default(DEFAULT_RUNAWAY_SETTINGS.slowThresholdCount),
  slowWindowSec: z.number().int().min(1).default(DEFAULT_RUNAWAY_SETTINGS.slowWindowSec),
  autoPauseEnabled: z.boolean().default(DEFAULT_RUNAWAY_SETTINGS.autoPauseEnabled),
  startupGuardThreshold: z.number().int().min(1).default(DEFAULT_RUNAWAY_SETTINGS.startupGuardThreshold),
  startupGuardEnabled: z.boolean().default(DEFAULT_RUNAWAY_SETTINGS.startupGuardEnabled),
});

export const instanceGeneralSettingsSchema = z.object({
  censorUsernameInLogs: z.boolean().default(false),
  keyboardShortcuts: z.boolean().default(false),
  feedbackDataSharingPreference: feedbackDataSharingPreferenceSchema.default(
    DEFAULT_FEEDBACK_DATA_SHARING_PREFERENCE,
  ),
  backupRetention: backupRetentionPolicySchema.default(DEFAULT_BACKUP_RETENTION),
  runaway: runawayDetectorSettingsSchema.default(DEFAULT_RUNAWAY_SETTINGS),
  // _systemPaused* keys are managed exclusively by the pause/unpause API.
  // They live in the same jsonb column so they must be whitelisted here to
  // survive normalisation, but they are stripped from the PATCH body in the
  // route layer so callers cannot overwrite them through the settings UI.
  _systemPaused: z.boolean().optional(),
  _systemPausedAt: z.string().optional(),
  _systemPauseReason: z.string().nullable().optional(),
}).strip();

export const patchInstanceGeneralSettingsSchema = z.object({
  censorUsernameInLogs: z.boolean().optional(),
  keyboardShortcuts: z.boolean().optional(),
  feedbackDataSharingPreference: feedbackDataSharingPreferenceSchema.optional(),
  backupRetention: backupRetentionPolicySchema.optional(),
  runaway: runawayDetectorSettingsSchema.partial().optional(),
});

export const instanceExperimentalSettingsSchema = z.object({
  enableIsolatedWorkspaces: z.boolean().default(false),
  autoRestartDevServerWhenIdle: z.boolean().default(false),
}).strict();

export const patchInstanceExperimentalSettingsSchema = instanceExperimentalSettingsSchema.partial();

export type InstanceGeneralSettings = z.infer<typeof instanceGeneralSettingsSchema>;
export type PatchInstanceGeneralSettings = z.infer<typeof patchInstanceGeneralSettingsSchema>;
export type InstanceExperimentalSettings = z.infer<typeof instanceExperimentalSettingsSchema>;
export type PatchInstanceExperimentalSettings = z.infer<typeof patchInstanceExperimentalSettingsSchema>;
