import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { prisma, type Prisma } from "@sentinelqa/db";
import { evaluateVisualThreshold } from "@sentinelqa/dsl";
import { ArtifactStorage, artifactKey } from "@sentinelqa/storage";

export async function handleVisualDiff(runId: string) {
  const storage = new ArtifactStorage();
  const run = await prisma.run.findUnique({
    where: { id: runId },
    include: { artifacts: true, test: true }
  });
  if (!run || run.status !== "passed") {
    return;
  }
  const finalScreenshot =
    run.artifacts.find((artifact) => artifact.kind === "finalScreenshot") ??
    run.artifacts.find((artifact) => artifact.kind === "screenshot");
  if (!finalScreenshot) {
    await prisma.run.update({ where: { id: run.id }, data: { visualStatus: "missing_screenshot" } });
    return;
  }

  const environmentKey = run.environmentId ?? "default";
  const viewport = viewportFromValue(run.viewport);
  const viewportKey = `${viewport.width}x${viewport.height}`;
  const baseline = await prisma.visualBaseline.findUnique({
    where: {
      testId_browser_viewportKey_environmentKey_regionKey: {
        testId: run.testId,
        browser: run.browser,
        viewportKey,
        environmentKey,
        regionKey: "full-page"
      }
    },
    include: { artifact: true }
  });

  if (!baseline) {
    await prisma.visualBaseline.create({
      data: {
        testId: run.testId,
        browser: run.browser,
        viewport: viewport as Prisma.InputJsonValue,
        viewportKey,
        environmentKey,
        regionKey: "full-page",
        artifactId: finalScreenshot.id
      }
    });
    await prisma.run.update({ where: { id: run.id }, data: { visualStatus: "baseline_created" } });
    return;
  }

  const currentBuffer = await storage.getBuffer(finalScreenshot.key);
  const baselineBuffer = await storage.getBuffer(baseline.artifact.key);
  const current = PNG.sync.read(currentBuffer);
  const expected = PNG.sync.read(baselineBuffer);
  if (current.width !== expected.width || current.height !== expected.height) {
    await prisma.run.update({
      where: { id: run.id },
      data: { status: "failed", visualStatus: "failed_dimension_mismatch", error: "Visual baseline dimensions changed" }
    });
    return;
  }

  const diff = new PNG({ width: current.width, height: current.height });
  const diffPixels = pixelmatch(expected.data, current.data, diff.data, current.width, current.height, { threshold: 0.1 });
  const result = evaluateVisualThreshold(current.width * current.height, diffPixels, run.test.visualThreshold);
  const uploaded = await storage.putBuffer(artifactKey(run.id, "visualDiff", "diff.png"), PNG.sync.write(diff), "image/png");
  await prisma.artifact.create({
    data: {
      runId: run.id,
      kind: "visualDiff",
      key: uploaded.key,
      url: uploaded.url,
      contentType: uploaded.contentType,
      sizeBytes: uploaded.sizeBytes,
      metadata: {
        diffPixels: result.diffPixels,
        totalPixels: result.totalPixels,
        diffPercentage: result.diffPercentage,
        matchPercentage: Math.max(0, 100 - result.diffPercentage),
        threshold: run.test.visualThreshold
      }
    }
  });

  await prisma.run.update({
    where: { id: run.id },
    data: {
      status: result.passed ? "passed" : "failed",
      visualStatus: result.passed ? "passed" : "failed",
      error: result.passed ? null : `Visual diff ${result.diffPercentage.toFixed(3)}% exceeded ${run.test.visualThreshold}%`
    }
  });
}

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
