import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import Fastify from "fastify";
import { parse } from "csv-parse/sync";
import { z } from "zod";
import { compileTestDsl, type TestDsl } from "@sentinelqa/dsl";
import { prisma, type Prisma } from "@sentinelqa/db";
import { authenticate, getDevUser } from "./auth.js";
import { emailAddressForRun, getLatestMailboxEmail, listMailboxEmails, listRunEmails } from "./email.js";
import { createSuiteRun, createTestRun, dslFromTestInput } from "./runCreation.js";
import { parseOrReply } from "./validation.js";

const id = z.string().min(1);
const varsSchema = z.record(z.string(), z.string()).default({});
const projectBody = z.object({ name: z.string().min(1), slug: z.string().min(1).optional() });
const suiteBody = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  variables: varsSchema.optional(),
  secretVariables: varsSchema.optional()
});
const testBody = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  startUrl: z.string().min(1),
  defaults: varsSchema.optional(),
  visualEnabled: z.boolean().optional(),
  visualThreshold: z.number().min(0).max(100).optional(),
  dsl: z.unknown().optional(),
  steps: z.array(z.unknown()).optional()
});
const runBody = z.object({
  startUrl: z.string().min(1).optional(),
  environmentId: z.string().optional().nullable(),
  variables: varsSchema.optional(),
  trace: z.boolean().optional(),
  video: z.boolean().optional()
});
const environmentBody = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).optional(),
  baseUrl: z.string().optional().nullable(),
  variables: varsSchema.optional()
});
const scheduleBody = z.object({
  name: z.string().min(1),
  active: z.boolean().default(true),
  intervalMinutes: z.number().int().min(1).optional().nullable(),
  cron: z.string().optional().nullable(),
  timezone: z.string().optional().nullable(),
  variables: varsSchema.optional()
});
const endpointBody = z.object({
  kind: z.enum(["webhook", "slack"]).default("webhook"),
  name: z.string().min(1),
  url: z.string().url(),
  secret: z.string().optional().nullable(),
  active: z.boolean().default(true)
});
const dataSourceBody = z.object({
  name: z.string().min(1),
  rows: z.array(z.record(z.string(), z.string())).default([])
});

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item";
}

function params<T extends z.ZodRawShape>(shape: T) {
  return z.object(shape);
}

