"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  Check,
  Code,
  Image as ImageIcon,
  Keyboard,
  Link as LinkIcon,
  MessageSquare,
  MousePointer,
  Pencil,
  Play,
  RefreshCw,
  RotateCw,
  Type,
  X
} from "lucide-react";
import { Loader } from "../../../components/Loader";
import { NavShell } from "../../../components/NavShell";
import { Status } from "../../../components/Status";
import { api, formatDateTime, formatDuration } from "../../../lib/api";

interface Run {
  id: string;
  status: string;
  visualStatus?: string | null;
  startUrl: string;
  endUrl?: string | null;
  durationMs?: number | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  browser: string;
  viewport?: { width?: number; height?: number } | null;
  timezone?: string | null;
  geolocation?: Record<string, unknown> | null;
  testId: string;
  suiteId?: string | null;
  projectId: string;
  visualEnabled: boolean;
  test: { name: string; visualThreshold?: number | null };
  suite?: { name: string } | null;
  artifacts: Artifact[];
  comments?: RunComment[];
}

interface RunComment {
  id: string;
  body: string;
  author?: string | null;
  createdAt: string;
}

interface Artifact {
  id: string;
  kind: string;
  url?: string | null;
  metadata: Record<string, unknown>;
}

interface StepResult {
  id: string;
  stepId: string;
  sequence: number;
  command: string;
  status: string;
  durationMs: number;
  error?: string | null;
  resolvedTarget?: string | null;
  url?: string | null;
  metadata?: {
    httpStatus?: number | null;
    consoleMessages?: ConsoleMessage[];
    text?: string;
    result?: unknown;
    [key: string]: unknown;
  };
}

interface ConsoleMessage {
  type: string;
  text: string;
  timestamp: string;
  location?: { url?: string; lineNumber?: number; columnNumber?: number };
}

interface StepViewOptions {
  url: boolean;
  timing: boolean;
  http: boolean;
  console: boolean;
  errors: boolean;
}

