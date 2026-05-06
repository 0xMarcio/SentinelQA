import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { TestDsl } from "@sentinelqa/dsl";
import { getSettings, setSettings } from "./storage.js";
import type { RecorderSettings, RecorderMode } from "./types.js";
import "./popup.css";

interface Org {
  id: string;
  name: string;
  projects: Array<{ id: string; name: string }>;
}

interface Suite {
  id: string;
  name: string;
  tests: Array<{ id: string; name: string; versions?: Array<{ dsl: TestDsl }> }>;
}

function Popup() {
  const [settings, setLocalSettings] = useState<RecorderSettings | null>(null);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [suites, setSuites] = useState<Suite[]>([]);
  const [testName, setTestName] = useState("Recorded test");
  const [visualEnabled, setVisualEnabled] = useState(true);
  const [runAfterSave, setRunAfterSave] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    getSettings().then(setLocalSettings);
  }, []);

  async function persist(patch: Partial<RecorderSettings>) {
    const next = await setSettings(patch);
    setLocalSettings(next);
  }

  async function authFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!settings) throw new Error("Missing settings");
    const response = await fetch(`${settings.apiBase}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${settings.token}`,
        ...(init.headers ?? {})
      }
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json() as Promise<T>;
  }

  async function loadOrgs() {
    if (!settings) return;
    const me = await authFetch<{ organizations: Org[] }>("/me");
    setOrgs(me.organizations);
    const org = me.organizations[0];
    const project = org?.projects[0];
    await persist({ organizationId: org?.id, projectId: project?.id });
    if (project) {
      const loadedSuites = await authFetch<Suite[]>(`/projects/${project.id}/suites`);
      setSuites(loadedSuites);
      await persist({ suiteId: loadedSuites[0]?.id });
    }
  }

  async function start() {
    await persist({ active: true, steps: [] });
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) await chrome.tabs.sendMessage(tab.id, { type: "sentinelqa:start" }).catch(() => undefined);
    setStatus("Recording");
  }

  async function finish() {
    await persist({ active: false });
    setStatus(`${settings?.steps.length ?? 0} steps ready`);
  }

  async function save() {
    if (!settings?.suiteId) throw new Error("Choose a suite");
    const dsl: TestDsl = {
      schemaVersion: 1,
      name: testName,
      startUrl: settings.steps.find((step) => step.command === "open")?.target ?? location.href,
      defaultVariables: {},
      secretVariables: {},
      suiteVariables: {},
      visual: { enabled: visualEnabled, threshold: 0.5, fullPage: false, screenshotExclusions: [] },
      browser: {
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
      },
      steps: settings.steps
    };
    let testId = settings.appendTestId;
    if (settings.createNew || !testId) {
      const created = await authFetch<{ id: string }>(`/suites/${settings.suiteId}/tests`, {
        method: "POST",
        body: JSON.stringify({ name: testName, startUrl: dsl.startUrl, visualEnabled, dsl })
      });
      testId = created.id;
    } else {
      const existing = await authFetch<{ versions: Array<{ dsl: TestDsl }> }>(`/tests/${testId}`);
      const latest = existing.versions[0]?.dsl;
      await authFetch(`/tests/${testId}`, {
        method: "PUT",
        body: JSON.stringify({
          name: latest?.name ?? testName,
          startUrl: latest?.startUrl ?? dsl.startUrl,
          dsl: { ...(latest ?? dsl), steps: [...(latest?.steps ?? []), ...settings.steps] }
        })
      });
    }
    if (runAfterSave && testId) {
      await authFetch(`/tests/${testId}/run`, { method: "POST", body: "{}" });
    }
    await persist({ steps: [] });
    setStatus("Saved");
  }

  if (!settings) return <div className="popup">Loading</div>;

  return (
    <div className="popup">
      <header>
        <strong>SentinelQA</strong>
        <span>{settings.active ? "Recording" : "Idle"}</span>
      </header>
      <label>API base URL<input value={settings.apiBase} onChange={(event) => persist({ apiBase: event.target.value })} /></label>
      <label>API token<input type="password" value={settings.token} onChange={(event) => persist({ token: event.target.value })} /></label>
      <button onClick={loadOrgs}>Load workspace</button>
      <div className="row">
        <label>Project<select value={settings.projectId ?? ""} onChange={async (event) => {
          const projectId = event.target.value;
          await persist({ projectId });
          const loadedSuites = await authFetch<Suite[]>(`/projects/${projectId}/suites`);
          setSuites(loadedSuites);
        }}>{orgs.flatMap((org) => org.projects).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
        <label>Suite<select value={settings.suiteId ?? ""} onChange={(event) => persist({ suiteId: event.target.value })}>{suites.map((suite) => <option key={suite.id} value={suite.id}>{suite.name}</option>)}</select></label>
      </div>
      <label>Mode<select value={settings.mode} onChange={(event) => persist({ mode: event.target.value as RecorderMode })}>
        <option value="operations">Record operations</option>
        <option value="assertions">Make assertions</option>
        <option value="screenshot">Capture screenshot</option>
        <option value="accessibility">Check accessibility</option>
      </select></label>
      <label>Save target<select value={settings.createNew ? "new" : "append"} onChange={(event) => persist({ createNew: event.target.value === "new" })}>
        <option value="new">Create new test</option>
        <option value="append">Append to existing</option>
      </select></label>
      {!settings.createNew ? <label>Existing test<select value={settings.appendTestId ?? ""} onChange={(event) => persist({ appendTestId: event.target.value })}>{suites.find((suite) => suite.id === settings.suiteId)?.tests.map((test) => <option key={test.id} value={test.id}>{test.name}</option>)}</select></label> : null}
      <div className="buttons">
        <button onClick={start}>Start recording</button>
        <button onClick={finish}>Finish</button>
      </div>
      <label>Test name<input value={testName} onChange={(event) => setTestName(event.target.value)} /></label>
      <label><input type="checkbox" checked={visualEnabled} onChange={(event) => setVisualEnabled(event.target.checked)} /> Screenshot comparison</label>
      <label><input type="checkbox" checked={runAfterSave} onChange={(event) => setRunAfterSave(event.target.checked)} /> Execute initial run</label>
      <button onClick={save}>Save to API</button>
      <footer>{settings.steps.length} steps · {status}</footer>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Popup />);
