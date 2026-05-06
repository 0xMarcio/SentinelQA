import { buildServer } from "./server.js";

const server = await buildServer();
const port = Number(process.env.API_PORT ?? 4000);
const host = process.env.API_HOST ?? "0.0.0.0";

try {
  await server.listen({ port, host });
  server.log.info(`SentinelQA API listening on http://${host}:${port}`);
} catch (error) {
  server.log.error(error);
  process.exit(1);
}

