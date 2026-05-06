import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { chromium, type BrowserContextOptions, type Page } from "playwright";
import { prisma, type Prisma } from "@sentinelqa/db";
import { compileTestDsl, interpolateVariables, interpolateObject, mergeVariables, type TestStep, type VisualSettings } from "@sentinelqa/dsl";
import { ArtifactStorage, artifactKey } from "@sentinelqa/storage";
import { runStepCommand } from "./commands.js";

const defaultUserAgentSource = "https://ua.syntax9.ai/api/all.json";

const connection = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });
const visualQueue = new Queue("visual-diff", { connection });
const notifyQueue = new Queue("notify-webhook", { connection });

interface ConsoleMessageRecord {
  type: string;
  text: string;
  location: unknown;
  timestamp: string;
}

interface UserAgentRecord {
  browser: string;
  platform: string;
  device_class?: string;
  user_agent: string;
}

type Redactor = <T>(value: T) => T;

export async function executeRun(runId: string): Promise<void> {
  const storage = new ArtifactStorage();
  const run = await prisma.run.findUnique({
    where: { id: runId },
    include: {
      testVersion: true,
      test: { include: { suite: true } },
      environment: true
    }
  });
  if (!run) {
    throw new Error(`Run ${runId} not found`);
  }

  const startedAt = new Date();
  await prisma.run.update({ where: { id: run.id }, data: { status: "running", startedAt } });
  if (run.suiteRunId) {
    await prisma.suiteRun.update({ where: { id: run.suiteRunId }, data: { status: "running", startedAt } }).catch(() => undefined);
  }

  const compiled = compileTestDsl(run.testVersion.dsl);
  if (compiled.issues.length > 0) {
    await failRun(run.id, startedAt, compiled.issues.map((issue) => issue.message).join("; "));
    return;
  }

  const dsl = compiled.dsl;
  const suiteSecrets = objectToStrings(run.test.suite.secretVariables);
  const secretVariableNames = new Set([...Object.keys(dsl.secretVariables), ...Object.keys(suiteSecrets)]);
  const redactSecrets = createSecretRedactor([...Object.values(dsl.secretVariables), ...Object.values(suiteSecrets)]);
  const runtimeVariables = mergeVariables({
    testDefaults: dsl.defaultVariables,
    testSecrets: {
      ...dsl.secretVariables,
      ...suiteSecrets
    },
    suiteVariables: {
      ...dsl.suiteVariables,
      ...objectToStrings(run.test.suite.variables)
    },
    environmentVariables: objectToStrings(run.environment?.variables),
    runVariables: objectToStrings(run.variables)
  });
  const tmp = await mkdtemp(join(tmpdir(), "sentinelqa-run-"));
  const videoDir = join(tmp, "video");
  await mkdir(videoDir, { recursive: true });

  const viewport = objectToViewport(run.viewport);
  const browser = await chromium.launch({
    headless: process.env.RUNNER_HEADLESS !== "false",
    args: [`--window-size=${viewport.width},${viewport.height}`, "--force-device-scale-factor=1"]
  });
  const userAgent = await resolveUserAgent(dsl.browser, runtimeVariables);
  const headers = resolveHeaders(dsl.browser.headers, runtimeVariables);
  const contextOptions: BrowserContextOptions = {
    viewport,
    screen: viewport,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    locale: run.locale ?? dsl.browser.locale ?? undefined,
    timezoneId: run.timezone ?? dsl.browser.timezone ?? undefined,
    geolocation: objectToGeolocation(run.geolocation),
    permissions: run.geolocation ? ["geolocation"] : [],
    userAgent,
    extraHTTPHeaders: Object.keys(headers).length > 0 ? headers : undefined,
    recordVideo: run.videoEnabled ? { dir: videoDir, size: viewport } : undefined
  };
  const context = await browser.newContext(contextOptions);
  if (run.traceEnabled) {
    await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
  }
  const page = await context.newPage();
  const consoleMessages: ConsoleMessageRecord[] = [];
  page.on("console", (message) => {
    consoleMessages.push({
      type: message.type(),
      text: message.text(),
      location: message.location(),
      timestamp: new Date().toISOString()
    });
  });
  page.on("pageerror", (error) => {
    consoleMessages.push({
      type: "pageerror",
      text: error.message,
      location: {},
      timestamp: new Date().toISOString()
    });
  });

  let failed = false;
  let runError: string | null = null;
  let stop = false;

  try {
    const startUrl = interpolateVariables(run.startUrl, runtimeVariables);
    const executableSteps = await expandImportSteps(dsl.steps, run.projectId, runtimeVariables, [run.testId]);
    const firstStep = executableSteps[0];
    if (startUrl && startUrl !== "about:blank" && firstStep?.command !== "open") {
      await page.goto(startUrl, { waitUntil: "load" });
      await waitForPageReady(page, Number(process.env.RUNNER_NAVIGATION_SETTLE_MS ?? dsl.browser.navigationSettleMs));
    }
    const actionDelayMs = Number(process.env.RUNNER_ACTION_DELAY_MS ?? dsl.browser.actionDelayMs);
    const navigationSettleMs = Number(process.env.RUNNER_NAVIGATION_SETTLE_MS ?? dsl.browser.navigationSettleMs);
    for (const rawStep of executableSteps) {
      if (stop) break;
      const step = interpolateObject(rawStep, runtimeVariables) as TestStep;
      if (step.conditionJs) {
        const condition = await page.evaluate(step.conditionJs).catch(() => false);
        if (!condition) {
          await recordStep(run.id, step, "skipped", new Date(), new Date(), null, "conditionJs returned false", page.url(), {});
          continue;
        }
      }

      const stepStarted = new Date();
      const consoleStart = consoleMessages.length;
      try {
        const result = await runStepCommand(step, {
          page,
          variables: runtimeVariables,
          uploadArtifact: async (kind, filename, content, contentType, metadata) => {
            const uploaded = await storage.putBuffer(artifactKey(run.id, kind, filename), content, contentType);
            const artifact = await prisma.artifact.create({
              data: {
                runId: run.id,
                kind,
                key: uploaded.key,
                url: uploaded.url,
                contentType: uploaded.contentType,
                sizeBytes: uploaded.sizeBytes,
                metadata: (metadata ?? {}) as Prisma.InputJsonValue
              }
            });
            return artifact.id;
          },
          defaultTimeoutMs: dsl.browser.elementTimeoutMs
        });
        await settleAfterStep(page, step, actionDelayMs, navigationSettleMs);
        const stepFinished = new Date();
        const metadata = redactSecrets(withStepConsole(result.metadata ?? {}, consoleMessages.slice(consoleStart)));
        await recordStep(run.id, step, "passed", stepStarted, stepFinished, null, null, page.url(), metadata);
        stop = result.stop ?? false;
      } catch (error) {
        const stepFinished = new Date();
        const screenshotId = await captureStepFailure(run.id, storage, page, step.id, viewport).catch(() => null);
        const message = redactSecrets(error instanceof Error ? error.message : String(error));
        const metadata = redactSecrets(withStepConsole({}, consoleMessages.slice(consoleStart)));
        await recordStep(
          run.id,
          step,
          step.optional ? "skipped" : "failed",
          stepStarted,
          stepFinished,
          screenshotId,
          message,
          page.url(),
          metadata
        );
        if (!step.optional) {
          failed = true;
          break;
        }
      }
    }
  } catch (error) {
    failed = true;
    runError = redactSecrets(error instanceof Error ? error.message : String(error));
  } finally {
    await persistFinalArtifacts(
      run.id,
      storage,
      page,
      context,
      tmp,
      consoleMessages,
      redactSecrets,
      run.traceEnabled,
      dsl.visual,
      viewport,
      run.visualEnabled,
      Number(process.env.RUNNER_FINAL_SETTLE_MS ?? dsl.browser.finalScreenshotDelayMs)
    ).catch((error) => {
      console.error(`Failed to persist final artifacts for run ${run.id}:`, error);
    });
    await context.close().catch(() => undefined);
    if (run.videoEnabled) {
      await persistVideoArtifact(run.id, storage, page, viewport).catch((error) => {
        console.error(`Failed to persist video artifact for run ${run.id}:`, error);
      });
    }
    await browser.close().catch(() => undefined);
  }

  const finishedAt = new Date();
  const status = failed ? "failed" : "passed";
  await prisma.run.update({
    where: { id: run.id },
    data: {
      status,
      endUrl: page.url(),
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      error: runError,
      variables: publicRuntimeVariables(runtimeVariables, secretVariableNames)
    }
  });

  if (run.suiteRunId) {
    await reconcileSuiteRun(run.suiteRunId);
  }

  if (status === "passed" && run.visualEnabled) {
    await visualQueue.add("compare", { runId: run.id }, { jobId: `visual-${run.id}`, removeOnComplete: 100, removeOnFail: 100 });
  } else {
    await notifyQueue.add("send", { runId: run.id }, { jobId: `notify-${run.id}-${Date.now()}`, removeOnComplete: 100, removeOnFail: 100 });
  }
}