async function createVersion(testId: string, rawDsl: unknown) {
  const compiled = compileTestDsl(rawDsl);
  if (compiled.issues.length > 0) {
    throw new Error(compiled.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
  }
  const latest = await prisma.testVersion.findFirst({ where: { testId }, orderBy: { version: "desc" } });
  const nextVersion = (latest?.version ?? 0) + 1;
  return prisma.testVersion.create({
    data: {
      testId,
      version: nextVersion,
      dsl: compiled.dsl,
      steps: {
        create: compiled.dsl.steps.map((step) => ({
          command: step.command,
          target: step.target,
          value: step.value,
          variableName: step.variableName,
          optional: step.optional,
          privateValue: step.privateValue,
          notes: step.notes,
          timeoutMs: step.timeoutMs,
          backupSelectors: step.backupSelectors,
          conditionJs: step.conditionJs,
          sequence: step.sequence
        }))
      }
    }
  });
}

function bodyToDsl(body: z.infer<typeof testBody>): TestDsl {
  if (body.dsl) {
    const compiled = compileTestDsl(body.dsl);
    if (compiled.issues.length > 0) {
      throw new Error(compiled.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
    }
    return compiled.dsl;
  }
  return dslFromTestInput({
    name: body.name,
    startUrl: body.startUrl,
    defaultVariables: body.defaults ?? {},
    visualEnabled: body.visualEnabled,
    visualThreshold: body.visualThreshold,
    steps: (body.steps ?? []) as TestDsl["steps"]
  });
}

export async function buildServer() {
  const server = Fastify({ logger: true });
  await server.register(cors, {
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["content-type", "authorization"]
  });
  await server.register(cookie, { secret: process.env.SESSION_SECRET ?? "local-dev-session-secret" });
  await server.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });

  server.addHook("preHandler", async (request, reply) => {
    const publicPaths = ["/healthz", "/auth/dev-login", "/webhooks/test"];
    const path = request.url.split("?")[0] ?? request.url;
    if (publicPaths.includes(path) || path.startsWith("/email/")) {
      return;
    }
    await authenticate(request, reply);
  });

  server.get("/healthz", async () => ({ ok: true }));

  server.post("/auth/dev-login", async (_request, reply) => {
    const user = await getDevUser();
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
    reply.setCookie("sq_session", user.id, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: false
    });
    return { user, organization: org };
  });

  server.get("/me", async (request) => {
    const principal = request.principal!;
    const user = principal.userId ? await prisma.user.findUnique({ where: { id: principal.userId } }) : null;
    const organizations = principal.userId
      ? await prisma.organization.findMany({
          where: { members: { some: { userId: principal.userId } } },
          include: { projects: true }
        })
      : await prisma.organization.findMany({ where: { id: principal.organizationId }, include: { projects: true } });
    return { user, organizations, principal };
  });

  server.get("/orgs/:orgId/projects", async (request, reply) => {
    const p = parseOrReply(params({ orgId: id }), request.params, reply);
    if (!p) return;
    return prisma.project.findMany({ where: { organizationId: p.orgId }, orderBy: { createdAt: "asc" } });
  });

  server.post("/orgs/:orgId/projects", async (request, reply) => {
    const p = parseOrReply(params({ orgId: id }), request.params, reply);
    const body = parseOrReply(projectBody, request.body, reply);
    if (!p || !body) return;
    return prisma.project.create({
      data: {
        organizationId: p.orgId,
        name: body.name,
        slug: body.slug ?? slugify(body.name)
      }
    });
  });

  server.get("/projects/:projectId", async (request, reply) => {
    const p = parseOrReply(params({ projectId: id }), request.params, reply);
    if (!p) return;
    return prisma.project.findUnique({ where: { id: p.projectId }, include: { suites: true, environments: true } });
  });

  server.put("/projects/:projectId", async (request, reply) => {
    const p = parseOrReply(params({ projectId: id }), request.params, reply);
    const body = parseOrReply(projectBody, request.body, reply);
    if (!p || !body) return;
    return prisma.project.update({ where: { id: p.projectId }, data: { name: body.name, slug: body.slug ?? slugify(body.name) } });
  });

  server.delete("/projects/:projectId", async (request, reply) => {
    const p = parseOrReply(params({ projectId: id }), request.params, reply);
    if (!p) return;
    await prisma.project.delete({ where: { id: p.projectId } });
    return { ok: true };
  });

  server.get("/projects/:projectId/suites", async (request, reply) => {
    const p = parseOrReply(params({ projectId: id }), request.params, reply);
    if (!p) return;
    return prisma.suite.findMany({
      where: { projectId: p.projectId },
      include: { tests: { include: { runs: { orderBy: { createdAt: "desc" }, take: 1 } } }, schedules: true },
      orderBy: { createdAt: "asc" }
    });
  });

  server.post("/projects/:projectId/suites", async (request, reply) => {
    const p = parseOrReply(params({ projectId: id }), request.params, reply);
    const body = parseOrReply(suiteBody, request.body, reply);
    if (!p || !body) return;
    return prisma.suite.create({
      data: {
        projectId: p.projectId,
        name: body.name,
        description: body.description,
        variables: body.variables ?? {},
        secretVariables: body.secretVariables ?? {}
      }
    });
  });

  server.get("/suites/:suiteId", async (request, reply) => {
    const p = parseOrReply(params({ suiteId: id }), request.params, reply);
    if (!p) return;
    const suite = await prisma.suite.findUnique({
      where: { id: p.suiteId },
      include: {
        project: true,
        tests: { include: { runs: { orderBy: { createdAt: "desc" }, take: 1 } } },
        schedules: true,
        suiteRuns: { orderBy: { createdAt: "desc" }, take: 10, include: { runs: true } }
      }
    });
    if (!suite) return reply.status(404).send({ error: "suite_not_found" });
    return suite;
  });

  server.put("/suites/:suiteId", async (request, reply) => {
    const p = parseOrReply(params({ suiteId: id }), request.params, reply);
    const body = parseOrReply(suiteBody, request.body, reply);
    if (!p || !body) return;
    return prisma.suite.update({
      where: { id: p.suiteId },
      data: {
        name: body.name,
        description: body.description,
        variables: body.variables ?? {},
        secretVariables: body.secretVariables ?? {}
      }
    });
  });

  server.post("/suites/:suiteId/duplicate", async (request, reply) => {
    const p = parseOrReply(params({ suiteId: id }), request.params, reply);
    const body = parseOrReply(z.object({ name: z.string().min(1).optional() }).default({}), request.body ?? {}, reply);
    if (!p || !body) return;
    const source = await prisma.suite.findUnique({
      where: { id: p.suiteId },
      include: {
        tests: {
          include: {
            versions: { orderBy: { version: "desc" }, take: 1 }
          }
        }
      }
    });
    if (!source) return reply.status(404).send({ error: "suite_not_found" });
    const copied = await prisma.suite.create({
      data: {
        projectId: source.projectId,
        folderId: source.folderId,
        name: body.name ?? `${source.name} copy`,
        description: source.description,
        variables: source.variables as Prisma.InputJsonValue,
        secretVariables: source.secretVariables as Prisma.InputJsonValue
      }
    });
    for (const test of source.tests) {
      const newTest = await prisma.test.create({
        data: {
          projectId: test.projectId,
          suiteId: copied.id,
          folderId: test.folderId,
          name: test.name,
          description: test.description,
          startUrl: test.startUrl,
          defaults: test.defaults as Prisma.InputJsonValue,
          visualEnabled: test.visualEnabled,
          visualThreshold: test.visualThreshold
        }
      });
      const latest = test.versions[0];
      if (latest) {
        await createVersion(newTest.id, latest.dsl);
      }
    }
    return copied;
  });

  server.delete("/suites/:suiteId", async (request, reply) => {
    const p = parseOrReply(params({ suiteId: id }), request.params, reply);
    if (!p) return;
    await prisma.suite.delete({ where: { id: p.suiteId } });
    return { ok: true };
  });

  server.get("/suites/:suiteId/tests", async (request, reply) => {
    const p = parseOrReply(params({ suiteId: id }), request.params, reply);
    if (!p) return;
    return prisma.test.findMany({
      where: { suiteId: p.suiteId },
      include: { versions: { orderBy: { version: "desc" }, take: 1 }, runs: { orderBy: { createdAt: "desc" }, take: 1 } },
      orderBy: { createdAt: "asc" }
    });
  });

  server.post("/suites/:suiteId/tests", async (request, reply) => {
    const p = parseOrReply(params({ suiteId: id }), request.params, reply);
    const body = parseOrReply(testBody, request.body, reply);
    if (!p || !body) return;
    const suite = await prisma.suite.findUnique({ where: { id: p.suiteId } });
    if (!suite) return reply.status(404).send({ error: "suite_not_found" });
    let dsl: TestDsl;
    try {
      dsl = bodyToDsl(body);
    } catch (error) {
      return reply.status(400).send({ error: "invalid_dsl", message: error instanceof Error ? error.message : String(error) });
    }
    const test = await prisma.test.create({
      data: {
        projectId: suite.projectId,
        suiteId: suite.id,
        name: body.name,
        description: body.description,
        startUrl: body.startUrl,
        defaults: body.defaults ?? {},
        visualEnabled: body.visualEnabled ?? dsl.visual.enabled,
        visualThreshold: body.visualThreshold ?? dsl.visual.threshold
      }
    });
    const version = await createVersion(test.id, dsl);
    return { ...test, latestVersion: version };
  });

  server.get("/tests/:testId", async (request, reply) => {
    const p = parseOrReply(params({ testId: id }), request.params, reply);
    if (!p) return;
    return prisma.test.findUnique({
      where: { id: p.testId },
      include: {
        suite: true,
        versions: { orderBy: { version: "desc" } },
        runs: { orderBy: { createdAt: "desc" }, take: 20 }
      }
    });
  });

  server.put("/tests/:testId", async (request, reply) => {
    const p = parseOrReply(params({ testId: id }), request.params, reply);
    const body = parseOrReply(testBody.partial().extend({ name: z.string().min(1).optional(), startUrl: z.string().min(1).optional() }), request.body, reply);
    if (!p || !body) return;
    const existing = await prisma.test.findUnique({ where: { id: p.testId } });
    if (!existing) return reply.status(404).send({ error: "test_not_found" });
    const test = await prisma.test.update({
      where: { id: p.testId },
      data: {
        name: body.name ?? existing.name,
        description: body.description,
        startUrl: body.startUrl ?? existing.startUrl,
        defaults: body.defaults ?? (existing.defaults as object),
        visualEnabled: body.visualEnabled ?? existing.visualEnabled,
        visualThreshold: body.visualThreshold ?? existing.visualThreshold
      }
    });
    let version = null;
    try {
      version = body.dsl
        ? await createVersion(test.id, body.dsl)
        : body.steps
          ? await createVersion(test.id, {
              name: test.name,
              startUrl: test.startUrl,
              defaultVariables: test.defaults,
              visual: { enabled: test.visualEnabled, threshold: test.visualThreshold, fullPage: false, screenshotExclusions: [] },
              steps: body.steps
            })
          : null;
    } catch (error) {
      return reply.status(400).send({ error: "invalid_dsl", message: error instanceof Error ? error.message : String(error) });
    }
    return { ...test, latestVersion: version };
  });

  server.delete("/tests/:testId", async (request, reply) => {
    const p = parseOrReply(params({ testId: id }), request.params, reply);
    if (!p) return;
    await prisma.test.delete({ where: { id: p.testId } });
    return { ok: true };
  });

  server.post("/tests/:testId/versions", async (request, reply) => {
    const p = parseOrReply(params({ testId: id }), request.params, reply);
    if (!p) return;
    try {
      const version = await createVersion(p.testId, request.body);
      return version;
    } catch (error) {
      return reply.status(400).send({ error: "invalid_dsl", message: error instanceof Error ? error.message : String(error) });
    }
  });

  server.post("/tests/:testId/run", async (request, reply) => {
    const p = parseOrReply(params({ testId: id }), request.params, reply);
    const body = parseOrReply(runBody.default({}), request.body ?? {}, reply);
    if (!p || !body) return;
    try {
      return await createTestRun({ testId: p.testId, ...body });
    } catch (error) {
      return reply.status(400).send({ error: "run_creation_failed", message: error instanceof Error ? error.message : String(error) });
    }
  });

  server.post("/suites/:suiteId/run", async (request, reply) => {
    const p = parseOrReply(params({ suiteId: id }), request.params, reply);
    const body = parseOrReply(runBody.default({}), request.body ?? {}, reply);
    if (!p || !body) return;
    try {
      return await createSuiteRun({ suiteId: p.suiteId, ...body });
    } catch (error) {
      return reply.status(400).send({ error: "suite_run_creation_failed", message: error instanceof Error ? error.message : String(error) });
    }
  });

  server.get("/runs/:runId", async (request, reply) => {
    const p = parseOrReply(params({ runId: id }), request.params, reply);
    if (!p) return;
    return prisma.run.findUnique({
      where: { id: p.runId },
      include: { test: true, suite: true, artifacts: true, comments: { orderBy: { createdAt: "asc" } } }
    });
  });

  server.get("/runs/:runId/steps", async (request, reply) => {
    const p = parseOrReply(params({ runId: id }), request.params, reply);
    if (!p) return;
    return prisma.runStepResult.findMany({ where: { runId: p.runId }, orderBy: { sequence: "asc" } });
  });

  server.get("/runs/:runId/artifacts", async (request, reply) => {
    const p = parseOrReply(params({ runId: id }), request.params, reply);
    if (!p) return;
    return prisma.artifact.findMany({ where: { runId: p.runId }, orderBy: { createdAt: "asc" } });
  });

  server.get("/runs/:runId/email-address", async (request, reply) => {
    const p = parseOrReply(params({ runId: id }), request.params, reply);
    if (!p) return;
    const run = await prisma.run.findUnique({ where: { id: p.runId }, select: { id: true } });
    if (!run) return reply.status(404).send({ error: "run_not_found" });
    return { emailAddress: emailAddressForRun(run.id) };
  });

  server.get("/runs/:runId/emails", async (request, reply) => {
    const p = parseOrReply(params({ runId: id }), request.params, reply);
    if (!p) return;
    const run = await prisma.run.findUnique({ where: { id: p.runId }, select: { id: true } });
    if (!run) return reply.status(404).send({ error: "run_not_found" });
    return { emailAddress: emailAddressForRun(run.id), messages: await listRunEmails(run.id) };
  });

  server.post("/runs/:runId/comments", async (request, reply) => {
    const p = parseOrReply(params({ runId: id }), request.params, reply);
    const body = parseOrReply(z.object({ body: z.string().min(1), author: z.string().optional() }), request.body, reply);
    if (!p || !body) return;
    return prisma.runComment.create({ data: { runId: p.runId, body: body.body, author: body.author ?? "local" } });
  });

  server.post("/runs/:runId/accept-baseline", async (request, reply) => {
    const p = parseOrReply(params({ runId: id }), request.params, reply);
    if (!p) return;
    const run = await prisma.run.findUnique({ where: { id: p.runId }, include: { artifacts: true } });
    if (!run) return reply.status(404).send({ error: "run_not_found" });
    const screenshot =
      run.artifacts.find((artifact) => artifact.kind === "finalScreenshot") ??
      run.artifacts.find((artifact) => artifact.kind === "screenshot");
    if (!screenshot) return reply.status(400).send({ error: "no_screenshot_artifact" });
    const viewport = viewportFromValue(run.viewport);
    const viewportKey = `${viewport.width}x${viewport.height}`;
    const baseline = await prisma.visualBaseline.upsert({
      where: {
        testId_browser_viewportKey_environmentKey_regionKey: {
          testId: run.testId,
          browser: run.browser,
          viewportKey,
          environmentKey: run.environmentId ?? "default",
          regionKey: "full-page"
        }
      },
      update: { artifactId: screenshot.id, viewport: viewport as Prisma.InputJsonValue, viewportKey },
      create: {
        testId: run.testId,
        browser: run.browser,
        viewport: viewport as Prisma.InputJsonValue,
        viewportKey,
        environmentKey: run.environmentId ?? "default",
        regionKey: "full-page",
        artifactId: screenshot.id
      }
    });
    await prisma.run.update({ where: { id: run.id }, data: { visualStatus: "accepted" } });
    return baseline;
  });

  function viewportFromValue(value: unknown) {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      const width = Number((value as { width?: unknown }).width);
      const height = Number((value as { height?: unknown }).height);
      if (Number.isFinite(width) && Number.isFinite(height)) {
        return { width, height };
      }
    }
    return { width: 1920, height: 1080 };
  }

  server.get("/suites/:suiteId/schedules", async (request, reply) => {
    const p = parseOrReply(params({ suiteId: id }), request.params, reply);
    if (!p) return;
    return prisma.schedule.findMany({ where: { suiteId: p.suiteId }, orderBy: { createdAt: "asc" } });
  });

  server.post("/suites/:suiteId/schedules", async (request, reply) => {
    const p = parseOrReply(params({ suiteId: id }), request.params, reply);
    const body = parseOrReply(scheduleBody, request.body, reply);
    if (!p || !body) return;
    return prisma.schedule.create({ data: { suiteId: p.suiteId, ...body, variables: body.variables ?? {}, nextRunAt: new Date() } });
  });

  server.put("/schedules/:scheduleId", async (request, reply) => {
    const p = parseOrReply(params({ scheduleId: id }), request.params, reply);
    const body = parseOrReply(scheduleBody.partial(), request.body, reply);
    if (!p || !body) return;
    return prisma.schedule.update({ where: { id: p.scheduleId }, data: body });
  });

  server.delete("/schedules/:scheduleId", async (request, reply) => {
    const p = parseOrReply(params({ scheduleId: id }), request.params, reply);
    if (!p) return;
    await prisma.schedule.delete({ where: { id: p.scheduleId } });
    return { ok: true };
  });

  server.get("/suites/:suiteId/variables", async (request, reply) => {
    const p = parseOrReply(params({ suiteId: id }), request.params, reply);
    if (!p) return;
    const suite = await prisma.suite.findUnique({ where: { id: p.suiteId } });
    return { variables: suite?.variables ?? {}, secretVariables: suite?.secretVariables ?? {} };
  });

  server.put("/suites/:suiteId/variables", async (request, reply) => {
    const p = parseOrReply(params({ suiteId: id }), request.params, reply);
    const body = parseOrReply(z.object({ variables: varsSchema, secretVariables: varsSchema.optional() }), request.body, reply);
    if (!p || !body) return;
    return prisma.suite.update({
      where: { id: p.suiteId },
      data: { variables: body.variables, secretVariables: body.secretVariables ?? {} }
    });
  });

  server.post("/suites/:suiteId/variables", async (request, reply) => {
    const p = parseOrReply(params({ suiteId: id }), request.params, reply);
    const body = parseOrReply(z.object({ name: z.string().min(1), variables: varsSchema }), request.body, reply);
    if (!p || !body) return;
    return prisma.variableSet.create({ data: { suiteId: p.suiteId, name: body.name, variables: body.variables } });
  });

  server.get("/projects/:projectId/environments", async (request, reply) => {
    const p = parseOrReply(params({ projectId: id }), request.params, reply);
    if (!p) return;
    return prisma.environment.findMany({ where: { projectId: p.projectId }, orderBy: { createdAt: "asc" } });
  });

  server.post("/projects/:projectId/environments", async (request, reply) => {
    const p = parseOrReply(params({ projectId: id }), request.params, reply);
    const body = parseOrReply(environmentBody, request.body, reply);
    if (!p || !body) return;
    return prisma.environment.create({
      data: { projectId: p.projectId, name: body.name, slug: body.slug ?? slugify(body.name), baseUrl: body.baseUrl, variables: body.variables ?? {} }
    });
  });

  server.put("/environments/:environmentId", async (request, reply) => {
    const p = parseOrReply(params({ environmentId: id }), request.params, reply);
    const body = parseOrReply(environmentBody.partial(), request.body, reply);
    if (!p || !body) return;
    return prisma.environment.update({ where: { id: p.environmentId }, data: body });
  });

  server.delete("/environments/:environmentId", async (request, reply) => {
    const p = parseOrReply(params({ environmentId: id }), request.params, reply);
    if (!p) return;
    await prisma.environment.delete({ where: { id: p.environmentId } });
    return { ok: true };
  });

  server.get("/suites/:suiteId/data-sources", async (request, reply) => {
    const p = parseOrReply(params({ suiteId: id }), request.params, reply);
    if (!p) return;
    return prisma.dataSource.findMany({ where: { suiteId: p.suiteId }, orderBy: { createdAt: "asc" } });
  });

  server.post("/suites/:suiteId/data-sources", async (request, reply) => {
    const p = parseOrReply(params({ suiteId: id }), request.params, reply);
    if (!p) return;
    const suite = await prisma.suite.findUnique({ where: { id: p.suiteId } });
    if (!suite) return reply.status(404).send({ error: "suite_not_found" });
    if (request.isMultipart()) {
      const file = await request.file();
      if (!file) return reply.status(400).send({ error: "missing_file" });
      const content = (await file.toBuffer()).toString("utf8");
      const rows = parse(content, { columns: true, skip_empty_lines: true, trim: true }) as Array<Record<string, string>>;
      return prisma.dataSource.create({ data: { projectId: suite.projectId, suiteId: suite.id, name: file.filename, rows } });
    }
    const body = parseOrReply(dataSourceBody, request.body, reply);
    if (!body) return;
    return prisma.dataSource.create({ data: { projectId: suite.projectId, suiteId: suite.id, name: body.name, rows: body.rows } });
  });

  server.put("/data-sources/:dataSourceId", async (request, reply) => {
    const p = parseOrReply(params({ dataSourceId: id }), request.params, reply);
    const body = parseOrReply(dataSourceBody.partial(), request.body, reply);
    if (!p || !body) return;
    return prisma.dataSource.update({ where: { id: p.dataSourceId }, data: body });
  });

  server.delete("/data-sources/:dataSourceId", async (request, reply) => {
    const p = parseOrReply(params({ dataSourceId: id }), request.params, reply);
    if (!p) return;
    await prisma.dataSource.delete({ where: { id: p.dataSourceId } });
    return { ok: true };
  });

  server.get("/orgs/:orgId/notification-endpoints", async (request, reply) => {
    const p = parseOrReply(params({ orgId: id }), request.params, reply);
    if (!p) return;
    return prisma.notificationEndpoint.findMany({ where: { organizationId: p.orgId }, orderBy: { createdAt: "asc" } });
  });

  server.post("/orgs/:orgId/notification-endpoints", async (request, reply) => {
    const p = parseOrReply(params({ orgId: id }), request.params, reply);
    const body = parseOrReply(endpointBody, request.body, reply);
    if (!p || !body) return;
    return prisma.notificationEndpoint.create({ data: { organizationId: p.orgId, ...body } });
  });

  server.put("/notification-endpoints/:endpointId", async (request, reply) => {
    const p = parseOrReply(params({ endpointId: id }), request.params, reply);
    const body = parseOrReply(endpointBody.partial(), request.body, reply);
    if (!p || !body) return;
    return prisma.notificationEndpoint.update({ where: { id: p.endpointId }, data: body });
  });

  server.delete("/notification-endpoints/:endpointId", async (request, reply) => {
    const p = parseOrReply(params({ endpointId: id }), request.params, reply);
    if (!p) return;
    await prisma.notificationEndpoint.delete({ where: { id: p.endpointId } });
    return { ok: true };
  });

  server.post("/webhooks/test", async (request) => ({
    ok: true,
    receivedAt: new Date().toISOString(),
    payload: request.body ?? null
  }));

  server.get("/email/:mailbox", async (request, reply) => {
    const p = parseOrReply(params({ mailbox: z.string().min(1) }), request.params, reply);
    if (!p) return;
    return listMailboxEmails(p.mailbox);
  });

  server.get("/email/:mailbox/latest", async (request, reply) => {
    const p = parseOrReply(params({ mailbox: z.string().min(1) }), request.params, reply);
    if (!p) return;
    return getLatestMailboxEmail(p.mailbox);
  });

  return server;
}
