import type { Locator, Page } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";
import type { TestStep } from "@sentinelqa/dsl";
import { animateCursorDrag, hideCursor, moveCursorToLocator, pulseCursor } from "./cursor.js";

export type RuntimeVariables = Record<string, string>;

export interface CommandContext {
  page: Page;
  variables: RuntimeVariables;
  defaultTimeoutMs: number;
  uploadArtifact(kind: "screenshot" | "accessibility", filename: string, content: Buffer, contentType: string, metadata?: Record<string, unknown>): Promise<string>;
}

export const runnerCommands = {
  open: "page.goto",
  click: "locator.click",
  fill: "locator.fill",
  select: "locator.selectOption",
  keypress: "keyboard.press",
  hover: "locator.hover",
  dragDrop: "locator.dragTo",
  uploadFile: "locator.setInputFiles",
  pause: "page.waitForTimeout",
  executeJs: "page.evaluate",
  assertElementPresent: "locator.count",
  assertElementNotPresent: "locator.count",
  assertElementVisible: "locator.waitFor",
  assertElementNotVisible: "locator.waitFor",
  assertTextEquals: "locator.textContent",
  assertTextContains: "locator.textContent",
  assertUrlContains: "page.url",
  assertJsReturnsTrue: "page.evaluate",
  extractText: "locator.textContent",
  setVariable: "variables",
  checkAccessibility: "AxeBuilder.analyze",
  captureScreenshot: "page.screenshot",
  importSteps: "inline.steps",
  exitTest: "runner.stop"
} as const;

const impactRank: Record<string, number> = {
  minor: 1,
  moderate: 2,
  serious: 3,
  critical: 4
};

function requireValue(value: string | null | undefined, label: string): string {
  if (!value) {
    throw new Error(`${label} is required`);
  }
  return value;
}

function accessibilityThreshold(value: string | null | undefined): number {
  if (!value || value === "any") return 1;
  return impactRank[value.toLowerCase()] ?? 1;
}

function impactScore(value: string | null | undefined): number {
  return impactRank[value ?? "minor"] ?? 1;
}

async function locatorForStep(page: Page, step: TestStep, timeoutMs: number): Promise<{ locator: Locator; selector: string }> {
  const selectors = [step.target, ...(step.backupSelectors ?? [])].filter((selector): selector is string => Boolean(selector?.trim()));
  if (selectors.length === 0) {
    throw new Error("target is required");
  }

  const misses: string[] = [];
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    const attached = await locator.waitFor({ state: "attached", timeout: timeoutMs }).then(
      () => true,
      (error) => {
        misses.push(`${selector}: ${error instanceof Error ? error.message : String(error)}`);
        return false;
      }
    );
    if (attached) {
      return { locator, selector };
    }

    const count = await page.locator(selector).count().catch((error) => {
      misses.push(`${selector}: ${error instanceof Error ? error.message : String(error)}`);
      return 0;
    });
    if (count > 0) {
      return { locator: page.locator(selector).first(), selector };
    }
    misses.push(`${selector}: no matches`);
  }

  throw new Error(`No matching selector found. Tried ${misses.join("; ")}`);
}

function timeoutFor(step: TestStep, ctx: CommandContext, fallback = 10000) {
  return step.timeoutMs ?? ctx.defaultTimeoutMs ?? fallback;
}

async function selectorExists(page: Page, step: TestStep, timeoutMs = 0): Promise<{ exists: boolean; selector?: string }> {
  const selectors = [step.target, ...(step.backupSelectors ?? [])].filter((selector): selector is string => Boolean(selector?.trim()));
  if (selectors.length === 0) {
    throw new Error("target is required");
  }

  for (const selector of selectors) {
    if (timeoutMs > 0) {
      const attached = await page.locator(selector).first().waitFor({ state: "attached", timeout: timeoutMs }).then(() => true, () => false);
      if (attached) {
        return { exists: true, selector };
      }
    }
    const count = await page.locator(selector).count().catch(() => 0);
    if (count > 0) {
      return { exists: true, selector };
    }
  }
  return { exists: false };
}

async function anySelectorVisible(page: Page, step: TestStep, timeoutMs: number): Promise<{ visible: boolean; selector?: string }> {
  const selectors = [step.target, ...(step.backupSelectors ?? [])].filter((selector): selector is string => Boolean(selector?.trim()));
  if (selectors.length === 0) {
    throw new Error("target is required");
  }

  for (const selector of selectors) {
    const visible = await page.locator(selector).first().waitFor({ state: "visible", timeout: timeoutMs }).then(() => true, () => false);
    if (visible) {
      return { visible: true, selector };
    }
  }
  return { visible: false };
}

function shouldAutoScroll(step: TestStep): boolean {
  return (step.command === "assertElementPresent" || step.command === "assertElementVisible") && step.autoScroll !== false;
}