export default function RunPage() {
  const { runId } = useParams<{ runId: string }>();
  const router = useRouter();
  const [run, setRun] = useState<Run | null>(null);
  const [steps, setSteps] = useState<StepResult[]>([]);
  const [showComment, setShowComment] = useState(false);
  const [showViewOptions, setShowViewOptions] = useState(false);
  const [viewOptions, setViewOptions] = useState<StepViewOptions>({
    url: true,
    timing: true,
    http: true,
    console: true,
    errors: true
  });
  const [commentBody, setCommentBody] = useState("");

  async function load() {
    const [runRecord, stepRecords] = await Promise.all([
      api<Run>(`/runs/${runId}`),
      api<StepResult[]>(`/runs/${runId}/steps`)
    ]);
    setRun(runRecord);
    setSteps(stepRecords);
    return runRecord;
  }

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const shouldPoll = (runRecord: Run) =>
      runRecord.status === "queued" ||
      runRecord.status === "running" ||
      (runRecord.visualEnabled && !runRecord.visualStatus);

    const poll = async () => {
      try {
        const runRecord = await load();
        if (!cancelled && shouldPoll(runRecord)) {
          timer = setTimeout(poll, 3000);
        }
      } catch {
        if (!cancelled) router.push("/login");
      }
    };

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId, router]);

  async function acceptBaseline() {
    await api(`/runs/${runId}/accept-baseline`, { method: "POST", body: "{}" });
    await load();
  }

  async function runAgain() {
    if (!run) return;
    const nextRun = await api<{ id: string }>(`/tests/${run.testId}/run`, { method: "POST", body: "{}" });
    router.push(`/runs/${nextRun.id}`);
  }

  async function addComment() {
    if (!commentBody.trim()) return;
    await api(`/runs/${runId}/comments`, { method: "POST", body: JSON.stringify({ body: commentBody.trim(), author: "local" }) });
    setCommentBody("");
    setShowComment(false);
    await load();
  }

  const finalScreenshot = useMemo(() => run?.artifacts.find((artifact) => artifact.kind === "finalScreenshot"), [run]);
  const visualDiff = useMemo(() => run?.artifacts.find((artifact) => artifact.kind === "visualDiff"), [run]);
  const video = useMemo(() => run?.artifacts.find((artifact) => artifact.kind === "video"), [run]);
  const artifactLinks = useMemo(
    () =>
      run?.artifacts.filter((artifact) => {
        if (!artifact.url) return false;
        if (artifact.kind === "video" || artifact.kind === "finalScreenshot" || artifact.kind === "visualDiff") return false;
        if (artifact.kind === "console" && !artifactHasConsole(artifact)) return false;
        return true;
      }) ?? [],
    [run]
  );
  const failedStep = useMemo(() => steps.find((step) => step.status === "failed"), [steps]);
  const visualStats = visualDiff ? visualMetadata(visualDiff) : null;
  const showVisualCard = Boolean(run?.visualEnabled && finalScreenshot?.url);
  const visualStatusText = run ? visualCardStatusText(run, visualStats) : null;

  return (
    <>
      <Loader done={!!run} />
      {run ? (
    <NavShell projectId={run.projectId} suiteId={run.suiteId ?? undefined}>
      <div className="result-page">
        <div className="result-breadcrumb">
          <Link href="/">Dashboard</Link>
          {run.suite && run.suiteId ? <Link href={`/suites/${run.suiteId}`}>{run.suite.name}</Link> : null}
          <Link href={`/tests/${run.testId}`}>{run.test.name}</Link>
          <strong>Run result</strong>
        </div>

        <div className="result-titlebar">
          <div>
            <div className="eyebrow">Run result</div>
            <h1>{run.test.name}</h1>
          </div>
          <div className="actions">
            <button className="button secondary" onClick={load}>
              <RefreshCw size={16} /> Refresh
            </button>
            <button className="button secondary" onClick={runAgain}>
              <RotateCw size={16} /> Run again
            </button>
            {run.visualEnabled && finalScreenshot?.url && visualOutcome(run, visualStats) === "failed" ? (
              <button className="button" onClick={acceptBaseline}>
                <Check size={16} /> Accept baseline
              </button>
            ) : null}
          </div>
        </div>

        {showComment ? (
          <div className="panel comment-box">
            <textarea value={commentBody} onChange={(event) => setCommentBody(event.target.value)} placeholder="Add context for this run" />
            <div className="actions">
              <button className="button" onClick={addComment}>Save comment</button>
              <button className="button secondary" onClick={() => setShowComment(false)}>Cancel</button>
            </div>
          </div>
        ) : null}

        <section className="result-summary panel">
          <div className="summary-action">
            <button className="button secondary" onClick={() => setShowComment(true)}>
              <MessageSquare size={18} /> Add comment
            </button>
          </div>
          <dl>
            <div><dt>Completed</dt><dd>{formatDateTime(run.finishedAt)}</dd></div>
            <div><dt>Duration</dt><dd>{formatDuration(run.durationMs)}</dd></div>
            <div><dt>Environment</dt><dd>{environmentLabel(run)}</dd></div>
            <div><dt>Triggered</dt><dd>Local</dd></div>
            <div><dt>Location</dt><dd>{locationLabel(run)}</dd></div>
          </dl>
        </section>

        <div className="result-layout">
          <main className="result-main">
            <section className="steps-board">
              <div className="steps-toolbar">
                <strong>Steps</strong>
                <button className="steps-option" type="button" onClick={() => setShowViewOptions((value) => !value)}>View options</button>
                {failedStep ? <a className="steps-jump" href={`#step-${failedStep.sequence}`}>Jump to step #{failedStep.sequence}</a> : null}
                <div className={`steps-overall steps-overall-${run.status}`}>
                  {run.status === "failed" ? <X size={18} /> : <Check size={18} />}
                  {run.status}
                </div>
              </div>

              {showViewOptions ? <ViewOptionsPanel value={viewOptions} onChange={setViewOptions} /> : null}

              {steps.map((step, index) => (
                <StepRow key={step.id} step={step} testId={run.testId} start={index === 0 && step.command === "open"} options={viewOptions} />
              ))}
            </section>

            {run.comments?.length ? (
              <section className="panel comments-panel">
                <h2>Comments</h2>
                {run.comments.map((comment) => (
                  <article key={comment.id} className="comment-entry">
                    <div className="eyebrow">{comment.author ?? "local"} · {formatDateTime(comment.createdAt)}</div>
                    <p>{comment.body}</p>
                  </article>
                ))}
              </section>
            ) : null}
          </main>

          <aside className="media-rail">
            {video?.url ? (
              <section className="media-card panel">
                <div className="media-card-header">Video recording</div>
                <div className="artifact-video-frame">
                  <video className="artifact-video" controls src={video.url} />
                </div>
              </section>
            ) : null}

            {showVisualCard ? (
              <section className={`media-card panel visual-card visual-card-${visualOutcome(run, visualStats)}`}>
                <div className="media-card-header">
                  Screenshot
                  {visualStatusText ? <span>{visualStatusText}</span> : null}
                </div>
                {visualStats ? (
                  <div className="visual-metric">
                    <strong>{visualStats.diffPercentage.toFixed(2)}% change from baseline</strong>
                  </div>
                ) : null}
                <img className="artifact-image" src={finalScreenshot?.url ?? ""} alt="Final screenshot" />
              </section>
            ) : null}

            {visualDiff?.url ? (
              <section className="media-card panel">
                <div className="media-card-header">Visual diff</div>
                <img className="artifact-image" src={visualDiff.url} alt="Visual diff" />
              </section>
            ) : null}

            {artifactLinks.length ? (
              <section className="panel artifact-list">
                <h2>Artifacts</h2>
                <div className="actions">
                  {artifactLinks.map((artifact) => (
                    <Link key={artifact.id} className="button secondary" href={artifact.url!}>{artifactLabel(artifact, artifactLinks)}</Link>
                  ))}
                </div>
              </section>
            ) : null}
          </aside>
        </div>
      </div>
    </NavShell>
      ) : null}
    </>
  );
}