async function expandImportSteps(
  steps: TestStep[],
  projectId: string,
  runtimeVariables: Record<string, string>,
  importStack: string[]
): Promise<TestStep[]> {
  const expanded: TestStep[] = [];
  const sorted = [...steps].sort((a, b) => a.sequence - b.sequence);
  for (const step of sorted) {
    expanded.push(step);
    if (step.command !== "importSteps") continue;

    const target = interpolateVariables(step.value ?? step.target ?? "", runtimeVariables).trim();
    const imported = await resolveImportedSteps(target, projectId, importStack);
    const nested = await expandImportSteps(imported.steps, projectId, runtimeVariables, imported.importStack);
    for (const nestedStep of nested) {
      expanded.push({
        ...nestedStep,
        id: `${step.id}:${nestedStep.id}`
      });
    }
  }
  return expanded.map((step, index) => ({ ...step, sequence: index + 1 }));
}

async function resolveImportedSteps(
  target: string,
  projectId: string,
  importStack: string[]
): Promise<{ steps: TestStep[]; importStack: string[] }> {
  if (!target) {
    throw new Error("importSteps requires a test ID, test name, or JSON step list");
  }

  if (target.startsWith("[") || target.startsWith("{")) {
    const parsed = JSON.parse(target) as unknown;
    const compiled = Array.isArray(parsed)
      ? compileTestDsl({ name: "Inline import", startUrl: "about:blank", steps: parsed })
      : compileTestDsl(parsed);
    if (compiled.issues.length > 0) {
      throw new Error(`Imported steps are invalid: ${compiled.issues.map((issue) => issue.message).join("; ")}`);
    }
    return { steps: compiled.dsl.steps, importStack };
  }

  const importedTest = await prisma.test.findFirst({
    where: {
      projectId,
      OR: [{ id: target }, { name: target }]
    },
    include: {
      versions: {
        orderBy: { version: "desc" },
        take: 1
      }
    }
  });

  if (!importedTest) {
    throw new Error(`Imported test not found: ${target}`);
  }
  if (importStack.includes(importedTest.id)) {
    throw new Error(`Recursive import detected for test ${importedTest.name}`);
  }

  const version = importedTest.versions[0];
  if (!version) {
    throw new Error(`Imported test has no versions: ${importedTest.name}`);
  }

  const compiled = compileTestDsl(version.dsl);
  if (compiled.issues.length > 0) {
    throw new Error(`Imported test is invalid: ${compiled.issues.map((issue) => issue.message).join("; ")}`);
  }

  return { steps: compiled.dsl.steps, importStack: [...importStack, importedTest.id] };
}

