import { fileURLToPath } from "node:url";
import { prisma, hashApiToken } from "../src/index.js";
import { compileTestDsl, type TestDsl, type TestStep } from "@sentinelqa/dsl";

const token = "sentinelqa-dev-token";
const uploadFixturePath = fileURLToPath(new URL("../../../tests/fixtures/upload-note.txt", import.meta.url));

const browser = {
  browser: "chromium" as const,
  viewport: { width: 1920, height: 1080 },
  userAgentSource: "https://ua.syntax9.ai/api/all.json",
  userAgentBrowser: "chrome" as const,
  userAgentPlatform: "linux" as const,
  headers: {},
  actionDelayMs: 500,
  navigationSettleMs: 1500,
  finalScreenshotDelayMs: 1200,
  elementTimeoutMs: 15000,
  trace: true,
  video: true
};

type StepInput = Pick<TestStep, "command"> & Partial<Omit<TestStep, "id" | "command" | "sequence">>;

function step(id: string, sequence: number, input: StepInput): TestStep {
  return {
    id,
    command: input.command,
    target: input.target ?? "",
    value: input.value ?? "",
    variableName: input.variableName ?? "",
    optional: input.optional ?? false,
    privateValue: input.privateValue ?? false,
    notes: input.notes ?? "",
    timeoutMs: input.timeoutMs ?? null,
    backupSelectors: input.backupSelectors ?? [],
    conditionJs: input.conditionJs ?? "",
    sequence
  };
}

