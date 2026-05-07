import { z } from "zod";

export const stepCommands = [
  "open",
  "click",
  "fill",
  "select",
  "keypress",
  "hover",
  "dragDrop",
  "uploadFile",
  "pause",
  "executeJs",
  "assertElementPresent",
  "assertElementNotPresent",
  "assertElementVisible",
  "assertElementNotVisible",
  "assertTextEquals",
  "assertTextContains",
  "assertUrlContains",
  "assertJsReturnsTrue",
  "extractText",
  "setVariable",
  "checkAccessibility",
  "captureScreenshot",
  "importSteps",
  "exitTest"
] as const;

export const stepCommandSchema = z.enum(stepCommands);
export type StepCommand = z.infer<typeof stepCommandSchema>;

export const viewportSchema = z.object({
  width: z.number().int().min(320).max(7680),
  height: z.number().int().min(240).max(4320)
});

export const testStepSchema = z.object({
  id: z.string().min(1),
  command: stepCommandSchema,
  target: z.string().optional().nullable(),
  value: z.string().optional().nullable(),
  variableName: z.string().optional().nullable(),
  optional: z.boolean().default(false),
  privateValue: z.boolean().default(false),
  notes: z.string().optional().nullable(),
  timeoutMs: z.number().int().min(0).max(300000).optional().nullable(),
  backupSelectors: z.array(z.string()).default([]),
  autoScroll: z.boolean().optional().nullable(),
  conditionJs: z.string().optional().nullable(),
  sequence: z.number().int().min(0)
});

export const visualSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  threshold: z.number().min(0).max(100).default(0.2),
  regionKey: z.string().optional().nullable(),
  fullPage: z.boolean().default(false),
  screenshotTarget: z.string().optional().nullable(),
  screenshotExclusions: z.array(z.string()).default([])
});

export const browserSettingsSchema = z.object({
  browser: z.enum(["chromium"]).default("chromium"),
  viewport: viewportSchema.default({ width: 1920, height: 1080 }),
  locale: z.string().optional().nullable(),
  timezone: z.string().optional().nullable(),
  geolocation: z
    .object({
      latitude: z.number(),
      longitude: z.number(),
      accuracy: z.number().optional()
    })
    .optional()
    .nullable(),
  userAgent: z.string().optional().nullable(),
  userAgentSource: z.string().url().optional().nullable(),
  userAgentBrowser: z.enum(["chrome", "edge", "firefox", "safari"]).default("chrome"),
  userAgentPlatform: z.enum(["windows", "mac", "macos", "linux", "ubuntu", "android", "iphone", "ipad"]).default("linux"),
  acceptLanguage: z.string().optional().nullable(),
  headers: z.record(z.string(), z.string()).default({}),
  localStorage: z.record(z.string(), z.string()).default({}),
  cookies: z
    .array(
      z.object({
        name: z.string().min(1),
        value: z.string(),
        url: z.string().url().optional().nullable(),
        domain: z.string().optional().nullable(),
        path: z.string().optional().nullable(),
        expires: z.number().optional().nullable(),
        httpOnly: z.boolean().default(false),
        secure: z.boolean().optional().nullable(),
        sameSite: z.enum(["Strict", "Lax", "None"]).optional().nullable()
      })
    )
    .default([]),
  actionDelayMs: z.number().int().min(0).max(10000).default(500),
  navigationSettleMs: z.number().int().min(0).max(30000).default(1200),
  finalScreenshotDelayMs: z.number().int().min(0).max(30000).default(1000),
  elementTimeoutMs: z.number().int().min(100).max(60000).default(15000),
  trace: z.boolean().default(true),
  video: z.boolean().default(true)
});

export const testDslSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  name: z.string().min(1),
  startUrl: z.string().min(1),
  defaultVariables: z.record(z.string(), z.string()).default({}),
  secretVariables: z.record(z.string(), z.string()).default({}),
  suiteVariables: z.record(z.string(), z.string()).default({}),
  visual: visualSettingsSchema.default({ enabled: false, threshold: 0.2, fullPage: false, screenshotExclusions: [] }),
  browser: browserSettingsSchema.default({
    browser: "chromium",
    viewport: { width: 1920, height: 1080 },
    userAgentBrowser: "chrome",
    userAgentPlatform: "linux",
    headers: {},
    localStorage: {},
    cookies: [],
    actionDelayMs: 500,
    navigationSettleMs: 1200,
    finalScreenshotDelayMs: 1000,
    elementTimeoutMs: 15000,
    trace: true,
    video: true
  }),
  steps: z.array(testStepSchema).default([])
});

export type TestStep = z.infer<typeof testStepSchema>;
export type TestDsl = z.infer<typeof testDslSchema>;
export type BrowserSettings = z.infer<typeof browserSettingsSchema>;
export type VisualSettings = z.infer<typeof visualSettingsSchema>;

export const testDslJsonSchema = z.toJSONSchema(testDslSchema, { target: "draft-7" });

export const targetRequiredCommands = new Set<StepCommand>([
  "open",
  "click",
  "fill",
  "select",
  "keypress",
  "hover",
  "dragDrop",
  "uploadFile",
  "assertElementPresent",
  "assertElementNotPresent",
  "assertElementVisible",
  "assertElementNotVisible",
  "assertTextEquals",
  "assertTextContains",
  "extractText"
]);

export const valueRequiredCommands = new Set<StepCommand>([
  "fill",
  "select",
  "keypress",
  "dragDrop",
  "uploadFile",
  "pause",
  "assertTextEquals",
  "assertTextContains",
  "setVariable",
  "importSteps"
]);

export const variableNameRequiredCommands = new Set<StepCommand>(["extractText", "setVariable"]);
