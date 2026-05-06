import { createHmac } from "node:crypto";

export interface RunNotificationPayload {
  runId: string;
  testId: string;
  suiteId?: string | null;
  status: string;
  queuedAt?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  durationMs?: number | null;
  artifactUrls: Array<{ kind: string; url: string | null }>;
  visualStatus?: string | null;
  failedSteps: Array<{
    id: string;
    sequence: number;
    command: string;
    error?: string | null;
  }>;
}

export function signWebhookPayload(payload: unknown, secret: string): string {
  return createHmac("sha256", secret).update(JSON.stringify(payload)).digest("hex");
}

export async function sendWebhook(options: {
  url: string;
  payload: RunNotificationPayload;
  secret?: string | null;
}): Promise<{ status: number; body: string }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": "SentinelQA-Webhook/0.1"
  };
  if (options.secret) {
    headers["x-sentinelqa-signature"] = signWebhookPayload(options.payload, options.secret);
  }

  const response = await fetch(options.url, {
    method: "POST",
    headers,
    body: JSON.stringify(options.payload)
  });
  return {
    status: response.status,
    body: await response.text()
  };
}

export function toSlackCompatibleMessage(payload: RunNotificationPayload): Record<string, unknown> {
  const color = payload.status === "passed" ? "#2f855a" : payload.status === "failed" ? "#c53030" : "#718096";
  return {
    text: `SentinelQA run ${payload.runId} ${payload.status}`,
    attachments: [
      {
        color,
        fields: [
          { title: "Run", value: payload.runId, short: true },
          { title: "Test", value: payload.testId, short: true },
          { title: "Status", value: payload.status, short: true },
          { title: "Visual", value: payload.visualStatus ?? "not_checked", short: true }
        ]
      }
    ]
  };
}

