"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  Clock3,
  Copy,
  Eye,
  GitBranch,
  GripVertical,
  Monitor,
  Plus,
  Save,
  Settings,
  Trash2
} from "lucide-react";
import { stepCommands, type BrowserSettings, type StepCommand, type TestDsl, type TestStep, type VisualSettings } from "@sentinelqa/dsl";
import { api } from "../lib/api";
import { KeyValueEditor, recordToRows, rowsToRecord, type KeyValueRow } from "./KeyValueEditor";

const defaultBrowser: BrowserSettings = {
  browser: "chromium",
  viewport: { width: 1920, height: 1080 },
  userAgentBrowser: "chrome",
  userAgentPlatform: "linux",
  headers: {},
  actionDelayMs: 500,
  navigationSettleMs: 1200,
  finalScreenshotDelayMs: 1000,
  elementTimeoutMs: 15000,
  trace: true,
  video: true
};

const defaultVisual: VisualSettings = {
  enabled: false,
  threshold: 0.5,
  fullPage: false,
  screenshotExclusions: []
};

const presetViewports = [
  { label: "Desktop 1080p", width: 1920, height: 1080 },
  { label: "Desktop 1440x900", width: 1440, height: 900 },
  { label: "Tablet 1024x768", width: 1024, height: 768 },
  { label: "Mobile 390x844", width: 390, height: 844 }
];

type SettingsTab = "details" | "browser" | "timing" | "display" | "variables";
type UserAgentBrowser = "chrome" | "edge" | "firefox" | "safari";
type UserAgentPlatform = "windows" | "macos" | "linux" | "ubuntu" | "android" | "iphone" | "ipad";

type StepInputKind = "text" | "url" | "selector" | "textarea" | "script" | "number" | "select";

const userAgentBrowsers: Array<{ label: string; value: UserAgentBrowser }> = [
  { label: "Chrome", value: "chrome" },
  { label: "Microsoft Edge", value: "edge" },
  { label: "Firefox", value: "firefox" },
  { label: "Safari", value: "safari" }
];

const userAgentPlatforms: Array<{ label: string; value: UserAgentPlatform }> = [
  { label: "Windows desktop", value: "windows" },
  { label: "macOS desktop", value: "macos" },
  { label: "Linux desktop", value: "linux" },
  { label: "Ubuntu desktop", value: "ubuntu" },
  { label: "Android mobile", value: "android" },
  { label: "iPhone", value: "iphone" },
  { label: "iPad", value: "ipad" }
];

interface StepFieldConfig {
  key: "target" | "value" | "variableName";
  label: string;
  kind?: StepInputKind;
  placeholder?: string;
  options?: Array<{ label: string; value: string }>;
}

interface CommandEditorConfig {
  label: string;
  group: "Navigation" | "Operations" | "Assertions" | "Variables" | "Artifacts" | "Flow";
  target?: StepFieldConfig;
  value?: StepFieldConfig;
  variableName?: StepFieldConfig;
  backups?: boolean;
  privateValue?: boolean;
}

const keyOptions = ["Enter", "Tab", "Escape", "Backspace", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].map((key) => ({
  label: key,
  value: key
}));

const accessibilityOptions = ["any", "minor", "moderate", "serious", "critical"].map((impact) => ({ label: impact, value: impact }));

