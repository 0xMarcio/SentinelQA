import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { handleVisualDiff } from "./visual.js";
import { handleWebhookNotification } from "./notify.js";

const connection = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });
const notifyQueue = new Queue("notify-webhook", { connection });

const visualWorker = new Worker(
  "visual-diff",
  async (job) => {
    await handleVisualDiff(String(job.data.runId));
    await notifyQueue.add("send", { runId: String(job.data.runId) }, { jobId: `notify-${job.data.runId}-${Date.now()}` });
  },
  { connection, concurrency: Number(process.env.VISUAL_WORKER_CONCURRENCY ?? 2) }
);

const notifyWorker = new Worker(
  "notify-webhook",
  async (job) => {
    await handleWebhookNotification(String(job.data.runId));
  },
  { connection, concurrency: Number(process.env.NOTIFY_WORKER_CONCURRENCY ?? 4) }
);

visualWorker.on("failed", (job, error) => console.error(`visual-diff failed ${job?.id}`, error));
notifyWorker.on("failed", (job, error) => console.error(`notify-webhook failed ${job?.id}`, error));

console.log("SentinelQA worker listening for visual-diff and notify-webhook jobs");