async function scrollIfEnabled(locator: Locator, step: TestStep, timeoutMs: number): Promise<boolean> {
  if (!shouldAutoScroll(step)) {
    return false;
  }

  return locator.scrollIntoViewIfNeeded({ timeout: Math.min(timeoutMs, 5000) }).then(() => true, () => false);
}

async function textFor(page: Page, step: TestStep, timeoutMs: number): Promise<{ text: string; selector: string }> {
  const { locator, selector } = await locatorForStep(page, step, timeoutMs);
  return { text: (await locator.textContent({ timeout: timeoutMs }))?.trim() ?? "", selector };
}

async function waitForText(
  page: Page,
  step: TestStep,
  timeoutMs: number,
  expected: string,
  mode: "equals" | "contains"
): Promise<{ text: string; selector: string }> {
  const startedAt = Date.now();
  const { locator, selector } = await locatorForStep(page, step, timeoutMs);
  const deadline = startedAt + timeoutMs;
  let text = "";

  while (Date.now() <= deadline) {
    text = (await locator.textContent({ timeout: Math.min(1000, Math.max(1, deadline - Date.now())) }).catch(() => ""))?.trim() ?? "";
    if (mode === "equals" ? text === expected : text.includes(expected)) {
      return { text, selector };
    }
    await page.waitForTimeout(250);
  }

  return { text, selector };
}

async function evaluateStepScript(page: Page, script: string): Promise<unknown> {
  return page.evaluate((source) => {
    const trimmed = source.trim();
    if (/^return\b/.test(trimmed) || trimmed.includes(";")) {
      return new Function(trimmed)();
    }
    return new Function(`return (${trimmed});`)();
  }, script);
}

