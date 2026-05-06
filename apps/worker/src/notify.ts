import { prisma, type Prisma } from "@sentinelqa/db";
import { sendWebhook, toSlackCompatibleMessage, type RunNotificationPayload } from "@sentinelqa/integrations";

export async function handleWebhookNotification(runId: string) {
  const run = await prisma.run.findUnique({
    where: { id: runId },
    include: { artifacts: true, stepResults: true }
  });
  if (!run) {
    return;
  }
  const endpoints = await prisma.notificationEndpoint.findMany({
    where: { organizationId: run.organizationId, active: true }
  });
  if (endpoints.length === 0) {
    return;
  }

  const payload: RunNotificationPayload = {
    runId: run.id,
    testId: run.testId,
    suiteId: run.suiteId,
    status: run.status,
    queuedAt: run.queuedAt.toISOString(),
    startedAt: run.startedAt?.toISOString(),
    finishedAt: run.finishedAt?.toISOString(),
    durationMs: run.durationMs,
    artifactUrls: run.artifacts.map((artifact) => ({ kind: artifact.kind, url: artifact.url })),
    visualStatus: run.visualStatus,
    failedSteps: run.stepResults
      .filter((step) => step.status === "failed")
      .map((step) => ({ id: step.stepId, sequence: step.sequence, command: step.command, error: step.error }))
  };

  for (const endpoint of endpoints) {
    const requestBody = endpoint.kind === "slack" ? toSlackCompatibleMessage(payload) : payload;
    const delivery = await prisma.webhookDelivery.create({
      data: {
        runId: run.id,
        notificationEndpointId: endpoint.id,
        status: "queued",
        requestBody: requestBody as Prisma.InputJsonValue
      }
    });
    try {
      const result = await sendWebhook({ url: endpoint.url, payload: requestBody as RunNotificationPayload, secret: endpoint.secret });
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: result.status >= 200 && result.status < 300 ? "delivered" : "failed",
          responseStatus: result.status,
          responseBody: result.body.slice(0, 4000),
          deliveredAt: new Date()
        }
      });
    } catch (error) {
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: "failed",
          error: error instanceof Error ? error.message : String(error)
        }
      });
    }
  }
}
