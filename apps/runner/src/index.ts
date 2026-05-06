import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { executeRun } from "./execute.js";

const connection = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null
});

const worker = new Worker(
  "run-test",
  async (job) => {
    await executeRun(String(job.data.runId));
  },
  { connection, concurrency: Number(process.env.RUNNER_CONCURRENCY ?? 2) }
);

worker.on("completed", (job) => {
  console.log(`Completed run job ${job.id}`);
});

worker.on("failed", (job, error) => {
  console.error(`Failed run job ${job?.id}:`, error);
});

console.log("SentinelQA runner listening for run-test jobs");