const commandConfig: Record<StepCommand, CommandEditorConfig> = {
  open: {
    label: "Go to URL",
    group: "Navigation",
    target: { key: "target", label: "URL", kind: "url", placeholder: "https://example.com/" }
  },
  click: {
    label: "Click element",
    group: "Operations",
    target: { key: "target", label: "Element selector", kind: "selector", placeholder: "button[type='submit']" },
    backups: true
  },
  fill: {
    label: "Fill field",
    group: "Operations",
    target: { key: "target", label: "Field selector", kind: "selector", placeholder: "input[name='email']" },
    value: { key: "value", label: "Text value", placeholder: "{{email}}" },
    backups: true,
    privateValue: true
  },
  select: {
    label: "Select option",
    group: "Operations",
    target: { key: "target", label: "Select selector", kind: "selector", placeholder: "select[name='plan']" },
    value: { key: "value", label: "Option value", placeholder: "label=Premium or value" },
    backups: true
  },
  keypress: {
    label: "Keypress",
    group: "Operations",
    target: { key: "target", label: "Element selector", kind: "selector", placeholder: "input[type='search']" },
    value: { key: "value", label: "Key", kind: "select", options: keyOptions },
    backups: true
  },
  hover: {
    label: "Mouse over",
    group: "Operations",
    target: { key: "target", label: "Element selector", kind: "selector", placeholder: ".menu-trigger" },
    backups: true
  },
  dragDrop: {
    label: "Drag and drop",
    group: "Operations",
    target: { key: "target", label: "Drag selector", kind: "selector", placeholder: "#source" },
    value: { key: "value", label: "Drop selector", kind: "selector", placeholder: "#target" },
    backups: true
  },
  uploadFile: {
    label: "Upload file",
    group: "Operations",
    target: { key: "target", label: "File input selector", kind: "selector", placeholder: "input[type='file']" },
    value: { key: "value", label: "File path", placeholder: "/absolute/path/to/file.txt" },
    backups: true,
    privateValue: true
  },
  pause: {
    label: "Pause",
    group: "Flow",
    value: { key: "value", label: "Milliseconds", kind: "number", placeholder: "1000" }
  },
  executeJs: {
    label: "Execute JavaScript",
    group: "Operations",
    target: { key: "target", label: "JavaScript", kind: "script", placeholder: "return document.title" }
  },
  assertElementPresent: {
    label: "Element is present",
    group: "Assertions",
    target: { key: "target", label: "Element selector", kind: "selector", placeholder: "main h1" },
    backups: true
  },
  assertElementNotPresent: {
    label: "Element is not present",
    group: "Assertions",
    target: { key: "target", label: "Element selector", kind: "selector", placeholder: ".error-banner" },
    backups: true
  },
  assertElementVisible: {
    label: "Element is visible",
    group: "Assertions",
    target: { key: "target", label: "Element selector", kind: "selector", placeholder: ".toast" },
    backups: true
  },
  assertElementNotVisible: {
    label: "Element is not visible",
    group: "Assertions",
    target: { key: "target", label: "Element selector", kind: "selector", placeholder: ".modal" },
    backups: true
  },
  assertTextEquals: {
    label: "Text equals",
    group: "Assertions",
    target: { key: "target", label: "Element selector", kind: "selector", placeholder: "h1" },
    value: { key: "value", label: "Expected text", placeholder: "Account settings" },
    backups: true
  },
  assertTextContains: {
    label: "Text contains",
    group: "Assertions",
    target: { key: "target", label: "Element selector", kind: "selector", placeholder: "main" },
    value: { key: "value", label: "Expected text", placeholder: "Welcome" },
    backups: true
  },
  assertUrlContains: {
    label: "URL contains",
    group: "Assertions",
    value: { key: "value", label: "URL fragment", placeholder: "/dashboard" }
  },
  assertJsReturnsTrue: {
    label: "JavaScript returns true",
    group: "Assertions",
    target: { key: "target", label: "JavaScript", kind: "script", placeholder: "return document.querySelectorAll('h1').length === 1" }
  },
  extractText: {
    label: "Extract text",
    group: "Variables",
    target: { key: "target", label: "Element selector", kind: "selector", placeholder: "h1" },
    variableName: { key: "variableName", label: "Variable name", placeholder: "pageTitle" },
    backups: true
  },
  setVariable: {
    label: "Set variable",
    group: "Variables",
    variableName: { key: "variableName", label: "Variable name", placeholder: "email" },
    value: { key: "value", label: "Value", placeholder: "test+{{timestamp}}@example.com" },
    privateValue: true
  },
  checkAccessibility: {
    label: "Check accessibility",
    group: "Assertions",
    value: { key: "value", label: "Impact threshold", kind: "select", options: accessibilityOptions }
  },
  captureScreenshot: {
    label: "Capture screenshot",
    group: "Artifacts",
    target: { key: "target", label: "Element selector", kind: "selector", placeholder: "Optional" },
    value: { key: "value", label: "Screenshot name", placeholder: "checkout-form" },
    backups: true
  },
  importSteps: {
    label: "Import steps",
    group: "Flow",
    value: { key: "value", label: "Test ID or name", kind: "textarea", placeholder: "Reusable login module" }
  },
  exitTest: {
    label: "Exit test",
    group: "Flow",
    value: {
      key: "value",
      label: "Result",
      kind: "select",
      options: [
        { label: "Pass", value: "passed" },
        { label: "Fail", value: "failed" }
      ]
    }
  }
};

