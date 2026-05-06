import { defaultSettings, type RecorderSettings } from "./types.js";

export async function getSettings(): Promise<RecorderSettings> {
  const stored = await chrome.storage.local.get("settings");
  return { ...defaultSettings, ...(stored.settings ?? {}) };
}

export async function setSettings(patch: Partial<RecorderSettings>): Promise<RecorderSettings> {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

export async function appendStep(step: RecorderSettings["steps"][number]) {
  const current = await getSettings();
  await setSettings({
    steps: [...current.steps, { ...step, sequence: current.steps.length + 1 }]
  });
}