function dsl(input: {
  name: string;
  startUrl: string;
  defaultVariables?: Record<string, string>;
  suiteVariables?: Record<string, string>;
  visual?: TestDsl["visual"];
  steps: TestStep[];
}): TestDsl {
  const compiled = compileTestDsl({
    schemaVersion: 1,
    name: input.name,
    startUrl: input.startUrl,
    defaultVariables: input.defaultVariables ?? {},
    secretVariables: {},
    suiteVariables: input.suiteVariables ?? {},
    visual: input.visual ?? { enabled: true, threshold: 0.5, fullPage: false, screenshotExclusions: [] },
    browser,
    steps: input.steps
  });
  if (compiled.issues.length > 0) {
    throw new Error(compiled.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
  }
  return compiled.dsl;
}

async function resetProjectQaData(projectId: string) {
  const oldSuites = await prisma.suite.findMany({ where: { projectId }, select: { id: true } });
  const oldTests = await prisma.test.findMany({ where: { projectId }, select: { id: true } });
  const oldRuns = await prisma.run.findMany({ where: { projectId }, select: { id: true } });
  const suiteIds = oldSuites.map((suite) => suite.id);
  const testIds = oldTests.map((test) => test.id);
  const runIds = oldRuns.map((run) => run.id);

  await prisma.visualBaseline.deleteMany({ where: { testId: { in: testIds } } });
  await prisma.webhookDelivery.deleteMany({ where: { runId: { in: runIds } } });
  await prisma.runComment.deleteMany({ where: { runId: { in: runIds } } });
  await prisma.runStepResult.deleteMany({ where: { runId: { in: runIds } } });
  await prisma.artifact.deleteMany({ where: { runId: { in: runIds } } });
  await prisma.run.deleteMany({ where: { id: { in: runIds } } });
  await prisma.suiteRun.deleteMany({ where: { suiteId: { in: suiteIds } } });
  await prisma.schedule.deleteMany({ where: { OR: [{ suiteId: { in: suiteIds } }, { testId: { in: testIds } }] } });
  await prisma.variableSet.deleteMany({ where: { OR: [{ suiteId: { in: suiteIds } }, { testId: { in: testIds } }] } });
  await prisma.dataSource.deleteMany({ where: { projectId } });
  await prisma.test.deleteMany({ where: { projectId } });
  await prisma.suite.deleteMany({ where: { projectId } });
  await prisma.folder.deleteMany({ where: { projectId } });
}

async function createSuite(
  projectId: string,
  name: string,
  description: string,
  variables: Record<string, string> = {},
  secretVariables: Record<string, string> = {},
  browserOptions: Record<string, unknown> = {}
) {
  return prisma.suite.create({ data: { projectId, name, description, variables, secretVariables, browserOptions } });
}

async function createTest(projectId: string, suiteId: string, testDsl: TestDsl) {
  const test = await prisma.test.create({
    data: {
      projectId,
      suiteId,
      name: testDsl.name,
      startUrl: testDsl.startUrl,
      defaults: testDsl.defaultVariables,
      visualEnabled: testDsl.visual.enabled,
      visualThreshold: testDsl.visual.threshold
    }
  });

  await prisma.testVersion.create({
    data: {
      testId: test.id,
      version: 1,
      dsl: testDsl,
      steps: {
        create: testDsl.steps.map((testStep) => ({
          command: testStep.command,
          target: testStep.target,
          value: testStep.value,
          variableName: testStep.variableName,
          optional: testStep.optional,
          privateValue: testStep.privateValue,
          notes: testStep.notes,
          timeoutMs: testStep.timeoutMs,
          backupSelectors: testStep.backupSelectors,
          conditionJs: testStep.conditionJs,
          sequence: testStep.sequence
        }))
      }
    }
  });

  return test;
}

async function main() {
  const user = await prisma.user.upsert({
    where: { email: "dev@sentinelqa.local" },
    update: { name: "SentinelQA Dev" },
    create: { email: "dev@sentinelqa.local", name: "SentinelQA Dev" }
  });

  const org = await prisma.organization.upsert({
    where: { slug: "sentinelqa-dev" },
    update: { name: "SentinelQA Dev" },
    create: { name: "SentinelQA Dev", slug: "sentinelqa-dev" }
  });

  await prisma.organizationMember.upsert({
    where: { userId_organizationId: { userId: user.id, organizationId: org.id } },
    update: { role: "owner" },
    create: { userId: user.id, organizationId: org.id, role: "owner" }
  });

  const project = await prisma.project.upsert({
    where: { organizationId_slug: { organizationId: org.id, slug: "public-web" } },
    update: { name: "Public Web QA" },
    create: { organizationId: org.id, name: "Public Web QA", slug: "public-web" }
  });

  await resetProjectQaData(project.id);

  await prisma.environment.upsert({
    where: { projectId_slug: { projectId: project.id, slug: "internet" } },
    update: {
      name: "Internet",
      baseUrl: null,
      variables: { publicInternet: "true" }
    },
    create: {
      projectId: project.id,
      name: "Internet",
      slug: "internet",
      baseUrl: null,
      variables: { publicInternet: "true" }
    }
  });

  const editorialSuite = await createSuite(
    project.id,
    "Editorial Site Journeys",
    "Long-form checks against public content sites with search, extraction, accessibility, screenshots, and visual baselines."
  );
  const formSuite = await createSuite(
    project.id,
    "Form and Input Coverage",
    "Field fill, select, upload, private values, checkbox/radio clicks, submit validation, and URL assertions."
  );
  const interactionSuite = await createSuite(
    project.id,
    "Interaction Mechanics",
    "Hover, pause, drag and drop, backup selectors, and screenshot captures on public interactive pages."
  );
  const moduleSuite = await createSuite(
    project.id,
    "Reusable Checks",
    "Shared step groups plus parent tests that reuse them like subroutines."
  );
  const matrixSuite = await createSuite(
    project.id,
    "Data Source Matrix",
    "CSV-style row variables that fan out checks across multiple article rows."
  );

  const moduleContract = dsl({
    name: "Reusable check: public landing page content",
    startUrl: "https://example.com/",
    visual: { enabled: false, threshold: 0.5, fullPage: false, screenshotExclusions: [] },
    steps: [
      step("module-open", 1, { command: "open", target: "https://example.com/" }),
      step("module-heading-equals", 2, { command: "assertTextEquals", target: "h1", value: "Example Domain" }),
      step("module-missing-banner", 3, { command: "assertElementNotPresent", target: ".sentinelqa-missing-banner", timeoutMs: 500 }),
      step("module-hidden-banner", 4, { command: "assertElementNotVisible", target: ".sentinelqa-hidden-banner", timeoutMs: 500 }),
      step("module-execute-js", 5, { command: "executeJs", target: "window.__sentinelqaModule = 'example-content'; return true;" }),
      step("module-js-true", 6, { command: "assertJsReturnsTrue", target: "return window.__sentinelqaModule === 'example-content';" }),
      step("module-a11y", 7, { command: "checkAccessibility", value: "critical" }),
      step("module-set-variable", 8, { command: "setVariable", variableName: "detailsHost", value: "iana.org" }),
      step("module-screenshot", 9, { command: "captureScreenshot", value: "Landing page before reference link" })
    ]
  });

  const testsBySuite = new Map<string, TestDsl[]>([
    [
      editorialSuite.id,
      [
        dsl({
          name: "Wikipedia search extracts article heading",
          startUrl: "https://en.wikipedia.org/wiki/Main_Page",
          defaultVariables: { articleQuery: "Playwright (software)", expectedTitle: "Playwright" },
          visual: { enabled: true, threshold: 1, fullPage: false, screenshotExclusions: ["#p-personal", ".vector-page-toolbar"] },
          steps: [
            step("wiki-open", 1, { command: "open", target: "https://en.wikipedia.org/wiki/Main_Page" }),
            step("wiki-cookie-dismiss", 2, { command: "click", target: "button:has-text('Accept')", optional: true, notes: "Only appears in some regions." }),
            step("wiki-fill-search", 3, { command: "fill", target: "input[name=\"search\"]", backupSelectors: ["#searchInput"], value: "{{articleQuery}}" }),
            step("wiki-enter-search", 4, { command: "keypress", target: "input[name=\"search\"]", backupSelectors: ["#searchInput"], value: "Enter" }),
            step("wiki-url", 5, { command: "assertUrlContains", value: "Playwright" }),
            step("wiki-heading-visible", 6, { command: "assertElementVisible", target: "#firstHeading" }),
            step("wiki-heading-text", 7, { command: "assertTextContains", target: "#firstHeading", value: "{{expectedTitle}}" }),
            step("wiki-extract-heading", 8, { command: "extractText", target: "#firstHeading", variableName: "resolvedHeading" }),
            step("wiki-js-heading", 9, { command: "assertJsReturnsTrue", target: "return document.body.innerText.includes('{{resolvedHeading}}');" }),
            step("wiki-screenshot", 10, { command: "captureScreenshot", value: "Wikipedia article result" })
          ]
        }),
        dsl({
          name: "Playwright docs navigation validates search page",
          startUrl: "https://playwright.dev/",
          visual: { enabled: true, threshold: 1, fullPage: false, screenshotExclusions: [".navbar__items--right"] },
          steps: [
            step("pw-open", 1, { command: "open", target: "https://playwright.dev/" }),
            step("pw-heading", 2, { command: "assertTextContains", target: "h1", value: "Playwright" }),
            step("pw-hover-docs", 3, { command: "hover", target: "a[href=\"/docs/intro\"]", backupSelectors: ["a[href*='docs/intro']"] }),
            step("pw-click-docs", 4, { command: "click", target: "a[href=\"/docs/intro\"]", backupSelectors: ["a[href*='docs/intro']"] }),
            step("pw-url-docs", 5, { command: "assertUrlContains", value: "/docs/intro" }),
            step("pw-docs-heading", 6, { command: "assertTextContains", target: "h1", value: "Installation" }),
            step("pw-extract-title", 7, { command: "extractText", target: "h1", variableName: "docsHeading" }),
            step("pw-js-heading", 8, { command: "assertJsReturnsTrue", target: "return document.title.includes('{{docsHeading}}') || document.body.innerText.includes('{{docsHeading}}');" }),
            step("pw-screenshot", 9, { command: "captureScreenshot", value: "Playwright installation page" })
          ]
        })
      ]
    ],
    [
      formSuite.id,
      [
        dsl({
          name: "Selenium web form submits with file upload",
          startUrl: "https://www.selenium.dev/selenium/web/web-form.html",
          defaultVariables: { message: "SentinelQA public form smoke" },
          visual: { enabled: true, threshold: 1, fullPage: false, screenshotExclusions: [] },
          steps: [
            step("form-open", 1, { command: "open", target: "https://www.selenium.dev/selenium/web/web-form.html" }),
            step("form-text", 2, { command: "fill", target: "input[name=\"my-text\"]", value: "{{message}}" }),
            step("form-password", 3, { command: "fill", target: "input[name=\"my-password\"]", value: "local-dev-secret", privateValue: true }),
            step("form-textarea", 4, { command: "fill", target: "textarea[name=\"my-textarea\"]", value: "Testing fill, textarea, select, upload, and submit in one run." }),
            step("form-select", 5, { command: "select", target: "select[name=\"my-select\"]", value: "2" }),
            step("form-checkbox", 6, { command: "click", target: "#my-check-2" }),
            step("form-radio", 7, { command: "click", target: "#my-radio-2" }),
            step("form-upload", 8, { command: "uploadFile", target: "input[name=\"my-file\"]", value: uploadFixturePath, privateValue: true }),
            step("form-submit", 9, { command: "click", target: "button[type=\"submit\"]" }),
            step("form-url", 10, { command: "assertUrlContains", value: "submitted-form.html" }),
            step("form-title", 11, { command: "assertTextContains", target: "h1", value: "Form submitted" }),
            step("form-message", 12, { command: "assertTextContains", target: "#message", value: "Received" }),
            step("form-screenshot", 13, { command: "captureScreenshot", value: "Submitted Selenium web form" })
          ]
        }),
        dsl({
          name: "Invalid login shows validation feedback",
          startUrl: "https://the-internet.herokuapp.com/login",
          defaultVariables: { username: "not-a-real-user", password: "wrong-password" },
          visual: { enabled: false, threshold: 0.5, fullPage: false, screenshotExclusions: [] },
          steps: [
            step("login-open", 1, { command: "open", target: "https://the-internet.herokuapp.com/login" }),
            step("login-heading", 2, { command: "assertTextContains", target: "h2", value: "Login Page" }),
            step("login-fill-user", 3, { command: "fill", target: "#username", value: "{{username}}" }),
            step("login-fill-password", 4, { command: "fill", target: "#password", value: "{{password}}", privateValue: true }),
            step("login-submit", 5, { command: "click", target: "button[type=\"submit\"]" }),
            step("login-feedback-visible", 6, { command: "assertElementVisible", target: "#flash" }),
            step("login-feedback-text", 7, { command: "assertTextContains", target: "#flash", value: "Your username is invalid!" }),
            step("login-url", 8, { command: "assertUrlContains", value: "/login" }),
            step("login-screenshot", 9, { command: "captureScreenshot", value: "Invalid login feedback" })
          ]
        })
      ]
    ],
    [
      interactionSuite.id,
      [
        dsl({
          name: "Hover card reveals caption",
          startUrl: "https://the-internet.herokuapp.com/hovers",
          visual: { enabled: false, threshold: 0.5, fullPage: false, screenshotExclusions: [] },
          steps: [
            step("hover-open", 1, { command: "open", target: "https://the-internet.herokuapp.com/hovers" }),
            step("hover-heading", 2, { command: "assertTextContains", target: "h3", value: "Hovers" }),
            step("hover-user", 3, { command: "hover", target: ".figure:nth-of-type(1)", backupSelectors: [".figure"] }),
            step("hover-pause", 4, { command: "pause", value: "700" }),
            step("hover-caption", 5, { command: "assertElementVisible", target: ".figure:nth-of-type(1) .figcaption", backupSelectors: [".figcaption"] }),
            step("hover-text", 6, { command: "assertTextContains", target: ".figure:nth-of-type(1) .figcaption", value: "name: user1" }),
            step("hover-screenshot", 7, { command: "captureScreenshot", value: "Hover caption visible" })
          ]
        }),
        dsl({
          name: "jQuery UI drag and drop changes target state",
          startUrl: "https://jqueryui.com/resources/demos/droppable/default.html",
          visual: { enabled: false, threshold: 0.5, fullPage: false, screenshotExclusions: [] },
          steps: [
            step("drag-open", 1, { command: "open", target: "https://jqueryui.com/resources/demos/droppable/default.html" }),
            step("drag-source-visible", 2, { command: "assertElementVisible", target: "#draggable" }),
            step("drag-target-visible", 3, { command: "assertElementVisible", target: "#droppable" }),
            step("drag-action", 4, { command: "dragDrop", target: "#draggable", value: "#droppable" }),
            step("drag-text", 5, { command: "assertTextContains", target: "#droppable", value: "Dropped!" }),
            step("drag-screenshot", 6, { command: "captureScreenshot", value: "Dropped card state" })
          ]
        }),
        dsl({
          name: "Exit step stops after successful gate",
          startUrl: "https://example.com/",
          visual: { enabled: false, threshold: 0.5, fullPage: false, screenshotExclusions: [] },
          steps: [
            step("exit-open", 1, { command: "open", target: "https://example.com/" }),
            step("exit-heading", 2, { command: "assertTextContains", target: "h1", value: "Example Domain" }),
            step("exit-now", 3, { command: "exitTest" }),
            step("exit-unreached", 4, { command: "assertElementPresent", target: ".this-step-should-not-run" })
          ]
        })
      ]
    ],
    [
      moduleSuite.id,
      [
        moduleContract,
        dsl({
          name: "Imported check follows reference link",
          startUrl: "https://example.com/",
          visual: { enabled: true, threshold: 1, fullPage: false, screenshotExclusions: [] },
          steps: [
            step("import-open", 1, { command: "open", target: "https://example.com/" }),
            step("import-check", 2, { command: "importSteps", value: "Reusable check: public landing page content" }),
            step("import-click-details", 3, { command: "click", target: "a[href*=\"iana.org\"]", backupSelectors: ["a"] }),
            step("import-url", 4, { command: "assertUrlContains", value: "{{detailsHost}}" }),
            step("import-heading", 5, { command: "assertTextContains", target: "h1", value: "Example Domains" }),
            step("import-screenshot", 6, { command: "captureScreenshot", value: "Reference details page" })
          ]
        })
      ]
    ],
    [
      matrixSuite.id,
      [
        dsl({
          name: "Wikipedia row article title",
          startUrl: "https://en.wikipedia.org/wiki/{{articlePath}}",
          defaultVariables: { articlePath: "Playwright_(software)", expectedTitle: "Playwright", dataSourceRow: "default" },
          visual: { enabled: false, threshold: 0.5, fullPage: false, screenshotExclusions: [] },
          steps: [
            step("row-title-open", 1, { command: "open", target: "https://en.wikipedia.org/wiki/{{articlePath}}" }),
            step("row-title-visible", 2, { command: "assertElementVisible", target: "#firstHeading" }),
            step("row-title-text", 3, { command: "assertTextContains", target: "#firstHeading", value: "{{expectedTitle}}" }),
            step("row-title-extract", 4, { command: "extractText", target: "#firstHeading", variableName: "resolvedTitle" }),
            step("row-title-screenshot", 5, { command: "captureScreenshot", value: "Article title {{dataSourceRow}}" })
          ]
        }),
        dsl({
          name: "Wikipedia row article has readable body",
          startUrl: "https://en.wikipedia.org/wiki/{{articlePath}}",
          defaultVariables: { articlePath: "Playwright_(software)", expectedTitle: "Playwright", dataSourceRow: "default" },
          visual: { enabled: false, threshold: 0.5, fullPage: false, screenshotExclusions: [] },
          steps: [
            step("row-body-open", 1, { command: "open", target: "https://en.wikipedia.org/wiki/{{articlePath}}" }),
            step("row-body-heading", 2, { command: "assertTextContains", target: "#firstHeading", value: "{{expectedTitle}}" }),
            step("row-body-js", 3, { command: "assertJsReturnsTrue", target: "return document.querySelectorAll('p').length > 2;" }),
            step("row-body-extract", 4, { command: "extractText", target: "#firstHeading", variableName: "bodyHeading" }),
            step("row-body-variable-js", 5, { command: "assertJsReturnsTrue", target: "return document.body.innerText.includes('{{bodyHeading}}');" }),
            step("row-body-screenshot", 6, { command: "captureScreenshot", value: "Article body {{dataSourceRow}}" })
          ]
        })
      ]
    ]
  ]);

  const createdTests = [];
  for (const [suiteId, testDsls] of testsBySuite.entries()) {
    for (const testDsl of testDsls) {
      createdTests.push(await createTest(project.id, suiteId, testDsl));
    }
  }

  await prisma.dataSource.create({
    data: {
      projectId: project.id,
      suiteId: matrixSuite.id,
      name: "Wikipedia article rows",
      rows: [
        { articlePath: "Playwright_(software)", expectedTitle: "Playwright", dataSourceRow: "playwright" },
        { articlePath: "Selenium_(software)", expectedTitle: "Selenium", dataSourceRow: "selenium" },
        { articlePath: "WebKit", expectedTitle: "WebKit", dataSourceRow: "webkit" }
      ]
    }
  });

  await prisma.notificationEndpoint.upsert({
    where: { id: (await prisma.notificationEndpoint.findFirst({ where: { organizationId: org.id, name: "Local webhook echo" } }))?.id ?? "missing" },
    update: {
      kind: "webhook",
      url: "http://localhost:4000/webhooks/test",
      active: true
    },
    create: {
      organizationId: org.id,
      kind: "webhook",
      name: "Local webhook echo",
      url: "http://localhost:4000/webhooks/test",
      active: true
    }
  });

  await prisma.apiToken.upsert({
    where: { tokenHash: hashApiToken(token) },
    update: {
      name: "Local development token",
      organizationId: org.id,
      userId: user.id
    },
    create: {
      organizationId: org.id,
      userId: user.id,
      name: "Local development token",
      tokenHash: hashApiToken(token)
    }
  });

  console.log(`Seeded SentinelQA public-web data.
Organization: ${org.id}
Project: ${project.id}
Suites: ${editorialSuite.id}, ${formSuite.id}, ${interactionSuite.id}, ${moduleSuite.id}, ${matrixSuite.id}
Tests: ${createdTests.map((test) => test.id).join(", ")}
API token: ${token}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