async function recordStep(
  runId: string,
  step: TestStep,
  status: "passed" | "failed" | "skipped",
  startedAt: Date,
  finishedAt: Date,
  screenshotArtifactId: string | null,
  error: string | null,
  url: string,
  metadata: Record<string, unknown>
) {
  await prisma.runStepResult.create({
    data: {
      runId,
      stepId: step.id,
      sequence: step.sequence,
      command: step.command,
      status,
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      error,
      resolvedTarget: typeof metadata.resolvedSelector === "string" ? metadata.resolvedSelector : step.target,
      url,
      screenshotArtifactId,
      metadata: metadata as Prisma.InputJsonValue
    }
  });
}

async function captureStepFailure(
  runId: string,
  storage: ArtifactStorage,
  page: Page,
  stepId: string,
  viewport: { width: number; height: number }
) {
  if ("waitForLoadState" in page) {
    await waitForPageReady(page as Page, Number(process.env.RUNNER_FINAL_SETTLE_MS ?? 3000));
  }
  const screenshot = await page.screenshot({ fullPage: false, caret: "initial" });
  const uploaded = await storage.putBuffer(artifactKey(runId, "screenshot", `${stepId}-failure.png`), screenshot, "image/png");
  const artifact = await prisma.artifact.create({
    data: {
      runId,
      kind: "screenshot",
      key: uploaded.key,
      url: uploaded.url,
      contentType: uploaded.contentType,
      sizeBytes: uploaded.sizeBytes,
      metadata: { stepId, failure: true, fullPage: false, viewport }
    }
  });
  return artifact.id;
}