export async function runStepCommand(step: TestStep, ctx: CommandContext): Promise<{ stop?: boolean; metadata?: Record<string, unknown> }> {
  const page = ctx.page;
  const target = step.target ?? undefined;
  const value = step.value === "" || step.value == null ? undefined : step.value;
  switch (step.command) {
    case "open":
      {
        const response = await page.goto(requireValue(target, "target"), { waitUntil: "load", timeout: timeoutFor(step, ctx, 30000) });
        const status = response?.status() ?? null;
        return { metadata: { httpStatus: status, resolvedUrl: page.url() } };
      }
    case "click":
      {
        const { locator, selector } = await locatorForStep(page, step, timeoutFor(step, ctx));
        await moveCursorToLocator(page, locator, timeoutFor(step, ctx));
        await locator.click({ timeout: timeoutFor(step, ctx) });
        await pulseCursor(page);
        return { metadata: { resolvedSelector: selector } };
      }
    case "fill":
      {
        const { locator, selector } = await locatorForStep(page, step, timeoutFor(step, ctx));
        await moveCursorToLocator(page, locator, timeoutFor(step, ctx));
        await locator.fill(requireValue(value, "value"), { timeout: timeoutFor(step, ctx) });
        return { metadata: { resolvedSelector: selector } };
      }
    case "select":
      {
        const { locator, selector } = await locatorForStep(page, step, timeoutFor(step, ctx));
        await moveCursorToLocator(page, locator, timeoutFor(step, ctx));
        await locator.selectOption(requireValue(value, "value"), { timeout: timeoutFor(step, ctx) });
        return { metadata: { resolvedSelector: selector } };
      }
    case "keypress":
      if (target) {
        const { locator, selector } = await locatorForStep(page, step, timeoutFor(step, ctx));
        await moveCursorToLocator(page, locator, timeoutFor(step, ctx));
        await locator.press(requireValue(value, "value"), { timeout: timeoutFor(step, ctx) });
        return { metadata: { resolvedSelector: selector } };
      } else {
        await page.keyboard.press(requireValue(value, "value"));
      }
      return {};
    case "hover":
      {
        const { locator, selector } = await locatorForStep(page, step, timeoutFor(step, ctx));
        await moveCursorToLocator(page, locator, timeoutFor(step, ctx));
        await locator.hover({ timeout: timeoutFor(step, ctx) });
        return { metadata: { resolvedSelector: selector } };
      }
    case "dragDrop":
      {
        const { locator, selector } = await locatorForStep(page, step, timeoutFor(step, ctx));
        const targetLocator = page.locator(requireValue(value, "value")).first();
        await animateCursorDrag(page, locator, targetLocator, timeoutFor(step, ctx));
        await locator.dragTo(targetLocator, {
          timeout: timeoutFor(step, ctx)
        });
        return { metadata: { resolvedSelector: selector } };
      }
    case "uploadFile":
      {
        const { locator, selector } = await locatorForStep(page, step, timeoutFor(step, ctx));
        await moveCursorToLocator(page, locator, timeoutFor(step, ctx));
        await locator.setInputFiles(requireValue(value, "value"), { timeout: timeoutFor(step, ctx) });
        return { metadata: { resolvedSelector: selector } };
      }
    case "pause":
      await page.waitForTimeout(Number(requireValue(value, "value")));
      return {};
    case "executeJs":
      return { metadata: { result: await evaluateStepScript(page, requireValue(target ?? value, "script")) } };
    case "assertElementPresent":
      {
        const { locator, selector } = await locatorForStep(page, step, timeoutFor(step, ctx));
        const autoScrolled = await scrollIfEnabled(locator, step, timeoutFor(step, ctx));
        return { metadata: { resolvedSelector: selector, autoScrolled } };
      }
    case "assertElementNotPresent":
      if ((await selectorExists(page, step)).exists) throw new Error("Element was present");
      return {};
    case "assertElementVisible":
      {
        const { locator, selector } = await locatorForStep(page, step, timeoutFor(step, ctx));
        const autoScrolled = await scrollIfEnabled(locator, step, timeoutFor(step, ctx));
        const visible = await locator.waitFor({ state: "visible", timeout: timeoutFor(step, ctx) }).then(() => true, () => false);
        if (!visible) throw new Error("Element was not visible");
        return { metadata: { resolvedSelector: selector, autoScrolled } };
      }
    case "assertElementNotVisible":
      if ((await anySelectorVisible(page, step, timeoutFor(step, ctx))).visible) throw new Error("Element was visible");
      return {};
    case "assertTextEquals": {
      const expected = requireValue(value, "value");
      const { text, selector } = await waitForText(page, step, timeoutFor(step, ctx), expected, "equals");
      if (text !== requireValue(value, "value")) throw new Error(`Expected text "${value}", received "${text}"`);
      return { metadata: { text, resolvedSelector: selector } };
    }
    case "assertTextContains": {
      const expected = requireValue(value, "value");
      const { text, selector } = await waitForText(page, step, timeoutFor(step, ctx), expected, "contains");
      if (!text.includes(expected)) throw new Error(`Expected text to contain "${value}", received "${text}"`);
      return { metadata: { text, resolvedSelector: selector } };
    }
    case "assertUrlContains":
      if (!page.url().includes(requireValue(value ?? target, "value"))) throw new Error(`URL did not contain "${value ?? target}"`);
      return { metadata: { url: page.url() } };
    case "assertJsReturnsTrue": {
      const result = await evaluateStepScript(page, requireValue(target ?? value, "script"));
      if (result !== true) throw new Error(`Expected JS to return true, received ${String(result)}`);
      return { metadata: { result } };
    }
    case "extractText":
      {
        const { text, selector } = await textFor(page, step, timeoutFor(step, ctx));
        ctx.variables[requireValue(step.variableName, "variableName")] = text;
        return { metadata: { resolvedSelector: selector } };
      }
    case "setVariable":
      ctx.variables[requireValue(step.variableName, "variableName")] = requireValue(value, "value");
      return {};
    case "checkAccessibility": {
      const results = await new AxeBuilder({ page }).analyze();
      const threshold = accessibilityThreshold(value);
      const thresholdViolations = results.violations.filter((violation) => impactScore(violation.impact) >= threshold);
      const artifactId = await ctx.uploadArtifact("accessibility", "axe-results.json", Buffer.from(JSON.stringify(results, null, 2)), "application/json", {
        stepId: step.id,
        violationCount: results.violations.length,
        thresholdViolationCount: thresholdViolations.length,
        threshold: value || "any"
      });
      if (thresholdViolations.length > 0) {
        throw new Error(`${thresholdViolations.length} accessibility violation(s) at or above ${value || "any"} threshold`);
      }
      return { metadata: { violationCount: results.violations.length, thresholdViolationCount: 0, threshold: value || "any", artifactId } };
    }
    case "captureScreenshot": {
      await hideCursor(page);
      const screenshotTarget = target?.trim();
      const label = value ?? (!screenshotTarget ? step.id : undefined);
      const locator = screenshotTarget ? page.locator(screenshotTarget).first() : null;
      const targetCount = screenshotTarget ? await page.locator(screenshotTarget).count().catch(() => 0) : 0;
      if (screenshotTarget && value && targetCount === 0) {
        throw new Error(`Screenshot target not found: ${screenshotTarget}`);
      }
      const screenshot = targetCount > 0 && locator ? await locator.screenshot() : await page.screenshot({ fullPage: false, caret: "initial" });
      const filename = `${safeArtifactName(label ?? screenshotTarget ?? step.id)}.png`;
      const artifactId = await ctx.uploadArtifact("screenshot", filename, screenshot, "image/png", {
        stepId: step.id,
        label: label ?? screenshotTarget ?? step.id,
        url: page.url(),
        fullPage: false,
        screenshotTarget: targetCount > 0 ? screenshotTarget : null
      });
      return { metadata: { artifactId, fullPage: false, screenshotTarget: targetCount > 0 ? screenshotTarget : null } };
    }
    case "importSteps": {
      return { metadata: { importTarget: requireValue(value ?? target, "value") } };
    }
    case "exitTest":
      if (String(value ?? "passed").toLowerCase() === "failed") {
        throw new Error("Exit test marked the run as failed");
      }
      return { stop: true };
  }
}

function safeArtifactName(value: string): string {
  return value.trim().replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "screenshot";
}