function ViewOptionsPanel({ value, onChange }: { value: StepViewOptions; onChange(value: StepViewOptions): void }) {
  const toggle = (key: keyof StepViewOptions) => onChange({ ...value, [key]: !value[key] });
  return (
    <div className="step-view-options">
      <label><input type="checkbox" checked={value.url} onChange={() => toggle("url")} /> URL</label>
      <label><input type="checkbox" checked={value.timing} onChange={() => toggle("timing")} /> Timing</label>
      <label><input type="checkbox" checked={value.http} onChange={() => toggle("http")} /> HTTP status</label>
      <label><input type="checkbox" checked={value.console} onChange={() => toggle("console")} /> Console output</label>
      <label><input type="checkbox" checked={value.errors} onChange={() => toggle("errors")} /> Error details</label>
    </div>
  );
}

function StepRow({ step, start, testId, options }: { step: StepResult; start: boolean; testId: string; options: StepViewOptions }) {
  const consoleMessages = step.metadata?.consoleMessages ?? [];
  const status = stepStatus(step);
  const Icon = commandIcon(step.command);

  return (
    <article id={`step-${step.sequence}`} className={`result-step result-step-${status}`}>
      <div className="step-index">
        <span>{start ? "Start" : `#${step.sequence}`}</span>
        {status === "failed" ? <X size={28} /> : status === "skipped" ? <span className="step-skip">-</span> : <Check size={28} />}
      </div>
      <div className="step-body">
        <div className="step-mainline">
          <Icon size={20} />
          <span>{commandLabel(step.command)}</span>
          {step.resolvedTarget ? <code>{step.resolvedTarget}</code> : null}
          {options.http && typeof step.metadata?.httpStatus === "number" ? <span className="http-chip">HTTP {step.metadata.httpStatus}</span> : null}
          {options.errors && step.error ? <span className="error-chip">{step.error}</span> : null}
        </div>
        <div className="step-subline">
          {options.url ? <span><LinkIcon size={16} /> {step.url ?? "-"}</span> : null}
          {options.timing ? <span>{formatDuration(step.durationMs)}</span> : null}
          <Link href={`/tests/${testId}/edit#step-${step.sequence}`}><Pencil size={16} /> Edit</Link>
        </div>
        {options.console && consoleMessages.length > 0 ? (
          <div className="step-console">
            <div className="eyebrow">Console output</div>
            {consoleMessages.map((message, index) => (
              <pre key={`${message.timestamp}-${index}`}>
                [{message.type}] {message.text}
              </pre>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function artifactHasConsole(artifact: Artifact) {
  return typeof artifact.metadata.count === "number" ? artifact.metadata.count > 0 : true;
}

function artifactLabel(artifact: Artifact, artifacts: Artifact[]) {
  if (artifact.kind === "trace") return "Browser trace";
  if (artifact.kind === "console") return "Console log";
  if (artifact.kind === "accessibility") {
    return numberedArtifactLabel("Accessibility report", artifact, artifacts);
  }
  if (artifact.kind === "screenshot") {
    const label = typeof artifact.metadata.label === "string" ? artifact.metadata.label : null;
    if (artifact.metadata.failure === true) {
      return numberedArtifactLabel("Failure screenshot", artifact, artifacts);
    }
    if (label) return humanArtifactLabel(label);
    const urlLabel = urlArtifactLabel(artifact.metadata.url);
    if (urlLabel) return `Screenshot: ${urlLabel}`;
    return numberedArtifactLabel("Captured screenshot", artifact, artifacts);
  }
  return artifact.kind.replaceAll("_", " ");
}

function numberedArtifactLabel(baseLabel: string, artifact: Artifact, artifacts: Artifact[]) {
  const sameKind = artifacts.filter((item) => item.kind === artifact.kind);
  if (sameKind.length <= 1) return baseLabel;
  const index = sameKind.findIndex((item) => item.id === artifact.id);
  return `${baseLabel} ${index + 1}`;
}

function humanArtifactLabel(value: string) {
  return value
    .replace(/\{\{[^}]+\}\}/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "Captured screenshot";
}

function urlArtifactLabel(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return null;
  }
}

function visualMetadata(artifact: Artifact) {
  const diffPercentage = numberFrom(artifact.metadata.diffPercentage);
  const matchPercentage = numberFrom(artifact.metadata.matchPercentage) ?? Math.max(0, 100 - (diffPercentage ?? 0));
  return {
    diffPercentage: diffPercentage ?? 0,
    matchPercentage,
    threshold: numberFrom(artifact.metadata.threshold) ?? 0,
    diffPixels: numberFrom(artifact.metadata.diffPixels) ?? 0,
    totalPixels: numberFrom(artifact.metadata.totalPixels) ?? 0
  };
}

function numberFrom(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function visualOutcome(run: Run, stats: ReturnType<typeof visualMetadata> | null) {
  if (run.visualStatus?.includes("failed")) return "failed";
  if (stats) return "passed";
  if (run.visualStatus === "baseline_created") return "baseline";
  if (run.visualStatus === "accepted") return "accepted";
  return "pending";
}

function visualCardStatusText(run: Run, stats: ReturnType<typeof visualMetadata> | null) {
  if (run.visualStatus?.includes("failed")) return "failed";
  if (stats) return "passed";
  if (run.visualStatus === "baseline_created") return "new baseline";
  if (run.visualStatus === "accepted") return "accepted";
  return null;
}

function stepStatus(step: StepResult) {
  return step.status === "skipped" && step.error ? "optional" : step.status;
}

function commandLabel(command: string) {
  const labels: Record<string, string> = {
    open: "Open",
    click: "Click on",
    fill: "Assign into",
    select: "Select",
    keypress: "Press key in",
    hover: "Hover on",
    dragDrop: "Drag and drop",
    uploadFile: "Upload file",
    pause: "Pause",
    executeJs: "Run JavaScript",
    assertElementPresent: "Assert element present",
    assertElementNotPresent: "Assert element absent",
    assertElementVisible: "Assert element visible",
    assertElementNotVisible: "Assert element hidden",
    assertTextEquals: "Assert text equals",
    assertTextContains: "Contains text",
    assertUrlContains: "URL contains",
    assertJsReturnsTrue: "Assert JavaScript returns true",
    extractText: "Extract text from",
    setVariable: "Assign variable",
    checkAccessibility: "Check accessibility",
    captureScreenshot: "Capture screenshot",
    importSteps: "Import steps",
    exitTest: "Exit test"
  };
  return labels[command] ?? command;
}

function commandIcon(command: string) {
  if (command === "open" || command === "assertUrlContains") return LinkIcon;
  if (command === "click" || command === "hover" || command === "dragDrop") return MousePointer;
  if (command === "keypress") return Keyboard;
  if (command === "fill" || command === "select" || command === "extractText" || command.startsWith("assertText")) return Type;
  if (command === "executeJs" || command === "assertJsReturnsTrue") return Code;
  if (command === "captureScreenshot") return ImageIcon;
  if (command === "exitTest") return X;
  return Play;
}

function environmentLabel(run: Run) {
  const viewport = run.viewport?.width && run.viewport?.height ? `${run.viewport.width}x${run.viewport.height}` : "default";
  return `${browserLabel(run.browser)} @ ${viewport}`;
}

function browserLabel(browser: string) {
  return browser === "chromium" ? "Chromium" : browser;
}

function locationLabel(run: Run) {
  if (!run.geolocation) return run.timezone ?? "Default region";
  const latitude = run.geolocation.latitude;
  const longitude = run.geolocation.longitude;
  return typeof latitude === "number" && typeof longitude === "number" ? `${latitude}, ${longitude}` : "Custom";
}
