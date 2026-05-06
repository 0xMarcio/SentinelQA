import { describe, expect, it } from "vitest";
import { prisma } from "@sentinelqa/db";

const runIntegration = process.env.RUN_INTEGRATION === "1";

describe.skipIf(!runIntegration)("runner integration", () => {
  it("does not store a final screenshot when visual comparison is disabled", async () => {
    const { executeRun } = await import("../../apps/runner/src/execute.js");
    const test = await prisma.test.findFirst({ orderBy: { createdAt: "asc" } });
    expect(test).toBeTruthy();
    const version = await prisma.testVersion.findFirst({ where: { testId: test!.id }, orderBy: { version: "desc" } });
    expect(version).toBeTruthy();
    const suite = await prisma.suite.findUnique({ where: { id: test!.suiteId }, include: { project: true } });
    expect(suite).toBeTruthy();
    const run = await prisma.run.create({
      data: {
        organizationId: suite!.project.organizationId,
        projectId: test!.projectId,
        suiteId: test!.suiteId,
        testId: test!.id,
        testVersionId: version!.id,
        status: "queued",
        startUrl: test!.startUrl,
        variables: {},
        traceEnabled: false,
        videoEnabled: false,
        visualEnabled: false
      }
    });

    await executeRun(run.id);

    const finished = await prisma.run.findUnique({ where: { id: run.id }, include: { artifacts: true } });
    expect(finished?.status).toBe("passed");
    expect(finished?.artifacts.some((artifact) => artifact.kind === "finalScreenshot")).toBe(false);
  });

  it("stores a final screenshot when visual comparison is enabled", async () => {
    const { executeRun } = await import("../../apps/runner/src/execute.js");
    const test = await prisma.test.findFirst({ orderBy: { createdAt: "asc" } });
    expect(test).toBeTruthy();
    const version = await prisma.testVersion.findFirst({ where: { testId: test!.id }, orderBy: { version: "desc" } });
    expect(version).toBeTruthy();
    const suite = await prisma.suite.findUnique({ where: { id: test!.suiteId }, include: { project: true } });
    expect(suite).toBeTruthy();
    const run = await prisma.run.create({
      data: {
        organizationId: suite!.project.organizationId,
        projectId: test!.projectId,
        suiteId: test!.suiteId,
        testId: test!.id,
        testVersionId: version!.id,
        status: "queued",
        startUrl: test!.startUrl,
        variables: {},
        traceEnabled: false,
        videoEnabled: false,
        visualEnabled: true
      }
    });

    await executeRun(run.id);

    const finished = await prisma.run.findUnique({ where: { id: run.id }, include: { artifacts: true } });
    expect(finished?.status).toBe("passed");
    expect(finished?.artifacts.some((artifact) => artifact.kind === "finalScreenshot")).toBe(true);
  });
});
