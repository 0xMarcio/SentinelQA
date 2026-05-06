import { Queue, Worker } from "bullmq";
import { CronExpressionParser } from "cron-parser";
import { Redis } from "ioredis";
import { prisma } from "@sentinelqa/db";
import { compileTestDsl, interpolateVariables, mergeVariables } from "@sentinelqa/dsl";

const connection = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });
const scheduleQueue = new Queue("schedule-fanout", { connection });
const runTestQueue = new Queue("run-test", { connection });

new Worker(
  "schedule-fanout",
  async (job) => {
    await fanoutSchedule(String(job.data.scheduleId));
  },
  { connection, concurrency: 2 }
);

async function scanDueSchedules() {
  const now = new Date();
  const due = await prisma.schedule.findMany({
    where: {
      active: true,
      OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }]
    },
    take: 50
  });
  for (const schedule of due) {
    await scheduleQueue.add("due", { scheduleId: schedule.id }, { jobId: `schedule-${schedule.id}-${now.getTime()}`, removeOnComplete: 100 });
  }
}

async function fanoutSchedule(scheduleId: string) {
  const schedule = await prisma.schedule.findUnique({
    where: { id: scheduleId },
    include: { suite: { include: { tests: true, project: true } }, test: { include: { suite: { include: { project: true } } } } }
  });
  if (!schedule || !schedule.active) return;

  if (schedule.testId) {
    await createRun(schedule.testId, schedule.variables as Record<string, string>);
  } else if (schedule.suite) {
    const suiteRun = await prisma.suiteRun.create({ data: { suiteId: schedule.suite.id, status: "queued" } });
    const dataSources = await prisma.dataSource.findMany({ where: { suiteId: schedule.suite.id }, orderBy: { createdAt: "asc" } });
    const rows = dataSources.flatMap((source) =>
      asRows(source.rows).map((row, index) => ({
        ...row,
        dataSourceName: source.name,
        dataSourceRow: String(index + 1)
      }))
    );
    const rowSet = rows.length > 0 ? rows : [undefined];
    for (const rowVariables of rowSet) {
      for (const test of schedule.suite.tests) {
        await createRun(test.id, schedule.variables as Record<string, string>, suiteRun.id, rowVariables);
      }
    }
  }

  const now = new Date();
  await prisma.schedule.update({
    where: { id: schedule.id },
    data: {
      lastRunAt: now,
      nextRunAt: nextRunAt(schedule, now)
    }
  });
}

async function createRun(testId: string, scheduleVariables: Record<string, string>, suiteRunId?: string, dataSourceRowVariables?: Record<string, string>) {
  const test = await prisma.test.findUnique({ where: { id: testId }, include: { suite: { include: { project: true } } } });
  if (!test) throw new Error(`Test ${testId} not found`);
  const version = await prisma.testVersion.findFirst({ where: { testId }, orderBy: { version: "desc" } });
  if (!version) throw new Error(`Test ${testId} has no version`);
  const compiled = compileTestDsl(version.dsl);
  if (compiled.issues.length > 0) throw new Error(compiled.issues.map((issue) => issue.message).join("; "));
  const environment = await prisma.environment.findFirst({ where: { projectId: test.projectId }, orderBy: { createdAt: "asc" } });
  const variables = mergeVariables({
    testDefaults: compiled.dsl.defaultVariables,
    suiteVariables: compiled.dsl.suiteVariables,
    environmentVariables: (environment?.variables ?? {}) as Record<string, string>,
    dataSourceRowVariables,
    runVariables: scheduleVariables
  });
  const run = await prisma.run.create({
    data: {
      organizationId: test.suite.project.organizationId,
      projectId: test.projectId,
      suiteId: test.suiteId,
      suiteRunId,
      testId: test.id,
      testVersionId: version.id,
      environmentId: environment?.id,
      status: "queued",
      startUrl: interpolateVariables(compiled.dsl.startUrl, variables),
      variables,
      browser: compiled.dsl.browser.browser,
      viewport: compiled.dsl.browser.viewport,
      locale: compiled.dsl.browser.locale,
      timezone: compiled.dsl.browser.timezone,
      geolocation: compiled.dsl.browser.geolocation ?? undefined,
      traceEnabled: compiled.dsl.browser.trace,
      videoEnabled: compiled.dsl.browser.video,
      visualEnabled: compiled.dsl.visual.enabled || test.visualEnabled
    }
  });
  await runTestQueue.add("execute", { runId: run.id }, { jobId: `run-${run.id}`, removeOnComplete: 100 });
}

function asRows(value: unknown): Array<Record<string, string>> {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry))
    .map((entry) => Object.fromEntries(Object.entries(entry).map(([key, value]) => [key, String(value ?? "")])))
    .filter((row) => Object.keys(row).length > 0);
}

function nextRunAt(schedule: { intervalMinutes: number | null; cron: string | null; timezone: string | null }, from: Date): Date | null {
  if (schedule.cron) {
    const expression = CronExpressionParser.parse(schedule.cron, { currentDate: from, tz: schedule.timezone ?? undefined });
    return expression.next().toDate();
  }
  if (schedule.intervalMinutes) {
    return new Date(from.getTime() + schedule.intervalMinutes * 60_000);
  }
  return null;
}

const pollMs = Number(process.env.SCHEDULE_POLL_MS ?? 60000);
await scanDueSchedules();
setInterval(() => {
  scanDueSchedules().catch((error) => console.error("schedule scan failed", error));
}, pollMs);

console.log(`SentinelQA scheduler scanning every ${pollMs}ms`);
