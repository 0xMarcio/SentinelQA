import { generateSelectors } from "@sentinelqa/dsl";
import type { RecorderMode, RecorderSettings } from "./types.js";

let mode: RecorderMode = "operations";
let active = false;
let hoverEl: HTMLElement | null = null;

async function getSettings(): Promise<RecorderSettings> {
  const stored = await chrome.storage.local.get("settings");
  return {
    apiBase: "http://localhost:4000",
    token: "sentinelqa-dev-token",
    createNew: true,
    mode: "operations",
    active: false,
    steps: [],
    ...(stored.settings ?? {})
  };
}

async function appendStep(step: RecorderSettings["steps"][number]) {
  const current = await getSettings();
  await chrome.storage.local.set({
    settings: {
      ...current,
      steps: [...current.steps, { ...step, sequence: current.steps.length + 1 }]
    }
  });
}

chrome.storage.onChanged.addListener((changes) => {
  const settings = changes.settings?.newValue as Partial<RecorderSettings> | undefined;
  if (settings) {
    active = Boolean(settings.active);
    mode = settings.mode ?? "operations";
  }
});

getSettings().then((settings) => {
  active = settings.active;
  mode = settings.mode;
});

function stepBase(command: string, target?: string, value?: string, backups: string[] = []) {
  return {
    id: `step-${crypto.randomUUID()}`,
    command,
    target,
    value,
    variableName: "",
    optional: false,
    privateValue: false,
    notes: "",
    timeoutMs: 10000,
    backupSelectors: backups,
    conditionJs: "",
    sequence: 0
  } as never;
}

function elementSelectors(target: EventTarget | null) {
  const element = target instanceof HTMLElement ? target : null;
  if (!element) return { primary: "body", backups: [] };
  return generateSelectors({
    tagName: element.tagName,
    id: element.id,
    className: element.className,
    textContent: element.textContent,
    getAttribute: (name) => element.getAttribute(name),
    parentElement: element.parentElement
      ? {
          tagName: element.parentElement.tagName,
          id: element.parentElement.id,
          className: element.parentElement.className,
          textContent: element.parentElement.textContent,
          getAttribute: (name) => element.parentElement?.getAttribute(name) ?? null,
          parentElement: null,
          children: element.parentElement.children as unknown as ArrayLike<never>
        }
      : null,
    children: element.children as unknown as ArrayLike<never>
  });
}

document.addEventListener(
  "click",
  async (event) => {
    if (!active) return;
    const selectors = elementSelectors(event.target);
    if (mode === "assertions") {
      event.preventDefault();
      event.stopPropagation();
      const element = event.target instanceof HTMLElement ? event.target : null;
      const text = element?.innerText?.trim();
      if (text && text.length < 160) {
        await appendStep(stepBase("assertTextContains", selectors.primary, text, selectors.backups));
      } else {
        await appendStep(stepBase("assertElementPresent", selectors.primary, "", selectors.backups));
      }
      return;
    }
    if (mode === "screenshot") {
      event.preventDefault();
      event.stopPropagation();
      await appendStep(stepBase("captureScreenshot", selectors.primary, "", selectors.backups));
      return;
    }
    if (mode === "accessibility") {
      event.preventDefault();
      event.stopPropagation();
      await appendStep(stepBase("checkAccessibility"));
      return;
    }
    await appendStep(stepBase("click", selectors.primary, "", selectors.backups));
  },
  true
);

document.addEventListener(
  "change",
  async (event) => {
    if (!active || mode !== "operations") return;
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) return;
    const selectors = elementSelectors(target);
    if (target instanceof HTMLSelectElement) {
      await appendStep(stepBase("select", selectors.primary, target.value, selectors.backups));
    } else {
      await appendStep(stepBase("fill", selectors.primary, target.value, selectors.backups));
    }
  },
  true
);

document.addEventListener(
  "keydown",
  async (event) => {
    if (!active || mode !== "operations" || event.key !== "Enter") return;
    const selectors = elementSelectors(event.target);
    await appendStep(stepBase("keypress", selectors.primary, "Enter", selectors.backups));
  },
  true
);

document.addEventListener("mouseover", (event) => {
  if (!active || mode !== "assertions") return;
  if (hoverEl) hoverEl.style.outline = "";
  hoverEl = event.target instanceof HTMLElement ? event.target : null;
  if (hoverEl) hoverEl.style.outline = "2px solid #1f7a55";
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "sentinelqa:start") {
    appendStep(stepBase("open", location.href)).then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});
