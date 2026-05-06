import { prisma, type Prisma } from "@sentinelqa/db";
import { compileTestDsl, interpolateVariables, mergeVariables, type TestDsl } from "@sentinelqa/dsl";
import { queues } from "./queues.js";

export interface RunCreateInput {
  testId: string;
  environmentId?: string | null;
  suiteRunId?: string | null;
  startUrl?: string;
  variables?: Record<string, string>;
  dataSourceRowVariables?: Record<string, string>;
  trace?: boolean;
  video?: boolean;
}

export async function latestTestVersion(testId: string) {
  return prisma.testVersion.findFirst({
    where: { testId },
    orderBy: { version: "desc" }
  });
}

export async function createTestRun(input: RunCreateInput) {
  const test = await prisma.test.findUnique({
    where: { id: input.testId },
    include: {
      suite: {
        include: {
          project: true
        }
      }
    }
  });
  if (!test) {
    throw new Error("Test not found");
  }
  const version = await latestTestVersion(test.id);
  if (!version) {
    throw new Error("Test has no published version");
  }

  const compiled = compileTestDsl(version.dsl);
  if (compiled.issues.length > 0) {
    throw new Error(compiled.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
  }
  const dsl = compiled.dsl;
  const environment = input.environmentId
    ? await prisma.environment.findUnique({ where: { id: input.environmentId } })
    : await prisma.environment.findFirst({ where: { projectId: test.projectId }, orderBy: { createdAt: "asc" } });
  const variables = mergeVariables({
    testDefaults: dsl.defaultVariables,
    suiteVariables: {
      ...dsl.suiteVariables,
      ...asStringRecord(test.suite.variables)
    },
    environmentVariables: asStringRecord(environment?.variables),
    dataSourceRowVariables: input.dataSourceRowVariables ?? {},
    runVariables: input.variables ?? {}
  });
  const secretVariableNames = new Set([
    ...Object.keys(dsl.secretVariables),
    ...Object.keys(asStringRecord(test.suite.secretVariables))
  ]);
  const runtimeVariables = mergeVariables({
    testDefaults: dsl.defaultVariables,
    testSecrets: {
      ...dsl.secretVariables,
      ...asStringRecord(test.suite.secretVariables)
    },
    suiteVariables: {
      ...dsl.suiteVariables,
      ...asStringRecord(test.suite.variables)
    },
    environmentVariables: asStringRecord(environment?.variables),
    dataSourceRowVariables: input.dataSourceRowVariables ?? {},
    runVariables: input.variables ?? {}
  });

  const startUrl = input.startUrl ?? interpolateVariables(dsl.startUrl || test.startUrl, runtimeVariables);
  const run = await prisma.run.create({
    data: {
      organizationId: test.suite.project.organizationId,
      projectId: test.projectId,
      suiteId: test.suiteId,
      suiteRunId: input.suiteRunId ?? null,
      testId: test.id,
      testVersionId: version.id,
      environmentId: environment?.id,
      status: "queued",
      startUrl,
      variables: publicVariables(variables, secretVariableNames),
      browser: dsl.browser.browser,
      viewport: dsl.browser.viewport,
      locale: dsl.browser.locale,
      timezone: dsl.browser.timezone,
      geolocation: dsl.browser.geolocation as Prisma.InputJsonValue,
      traceEnabled: input.trace ?? dsl.browser.trace,
      videoEnabled: input.video ?? dsl.browser.video,
      visualEnabled: dsl.visual.enabled || test.visualEnabled
    }
  });
  await queues.runTest.add(
    "execute",
    { runId: run.id },
    {
      jobId: `run-${run.id}`,
      attempts: 1,
      removeOnComplete: 100,
      removeOnFail: 100
    }
  );

  return run;
}

function publicVariables(variables: Record<string, string>, secretNames: Set<string>) {
  return Object.fromEntries(Object.entries(variables).filter(([name]) => !secretNames.has(name)));
}

export async function createSuiteRun(input: {
  suiteId: string;
  environmentId?: string | null;
  startUrl?: string;
  variables?: Record<string, string>;
}) {
  const suite = await prisma.suite.findUnique({
    where: { id: input.suiteId },
    include: { tests: true, dataSources: true }
  });
  if (!suite) {
    throw new Error("Suite not found");
  }

  const suiteRun = await prisma.suiteRun.create({
    data: {
      suiteId: suite.id,
      status: "queued"
    }
  });

  const runs = [];
  const dataSourceRows = suite.dataSources.flatMap((source) =>
    asRows(source.rows).map((row, index) => ({
      ...row,
      dataSourceName: source.name,
      dataSourceRow: String(index + 1)
    }))
  );
  const rowSet = dataSourceRows.length > 0 ? dataSourceRows : [undefined];

  for (const rowVariables of rowSet) {
    for (const test of suite.tests) {
      const run = await createTestRun({
        testId: test.id,
        suiteRunId: suiteRun.id,
        environmentId: input.environmentId,
        startUrl: input.startUrl,
        variables: input.variables,
        dataSourceRowVariables: rowVariables
      });
      runs.push(run);
    }
  }

  await queues.runSuite.add("fanout", { suiteRunId: suiteRun.id }, { jobId: `suite-${suiteRun.id}`, removeOnComplete: 100 });
  return { suiteRun, runs };
}

export function asStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, String(entry ?? "")])
  );
}

function asRows(value: unknown): Array<Record<string, string>> {
  if (!Array.isArray(value)) return [];
  return value.map(asStringRecord).filter((row) => Object.keys(row).length > 0);
}

export function dslFromTestInput(input: {
  name: string;
  startUrl: string;
  defaultVariables?: Record<string, string>;
  suiteVariables?: Record<string, string>;
  visualEnabled?: boolean;
  visualThreshold?: number;
  steps?: TestDsl["steps"];
}): TestDsl {
  const compiled = compileTestDsl({
    schemaVersion: 1,
    name: input.name,
    startUrl: input.startUrl,
    defaultVariables: input.defaultVariables ?? {},
    secretVariables: {},
    suiteVariables: input.suiteVariables ?? {},
    visual: { enabled: input.visualEnabled ?? false, threshold: input.visualThreshold ?? 0.2, fullPage: false, screenshotExclusions: [] },
    steps: input.steps ?? []
  });
  if (compiled.issues.length > 0) {
    throw new Error(compiled.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
  }
  return compiled.dsl;
}
