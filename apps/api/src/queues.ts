import { Queue } from "bullmq";
import { Redis } from "ioredis";

export const connection = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null
});

export const queues = {
  runTest: new Queue("run-test", { connection }),
  runSuite: new Queue("run-suite", { connection }),
  visualDiff: new Queue("visual-diff", { connection }),
  notifyWebhook: new Queue("notify-webhook", { connection }),
  scheduleFanout: new Queue("schedule-fanout", { connection })
};
