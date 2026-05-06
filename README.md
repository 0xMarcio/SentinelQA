# SentinelQA

SentinelQA is a clean-room browser testing and monitoring MVP. It provides a no-code browser test editor, Chrome recorder extension, Fastify API, Playwright runner, scheduled executions, visual baselines, artifact storage, webhooks, and a CLI.

## Local Setup

Use Node 25. The repo includes `.nvmrc`, `.node-version`, and `engines.node` so local shells, package installs, and CI use the same major runtime.

```bash
corepack enable
corepack prepare pnpm@10.33.3 --activate
pnpm install
docker compose -f infra/docker-compose.yml up -d
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Default services:

- Dashboard: http://localhost:3000
- API: http://localhost:4000
- MinIO console: http://localhost:9101 (`sentinelqa` / `sentinelqa-secret`)
- Mailpit: http://localhost:8025
- Email test service: send to `<mailbox>@email.sentinelqa.local` through Mailpit SMTP on `localhost:1025`, then open `http://localhost:3000/email/<mailbox>` or `http://localhost:3000/email/<mailbox>/latest`. Messages are shown for the configured retention window, defaulting to 1 hour.

Runner browser profile defaults:

- Videos are recorded at the configured viewport size.
- The runner waits briefly between steps so videos and target-side navigation are readable.
- Final screenshots default to the visible viewport, not the whole page. They wait for page load, network idle when available, fonts, a paint frame, and the configured final screenshot delay before capture.
- Visual baselines are keyed by test, browser, viewport, environment, and region so changing from 1440x900 to 1920x1080 creates a separate baseline instead of comparing mismatched dimensions.
- `RUNNER_USER_AGENT`, `RUNNER_USER_AGENT_SOURCE`, `RUNNER_USER_AGENT_BROWSER`, `RUNNER_USER_AGENT_PLATFORM`, `RUNNER_ACTION_DELAY_MS`, `RUNNER_NAVIGATION_SETTLE_MS`, and `RUNNER_FINAL_SETTLE_MS` can tune browser fidelity locally or on a VPS. The default UA catalog is `https://ua.syntax9.ai/api/all.json`.
- HTTP 4xx/5xx responses are recorded as step metadata, not automatic failures. Use assertions to decide whether an error page or block page is expected.

Seed credentials:

- Dev login works from the dashboard without a password.
- CLI/API token: `sentinelqa-dev-token`

## Common Commands

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm --filter @sentinelqa/cli dev -- test run <testId> --wait
```

## Troubleshooting

- If Prisma cannot connect, verify Docker dependencies are running and `.env` matches `infra/docker-compose.yml`.
- If you already created the local Postgres volume with an older major image, recreate dev data before moving to the current compose image: `docker compose -f infra/docker-compose.yml down -v`, then run the setup commands again.
- If artifacts fail to upload, open the MinIO console and confirm the `sentinelqa-artifacts` bucket exists. The seed script and storage adapter also create it on demand.
- If Playwright browsers are missing, run `pnpm --filter @sentinelqa/runner exec playwright install chromium`.