async function persistFinalArtifacts(
  runId: string,
  storage: ArtifactStorage,
  page: Page,
  context: { tracing: { stop(options: { path: string }): Promise<void> } },
  tmp: string,
  consoleMessages: ConsoleMessageRecord[],
  redactSecrets: Redactor,
  traceEnabled: boolean,
  visual: VisualSettings,
  viewport: { width: number; height: number },
  captureFinalScreenshot: boolean,
  finalDelayMs: number
) {
  if (captureFinalScreenshot) {
    await waitForPageReady(page, Number(process.env.RUNNER_NAVIGATION_SETTLE_MS ?? 3000));
    if (finalDelayMs > 0) {
      await page.waitForTimeout(finalDelayMs);
    }
    await waitForPageReady(page, Number(process.env.RUNNER_NAVIGATION_SETTLE_MS ?? 3000));
    const finalCapture = await captureFinalScreenshotForVisual(page, visual, viewport);
    const final = await storage.putBuffer(artifactKey(runId, "finalScreenshot", "final.png"), finalCapture.buffer, "image/png");
    await prisma.artifact.create({
      data: {
        runId,
        kind: "finalScreenshot",
        key: final.key,
        url: final.url,
        contentType: final.contentType,
        sizeBytes: final.sizeBytes,
        metadata: finalCapture.metadata
      }
    });
  }

  if (consoleMessages.length > 0) {
    const consoleArtifact = await storage.putJson(artifactKey(runId, "console", "console.json"), redactSecrets(consoleMessages));
    await prisma.artifact.create({
      data: {
        runId,
        kind: "console",
        key: consoleArtifact.key,
        url: consoleArtifact.url,
        contentType: consoleArtifact.contentType,
        sizeBytes: consoleArtifact.sizeBytes,
        metadata: { count: consoleMessages.length }
      }
    });
  }

  if (traceEnabled) {
    const tracePath = join(tmp, "trace.zip");
    await context.tracing.stop({ path: tracePath }).catch(() => undefined);
    const uploaded = await storage.putFile(artifactKey(runId, "trace", "trace.zip"), tracePath, "application/zip").catch(() => null);
    if (uploaded) {
      await prisma.artifact.create({
        data: {
          runId,
          kind: "trace",
          key: uploaded.key,
          url: uploaded.url,
          contentType: uploaded.contentType,
          sizeBytes: uploaded.sizeBytes,
          metadata: {}
        }
      });
    }
  }

}

async function captureFinalScreenshotForVisual(page: Page, visual: VisualSettings, viewport: { width: number; height: number }) {
  const exclusions = visual.screenshotExclusions.filter((selector) => selector.trim().length > 0);
  if (exclusions.length > 0) {
    await page
      .evaluate((selectors) => {
        for (const selector of selectors) {
          for (const element of document.querySelectorAll(selector)) {
            if (element instanceof HTMLElement || element instanceof SVGElement) {
              element.setAttribute("data-sentinelqa-hidden", element.getAttribute("style") ?? "");
              element.setAttribute("style", `${element.getAttribute("style") ?? ""}; visibility: hidden !important;`);
            }
          }
        }
      }, exclusions)
      .catch(() => undefined);
  }

  const target = visual.screenshotTarget?.trim();
  if (target) {
    const locator = page.locator(target).first();
    const count = await page.locator(target).count().catch(() => 0);
    if (count > 0) {
      const buffer = await locator.screenshot();
      return {
        buffer,
        metadata: { fullPage: false, viewport, screenshotTarget: target, screenshotExclusions: exclusions }
      };
    }
  }

  const buffer = await page.screenshot({ fullPage: visual.fullPage, caret: "initial" });
  return {
    buffer,
    metadata: {
      fullPage: visual.fullPage,
      viewport,
      screenshotTarget: target || null,
      screenshotTargetMatched: target ? false : null,
      screenshotExclusions: exclusions
    }
  };
}