const commandGroups = ["Navigation", "Operations", "Assertions", "Variables", "Artifacts", "Flow"] as const;

function commandDefaults(command: StepCommand): Partial<TestStep> {
  switch (command) {
    case "keypress":
      return { value: "Enter" };
    case "pause":
      return { value: "1000" };
    case "checkAccessibility":
      return { value: "critical" };
    case "exitTest":
      return { value: "passed" };
    default:
      return {};
  }
}

function cleanForCommand(step: TestStep, command: StepCommand): TestStep {
  const config = commandConfig[command];
  const defaults = commandDefaults(command);
  return {
    ...step,
    command,
    target: config.target ? step.target ?? "" : "",
    value: config.value ? step.value ?? "" : "",
    variableName: config.variableName ? step.variableName ?? "" : "",
    privateValue: config.privateValue ? step.privateValue : false,
    backupSelectors: config.backups ? step.backupSelectors ?? [] : [],
    ...defaults
  };
}

function newStep(sequence: number, command: TestStep["command"] = "click"): TestStep {
  return cleanForCommand({
    id: `step-${crypto.randomUUID()}`,
    command,
    target: "",
    value: "",
    variableName: "",
    optional: false,
    privateValue: false,
    notes: "",
    timeoutMs: null,
    backupSelectors: [],
    conditionJs: "",
    sequence
  }, command);
}

function normalizeBrowser(browser?: Partial<BrowserSettings>): BrowserSettings {
  return {
    ...defaultBrowser,
    ...browser,
    userAgentPlatform: normalizeUserAgentPlatform(browser?.userAgentPlatform),
    headers: browser?.headers ?? {},
    viewport: {
      width: browser?.viewport?.width ?? defaultBrowser.viewport.width,
      height: browser?.viewport?.height ?? defaultBrowser.viewport.height
    }
  };
}

function normalizeVisual(visual?: Partial<VisualSettings>): VisualSettings {
  return {
    ...defaultVisual,
    ...visual,
    screenshotExclusions: visual?.screenshotExclusions ?? []
  };
}

function normalizeUserAgentPlatform(value: unknown): UserAgentPlatform {
  if (value === "mac") return "macos";
  return userAgentPlatforms.some((platform) => platform.value === value) ? value as UserAgentPlatform : "linux";
}

function normalizeUserAgentBrowser(value: unknown): UserAgentBrowser {
  return userAgentBrowsers.some((browser) => browser.value === value) ? value as UserAgentBrowser : "chrome";
}

function exclusionsToText(exclusions: string[] = []) {
  return exclusions.join("\n");
}

function textToExclusions(text: string) {
  return text.split(/\r?\n|,/).map((selector) => selector.trim()).filter(Boolean);
}

