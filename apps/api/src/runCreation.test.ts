import { beforeEach, describe, expect, it, vi } from "vitest";

const addRunJob = vi.fn();
const prismaMock = {
  test: {
    findUnique: vi.fn()
  },
  testVersion: {
    findFirst: vi.fn()
  },
  environment: {
    findFirst: vi.fn()
  },
  run: {
    create: vi.fn()
  }
};

vi.mock("@sentinelqa/db", () => ({
  prisma: prismaMock,
  Prisma: {}
}));

vi.mock("./queues.js", () => ({
  queues: {
    runTest: { add: addRunJob }
  }
}));

describe("API run creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a queued run bound to the latest immutable test version", async () => {
    const { createTestRun } = await import("./runCreation.js");
    prismaMock.test.findUnique.mockResolvedValue({
      id: "test_1",
      projectId: "project_1",
      suiteId: "suite_1",
      visualEnabled: false,
      suite: { project: { organizationId: "org_1" } }
    });
    prismaMock.testVersion.findFirst.mockResolvedValue({
      id: "version_2",
      dsl: {
        name: "Smoke",
        startUrl: "https://{{host}}",
        defaultVariables: { host: "default.local" },
        steps: [{ id: "open", command: "open", target: "https://{{host}}", sequence: 1 }]
      }
    });
    prismaMock.environment.findFirst.mockResolvedValue({ id: "env_1", variables: { host: "env.local" } });
    prismaMock.run.create.mockResolvedValue({ id: "run_1", status: "queued" });

    const run = await createTestRun({ testId: "test_1", variables: { host: "run.local" } });

    expect(run.id).toBe("run_1");
    expect(prismaMock.run.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          testVersionId: "version_2",
          status: "queued",
          startUrl: "https://run.local"
        })
      })
    );
    expect(addRunJob).toHaveBeenCalledWith("execute", { runId: "run_1" }, expect.any(Object));
  });

  it("uses secret variables for interpolation without storing them on the run", async () => {
    const { createTestRun } = await import("./runCreation.js");
    prismaMock.test.findUnique.mockResolvedValue({
      id: "test_1",
      projectId: "project_1",
      suiteId: "suite_1",
      visualEnabled: false,
      suite: { project: { organizationId: "org_1" } }
    });
    prismaMock.testVersion.findFirst.mockResolvedValue({
      id: "version_2",
      dsl: {
        name: "Secret smoke",
        startUrl: "https://example.com/{{apiKey}}",
        defaultVariables: { publicName: "visible" },
        secretVariables: { apiKey: "private-token" },
        steps: [{ id: "open", command: "open", target: "https://example.com", sequence: 1 }]
      }
    });
    prismaMock.environment.findFirst.mockResolvedValue(null);
    prismaMock.run.create.mockResolvedValue({ id: "run_1", status: "queued" });

    await createTestRun({ testId: "test_1" });

    expect(prismaMock.run.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          startUrl: "https://example.com/private-token",
          variables: { publicName: "visible" }
        })
      })
    );
  });
});