async function persistVideoArtifact(
  runId: string,
  storage: ArtifactStorage,
  page: { video(): { path(): Promise<string> } | null },
  viewport: { width: number; height: number }
) {
  const video = page.video();
  const videoPath = await video?.path().catch(() => null);
  if (videoPath) {
    const uploaded = await storage.putFile(artifactKey(runId, "video", "run.webm"), videoPath, "video/webm").catch(() => null);
    if (uploaded) {
      await prisma.artifact.create({
        data: {
          runId,
          kind: "video",
          key: uploaded.key,
          url: uploaded.url,
          contentType: uploaded.contentType,
          sizeBytes: uploaded.sizeBytes,
          metadata: { width: viewport.width, height: viewport.height }
        }
      });
    }
  }
}

async function settleAfterStep(page: Page, step: TestStep, actionDelayMs: number, navigationSettleMs: number) {
  if (step.command !== "pause" && actionDelayMs > 0) {
    await page.waitForTimeout(actionDelayMs);
  }
  if (["open", "click", "keypress", "select", "dragDrop", "uploadFile", "executeJs"].includes(step.command) && navigationSettleMs > 0) {
    await waitForPageReady(page, navigationSettleMs);
  }
}

async function waitForPageReady(page: Page, timeoutMs: number) {
  const timeout = Math.max(0, timeoutMs);
  if (timeout === 0) return;
  await page.waitForLoadState("domcontentloaded", { timeout }).catch(() => undefined);
  await page.waitForLoadState("load", { timeout }).catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout }).catch(() => undefined);
  await page
    .evaluate(() => {
      const fonts = "fonts" in document ? document.fonts.ready : Promise.resolve();
      return fonts.then(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    })
    .catch(() => undefined);
}

function withStepConsole(metadata: Record<string, unknown>, messages: ConsoleMessageRecord[]) {
  if (messages.length === 0) {
    return metadata;
  }
  return { ...metadata, consoleMessages: messages };
}

async function resolveUserAgent(
  browserSettings: {
    userAgent?: string | null;
    userAgentSource?: string | null;
    userAgentBrowser?: string | null;
    userAgentPlatform?: string | null;
  },
  variables: Record<string, string>
) {
  const configured = interpolateVariables(browserSettings.userAgent ?? process.env.RUNNER_USER_AGENT ?? "", variables).trim();
  if (configured) return configured;

  const source = process.env.RUNNER_USER_AGENT_SOURCE ?? defaultUserAgentSource;
  if (!source) return undefined;

  try {
    const response = await fetch(source, { signal: AbortSignal.timeout(2500) });
    if (!response.ok) return undefined;
    const text = await response.text();
    const browser = browserSettings.userAgentBrowser ?? process.env.RUNNER_USER_AGENT_BROWSER ?? "chrome";
    const platform = normalizeUserAgentPlatform(
      browserSettings.userAgentPlatform ?? process.env.RUNNER_USER_AGENT_PLATFORM ?? (process.platform === "darwin" ? "macos" : "linux")
    );
    return pickUserAgent(text, browser, platform);
  } catch {
    return undefined;
  }
}

function pickUserAgent(sourceText: string, browser: string, platform: string) {
  const fromJson = parseUserAgentJson(sourceText);
  if (fromJson.length > 0) {
    return (
      fromJson.find((entry) => entry.browser === browser && normalizeUserAgentPlatform(entry.platform) === platform)?.user_agent ??
      fromJson.find((entry) => entry.browser === browser && entry.device_class === "desktop")?.user_agent ??
      fromJson.find((entry) => normalizeUserAgentPlatform(entry.platform) === platform)?.user_agent ??
      fromJson[0]?.user_agent
    );
  }

  const agents = sourceText.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
  const linuxMatcher = (entry: string) => entry.includes("X11") || entry.includes("Linux");
  const matchers: Record<string, (entry: string) => boolean> = {
    windows: (entry) => entry.includes("Windows"),
    macos: (entry) => entry.includes("Macintosh"),
    linux: linuxMatcher,
    ubuntu: linuxMatcher,
    android: (entry) => entry.includes("Android"),
    iphone: (entry) => entry.includes("iPhone"),
    ipad: (entry) => entry.includes("iPad")
  };
  const matcher = matchers[platform] ?? linuxMatcher;
  return agents.find(matcher) ?? agents[0];
}