export function TestEditor({ suiteId, testId, initial }: { suiteId?: string; testId?: string; initial?: TestDsl }) {
  const router = useRouter();
  const initialBrowser = normalizeBrowser(initial?.browser);
  const initialVisual = normalizeVisual(initial?.visual);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("details");
  const [name, setName] = useState(initial?.name ?? "Untitled test");
  const [startUrl, setStartUrl] = useState(initial?.startUrl ?? "https://example.com/");
  const [customVariables, setCustomVariables] = useState<KeyValueRow[]>(recordToRows(initial?.defaultVariables));
  const [secretVariables, setSecretVariables] = useState<KeyValueRow[]>(recordToRows(initial?.secretVariables));
  const [visualEnabled, setVisualEnabled] = useState(initialVisual.enabled);
  const [visualThreshold, setVisualThreshold] = useState(initialVisual.threshold);
  const [visualFullPage, setVisualFullPage] = useState(initialVisual.fullPage ?? false);
  const [screenshotTarget, setScreenshotTarget] = useState(initialVisual.screenshotTarget ?? "");
  const [screenshotExclusions, setScreenshotExclusions] = useState(exclusionsToText(initialVisual.screenshotExclusions));
  const [viewportWidth, setViewportWidth] = useState(initialBrowser.viewport.width);
  const [viewportHeight, setViewportHeight] = useState(initialBrowser.viewport.height);
  const [userAgentBrowser, setUserAgentBrowser] = useState<UserAgentBrowser>(normalizeUserAgentBrowser(initialBrowser.userAgentBrowser));
  const [userAgentPlatform, setUserAgentPlatform] = useState<UserAgentPlatform>(normalizeUserAgentPlatform(initialBrowser.userAgentPlatform));
  const [headers, setHeaders] = useState<KeyValueRow[]>(recordToRows(initialBrowser.headers));
  const [actionDelayMs, setActionDelayMs] = useState(initialBrowser.actionDelayMs);
  const [navigationSettleMs, setNavigationSettleMs] = useState(initialBrowser.navigationSettleMs);
  const [finalScreenshotDelayMs, setFinalScreenshotDelayMs] = useState(initialBrowser.finalScreenshotDelayMs);
  const [elementTimeoutMs, setElementTimeoutMs] = useState(initialBrowser.elementTimeoutMs);
  const [traceEnabled, setTraceEnabled] = useState(initialBrowser.trace);
  const [videoEnabled, setVideoEnabled] = useState(initialBrowser.video);
  const [steps, setSteps] = useState<TestStep[]>(initial?.steps?.length ? initial.steps : [newStep(1)]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [pointerDragIndex, setPointerDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [expandedStepOptions, setExpandedStepOptions] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dsl = useMemo<TestDsl>(() => {
    const defaultVariables = rowsToRecord(customVariables);
    const secretVariablesRecord = rowsToRecord(secretVariables);
    return {
      schemaVersion: 1,
      name,
      startUrl,
      defaultVariables,
      secretVariables: secretVariablesRecord,
      suiteVariables: initial?.suiteVariables ?? {},
      visual: {
        enabled: visualEnabled,
        threshold: Number(visualThreshold),
        fullPage: visualFullPage,
        screenshotTarget: screenshotTarget.trim() || null,
        screenshotExclusions: textToExclusions(screenshotExclusions)
      },
      browser: {
        browser: "chromium",
        viewport: { width: Number(viewportWidth), height: Number(viewportHeight) },
        userAgent: null,
        userAgentSource: null,
        userAgentBrowser,
        userAgentPlatform,
        acceptLanguage: null,
        headers: rowsToRecord(headers),
        locale: null,
        timezone: null,
        actionDelayMs: Number(actionDelayMs),
        navigationSettleMs: Number(navigationSettleMs),
        finalScreenshotDelayMs: Number(finalScreenshotDelayMs),
        elementTimeoutMs: Number(elementTimeoutMs),
        trace: traceEnabled,
        video: videoEnabled
      },
      steps: steps.map((step, index) => ({ ...step, sequence: index + 1 }))
    };
  }, [
    actionDelayMs,
    customVariables,
    elementTimeoutMs,
    finalScreenshotDelayMs,
    headers,
    initial?.suiteVariables,
    name,
    navigationSettleMs,
    screenshotExclusions,
    screenshotTarget,
    secretVariables,
    startUrl,
    steps,
    traceEnabled,
    userAgentBrowser,
    userAgentPlatform,
    videoEnabled,
    viewportHeight,
    viewportWidth,
    visualEnabled,
    visualFullPage,
    visualThreshold
  ]);

  function updateStep(index: number, patch: Partial<TestStep>) {
    setSteps((current) => current.map((step, stepIndex) => (stepIndex === index ? { ...step, ...patch } : step)));
  }

  function changeStepCommand(index: number, command: StepCommand) {
    setSteps((current) => current.map((step, stepIndex) => (stepIndex === index ? cleanForCommand(step, command) : step)));
  }

  function insertStep(index: number, command: TestStep["command"] = "click") {
    setSteps((current) => {
      const clampedIndex = Math.min(Math.max(index, 0), current.length);
      const blank = newStep(clampedIndex + 1, command);
      const next = [...current.slice(0, clampedIndex), blank, ...current.slice(clampedIndex)];
      return resequence(next);
    });
  }

  function copyStep(index: number) {
    setSteps((current) => {
      const source = current[index];
      if (!source) return current;
      const next = [...current];
      next.splice(index + 1, 0, { ...source, id: `step-${crypto.randomUUID()}` });
      return resequence(next);
    });
  }

  function moveStep(from: number, to: number) {
    if (from === to || from < 0 || to < 0) return;
    setSteps((current) => {
      const next = [...current];
      const [item] = next.splice(from, 1);
      if (item) next.splice(to, 0, item);
      return resequence(next);
    });
  }

  function deleteStep(index: number) {
    setSteps((current) => resequence(current.filter((_, stepIndex) => stepIndex !== index)));
  }

  function clearDragState() {
    setDragIndex(null);
    setPointerDragIndex(null);
    setDropIndex(null);
  }

  function setStepOptionsOpen(stepId: string, open: boolean) {
    setExpandedStepOptions((current) => ({ ...current, [stepId]: open }));
  }

  useEffect(() => {
    if (pointerDragIndex === null) return undefined;

    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";

    const handlePointerMove = (event: PointerEvent) => {
      const card = document
        .elementsFromPoint(event.clientX, event.clientY)
        .map((element) => element.closest<HTMLElement>(".step-card"))
        .find(Boolean);
      const nextIndex = card ? Number(card.dataset.stepIndex) : Number.NaN;
      if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex === pointerDragIndex) return;
      moveStep(pointerDragIndex, nextIndex);
      setPointerDragIndex(nextIndex);
      setDragIndex(nextIndex);
      setDropIndex(nextIndex);
    };

    const handlePointerUp = () => clearDragState();

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
    return () => {
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [pointerDragIndex]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const defaultVariables = rowsToRecord(customVariables);
      const payload = {
        name,
        startUrl,
        defaults: defaultVariables,
        visualEnabled,
        visualThreshold: Number(visualThreshold),
        dsl
      };
      if (testId) {
        await api(`/tests/${testId}`, { method: "PUT", body: JSON.stringify(payload) });
        router.push(`/tests/${testId}`);
      } else if (suiteId) {
        const created = await api<{ id: string }>(`/suites/${suiteId}/tests`, {
          method: "POST",
          body: JSON.stringify(payload)
        });
        router.push(`/tests/${created.id}`);
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="test-editor">
      <section className="editor-settings panel">
        <nav className="settings-tabs" aria-label="Test settings">
          <SettingsTabButton active={settingsTab === "details"} icon={<Settings size={16} />} label="Details" onClick={() => setSettingsTab("details")} />
          <SettingsTabButton active={settingsTab === "browser"} icon={<Monitor size={16} />} label="Browser options" onClick={() => setSettingsTab("browser")} />
          <SettingsTabButton active={settingsTab === "timing"} icon={<Clock3 size={16} />} label="Step timing" onClick={() => setSettingsTab("timing")} />
          <SettingsTabButton active={settingsTab === "display"} icon={<Eye size={16} />} label="Display options" onClick={() => setSettingsTab("display")} />
          <SettingsTabButton active={settingsTab === "variables"} icon={<GitBranch size={16} />} label="Variables" onClick={() => setSettingsTab("variables")} />
        </nav>

        <div className="settings-panel">
          {settingsTab === "details" ? (
            <div className="grid two">
              <div className="field">
                <label>Test name</label>
                <input value={name} onChange={(event) => setName(event.target.value)} />
              </div>
              <div className="field">
                <label>Start URL</label>
                <input value={startUrl} onChange={(event) => setStartUrl(event.target.value)} />
              </div>
            </div>
          ) : null}

          {settingsTab === "browser" ? (
            <div className="settings-stack">
              <div className="grid two">
                <label className="field">
                  <span>Browser</span>
                  <select value={userAgentBrowser} onChange={(event) => setUserAgentBrowser(event.target.value as UserAgentBrowser)}>
                    {userAgentBrowsers.map((browser) => (
                      <option key={browser.value} value={browser.value}>{browser.label}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Platform</span>
                  <select value={userAgentPlatform} onChange={(event) => setUserAgentPlatform(event.target.value as UserAgentPlatform)}>
                    {userAgentPlatforms.map((platform) => (
                      <option key={platform.value} value={platform.value}>{platform.label}</option>
                    ))}
                  </select>
                </label>
              </div>
              <KeyValueEditor
                title="Headers"
                rows={headers}
                onChange={setHeaders}
                addLabel="Add header"
                namePlaceholder="Authorization"
                valuePlaceholder="Bearer {{apiToken}}"
              />
            </div>
          ) : null}

          {settingsTab === "timing" ? (
            <div className="grid four">
              <NumberField label="Step delay ms" value={actionDelayMs} min={0} max={10000} onChange={setActionDelayMs} />
              <NumberField label="Element timeout ms" value={elementTimeoutMs} min={100} max={60000} onChange={setElementTimeoutMs} />
              <NumberField label="Navigation settle ms" value={navigationSettleMs} min={0} max={30000} onChange={setNavigationSettleMs} />
              <NumberField label="Final screenshot delay ms" value={finalScreenshotDelayMs} min={0} max={30000} onChange={setFinalScreenshotDelayMs} />
            </div>
          ) : null}

          {settingsTab === "display" ? (
            <div className="grid two">
              <label className="field">
                <span>Screen size</span>
                <select
                  value={`${viewportWidth}x${viewportHeight}`}
                  onChange={(event) => {
                    const [width = 1920, height = 1080] = event.target.value.split("x").map(Number);
                    setViewportWidth(width);
                    setViewportHeight(height);
                  }}
                >
                  {presetViewports.map((viewport) => (
                    <option key={viewport.label} value={`${viewport.width}x${viewport.height}`}>{viewport.label} ({viewport.width}x{viewport.height})</option>
                  ))}
                </select>
              </label>
              <div className="grid two">
                <NumberField label="Width" value={viewportWidth} min={320} max={7680} onChange={setViewportWidth} />
                <NumberField label="Height" value={viewportHeight} min={240} max={4320} onChange={setViewportHeight} />
              </div>
              <label className="check-field">
                <input type="checkbox" checked={videoEnabled} onChange={(event) => setVideoEnabled(event.target.checked)} />
                <span>Record video</span>
              </label>
              <label className="check-field">
                <input type="checkbox" checked={traceEnabled} onChange={(event) => setTraceEnabled(event.target.checked)} />
                <span>Capture trace</span>
              </label>
              <label className="check-field">
                <input type="checkbox" checked={visualEnabled} onChange={(event) => setVisualEnabled(event.target.checked)} />
                <span>Screenshot comparison</span>
              </label>
              <label className="check-field">
                <input type="checkbox" checked={visualFullPage} onChange={(event) => setVisualFullPage(event.target.checked)} />
                <span>Full-page final screenshot</span>
              </label>
              <NumberField label="Screenshot tolerance %" value={visualThreshold} min={0} max={100} step={0.1} onChange={setVisualThreshold} />
              <label className="field">
                <span>Screenshot target selector</span>
                <input value={screenshotTarget} onChange={(event) => setScreenshotTarget(event.target.value)} placeholder="Optional CSS selector" />
              </label>
              <label className="field wide">
                <span>Screenshot exclusions</span>
                <textarea value={screenshotExclusions} onChange={(event) => setScreenshotExclusions(event.target.value)} placeholder=".ad-banner&#10;[data-live-clock]" />
              </label>
            </div>
          ) : null}

          {settingsTab === "variables" ? (
            <div className="settings-stack">
              <KeyValueEditor
                title="Custom Variables"
                rows={customVariables}
                onChange={setCustomVariables}
                addLabel="Add variable"
                namePlaceholder="username"
                valuePlaceholder="tester"
              />
              <KeyValueEditor
                title="Secrets"
                rows={secretVariables}
                onChange={setSecretVariables}
                addLabel="Add secret"
                namePlaceholder="apiKey"
                valuePlaceholder="secret value"
                secret
              />
            </div>
          ) : null}
        </div>
      </section>

      <div className="topbar">
        <div>
          <div className="eyebrow">Editor</div>
          <h2>Steps</h2>
        </div>
        <div className="actions">
          <button type="button" className="button secondary" onClick={() => insertStep(steps.length)}>
            <Plus size={16} /> Add step
          </button>
          <button type="button" className="button" onClick={save} disabled={saving}>
            <Save size={16} /> {saving ? "Saving" : "Save changes"}
          </button>
        </div>
      </div>
      {error ? <div className="panel" style={{ color: "var(--red)" }}>{error}</div> : null}

      <div className="editor-step-list" onDragLeave={() => setDropIndex(null)} onPointerUp={clearDragState}>
        {steps.map((step, index) => (
          <article
            id={`step-${index + 1}`}
            key={step.id}
            data-step-index={index}
            className={`step-card ${dragIndex === index ? "dragging" : ""} ${dropIndex === index ? "drop-target" : ""}`}
          >
            <div className="step-editor-header">
              <div className="actions">
                <button
                  type="button"
                  className="icon-button drag-handle"
                  title="Drag to reorder"
                  onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    event.preventDefault();
                    setPointerDragIndex(index);
                    setDragIndex(index);
                    setDropIndex(index);
                  }}
                >
                  <GripVertical size={18} />
                </button>
                <strong>#{index + 1}</strong>
                <select value={step.command} onChange={(event) => changeStepCommand(index, event.target.value as StepCommand)}>
                  {commandGroups.map((group) => (
                    <optgroup key={group} label={group}>
                      {stepCommands.filter((command) => commandConfig[command].group === group).map((command) => (
                        <option key={command} value={command}>{commandConfig[command].label}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div className="step-tools">
                <button type="button" onClick={() => moveStep(index, Math.max(0, index - 1))}><ArrowUp size={14} /> Move</button>
                <button type="button" onClick={() => moveStep(index, Math.min(steps.length - 1, index + 1))}><ArrowDown size={14} /> Move</button>
                <button type="button" onClick={() => copyStep(index)}><Copy size={14} /> Copy</button>
                <button type="button" onClick={() => insertStep(index)}>Add above</button>
                <button type="button" onClick={() => insertStep(index + 1)}>Add below</button>
                <button type="button" onClick={() => deleteStep(index)}><Trash2 size={14} /> Delete</button>
              </div>
            </div>

            <StepSpecificFields
              step={step}
              index={index}
              elementTimeoutMs={elementTimeoutMs}
              optionsOpen={Boolean(expandedStepOptions[step.id])}
              onOptionsOpenChange={(open) => setStepOptionsOpen(step.id, open)}
              updateStep={updateStep}
            />
          </article>
        ))}
      </div>
    </div>
  );
}

function resequence(steps: TestStep[]) {
  return steps.map((step, index) => ({ ...step, sequence: index + 1 }));
}

function SettingsTabButton({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick(): void }) {
  return (
    <button type="button" className={active ? "active" : ""} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function StepSpecificFields({
  step,
  index,
  elementTimeoutMs,
  optionsOpen,
  onOptionsOpenChange,
  updateStep
}: {
  step: TestStep;
  index: number;
  elementTimeoutMs: number;
  optionsOpen: boolean;
  onOptionsOpenChange(open: boolean): void;
  updateStep(index: number, patch: Partial<TestStep>): void;
}) {
  const config = commandConfig[step.command];
  const fields = [config.target, config.value, config.variableName].filter((field): field is StepFieldConfig => Boolean(field));

  return (
    <>
      {fields.length > 0 ? (
        <div className={`step-primary-fields ${fields.length === 1 ? "single" : ""}`}>
          {fields.map((field) => (
            <StepField
              key={field.key}
              field={field}
              step={step}
              index={index}
              showBackupButton={field.key === "target" && Boolean(config.backups)}
              onBackupClick={() => {
                updateStep(index, { backupSelectors: [...(step.backupSelectors ?? []), ""] });
                onOptionsOpenChange(true);
              }}
              updateStep={updateStep}
            />
          ))}
        </div>
      ) : null}

      <details className="step-advanced" open={optionsOpen} onToggle={(event) => onOptionsOpenChange(event.currentTarget.open)}>
        <summary>Options</summary>
        <div className="grid four">
          <label className="field">
            <span>Step behavior</span>
            <select value={step.optional ? "yes" : "no"} onChange={(event) => updateStep(index, { optional: event.target.value === "yes" })}>
              <option value="no">Required</option>
              <option value="yes">Optional</option>
            </select>
          </label>
          {config.privateValue ? (
            <label className="field">
              <span>Value visibility</span>
              <select value={step.privateValue ? "yes" : "no"} onChange={(event) => updateStep(index, { privateValue: event.target.value === "yes" })}>
                <option value="no">Visible</option>
                <option value="yes">Hidden</option>
              </select>
            </label>
          ) : null}
          <div className="field">
            <label>Timeout ms</label>
            <input
              type="number"
              value={step.timeoutMs ?? ""}
              onChange={(event) => updateStep(index, { timeoutMs: event.target.value ? Number(event.target.value) : null })}
              placeholder={String(elementTimeoutMs)}
            />
          </div>
        </div>

        <div className="grid two">
          {config.backups ? (
            <div className="field">
              <label>Backup selectors</label>
              <textarea
                value={(step.backupSelectors ?? []).join("\n")}
                onChange={(event) =>
                  updateStep(index, {
                    backupSelectors: event.target.value.split(/\r?\n/).map((selector) => selector.trim()).filter(Boolean)
                  })
                }
              />
            </div>
          ) : null}
          <div className="field">
            <label>Notes</label>
            <textarea value={step.notes ?? ""} onChange={(event) => updateStep(index, { notes: event.target.value })} />
          </div>
        </div>
      </details>
    </>
  );
}

function StepField({
  field,
  step,
  index,
  showBackupButton = false,
  onBackupClick,
  updateStep
}: {
  field: StepFieldConfig;
  step: TestStep;
  index: number;
  showBackupButton?: boolean;
  onBackupClick?: () => void;
  updateStep(index: number, patch: Partial<TestStep>): void;
}) {
  const value = step[field.key] ?? "";
  const update = (next: string) => updateStep(index, { [field.key]: next } as Partial<TestStep>);
  const kind = field.kind ?? "text";

  if (kind === "textarea" || kind === "script") {
    return (
      <label className="field">
        <span>{field.label}</span>
        <textarea className={kind === "script" ? "code-input" : undefined} value={value} onChange={(event) => update(event.target.value)} placeholder={field.placeholder} />
      </label>
    );
  }

  if (kind === "select") {
    return (
      <label className="field">
        <span>{field.label}</span>
        <select value={value} onChange={(event) => update(event.target.value)}>
          {field.options?.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <label className="field">
      <span>{field.label}</span>
      <div className={showBackupButton ? "field-with-action" : undefined}>
        <input type={kind === "number" ? "number" : "text"} value={value} onChange={(event) => update(event.target.value)} placeholder={field.placeholder} />
        {showBackupButton ? (
          <button type="button" className="field-action-button" onClick={onBackupClick} title="Add backup selector">+</button>
        ) : null}
      </div>
    </label>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange(value: number): void;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <input type="number" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </div>
  );
}