function parseUserAgentJson(sourceText: string): UserAgentRecord[] {
  try {
    const parsed = JSON.parse(sourceText) as unknown;
    const items = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { items?: unknown }).items)
        ? (parsed as { items: unknown[] }).items
        : [];
    return items
      .flatMap((entry): UserAgentRecord[] => {
        if (!entry || typeof entry !== "object") return [];
        const item = entry as Record<string, unknown>;
        if (typeof item.user_agent !== "string" || typeof item.browser !== "string" || typeof item.platform !== "string") return [];
        return [{
          browser: item.browser,
          platform: item.platform,
          device_class: typeof item.device_class === "string" ? item.device_class : undefined,
          user_agent: item.user_agent
        }];
      });
  } catch {
    return [];
  }
}

function normalizeUserAgentPlatform(platform: string) {
  return platform === "mac" ? "macos" : platform;
}

function resolveHeaders(headers: Record<string, string>, variables: Record<string, string>) {
  const resolved: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(headers ?? {})) {
    const name = rawName.trim();
    if (!name || !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)) continue;
    resolved[name] = interpolateVariables(rawValue, variables);
  }
  return resolved;
}

function publicRuntimeVariables(variables: Record<string, string>, secretNames: Set<string>) {
  return Object.fromEntries(Object.entries(variables).filter(([name]) => !secretNames.has(name)));
}

function createSecretRedactor(secretValues: string[]): Redactor {
  const values = [...new Set(secretValues.filter((value) => value.length > 0))];
  const redactString = (value: string) => values.reduce((next, secret) => next.split(secret).join("[secret]"), value);

  const redactUnknown = (value: unknown): unknown => {
    if (typeof value === "string") return redactString(value);
    if (Array.isArray(value)) return value.map(redactUnknown);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, redactUnknown(child)]));
  };

  return <T>(value: T) => redactUnknown(value) as T;
}

async function failRun(runId: string, startedAt: Date, error: string) {
  const finishedAt = new Date();
  await prisma.run.update({
    where: { id: runId },
    data: {
      status: "failed",
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      error
    }
  });
  await notifyQueue.add("send", { runId }, { jobId: `notify-${runId}-${Date.now()}`, removeOnComplete: 100, removeOnFail: 100 });
}

async function reconcileSuiteRun(suiteRunId: string) {
  const suiteRun = await prisma.suiteRun.findUnique({ where: { id: suiteRunId }, include: { runs: true } });
  if (!suiteRun || suiteRun.runs.some((run) => run.status === "queued" || run.status === "running")) {
    return;
  }
  const failed = suiteRun.runs.some((run) => run.status === "failed" || run.status === "cancelled");
  await prisma.suiteRun.update({
    where: { id: suiteRunId },
    data: {
      status: failed ? "failed" : "passed",
      finishedAt: new Date()
    }
  });
}

function objectToStrings(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, String(entry ?? "")]));
}

function objectToViewport(value: unknown): { width: number; height: number } {
  if (!value || typeof value !== "object") return { width: 1920, height: 1080 };
  const viewport = value as { width?: unknown; height?: unknown };
  return {
    width: Number(viewport.width ?? 1920),
    height: Number(viewport.height ?? 1080)
  };
}

function objectToGeolocation(value: unknown): { latitude: number; longitude: number; accuracy?: number } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const geo = value as { latitude?: unknown; longitude?: unknown; accuracy?: unknown };
  if (geo.latitude == null || geo.longitude == null) return undefined;
  return {
    latitude: Number(geo.latitude),
    longitude: Number(geo.longitude),
    accuracy: geo.accuracy == null ? undefined : Number(geo.accuracy)
  };
}
