# Local Development

1. Install dependencies:

   ```bash
   corepack enable
   corepack prepare pnpm@10.33.3 --activate
   pnpm install
   ```

   Use Node 25. The repo includes `.nvmrc`, `.node-version`, and `engines.node` so local shells and CI use the same major runtime.

2. Start infrastructure:

   ```bash
   docker compose -f infra/docker-compose.yml up -d
   ```

3. Prepare the database:

   ```bash
   pnpm db:push
   pnpm db:seed
   ```

4. Start the product:

   ```bash
   pnpm dev
   ```

The dashboard runs on `http://localhost:3000` and the API runs on `http://localhost:4000`.
MinIO runs at `http://localhost:9101` with `sentinelqa` / `sentinelqa-secret`.

The seed script creates an API token named `sentinelqa-dev-token`.

## CLI

```bash
pnpm --filter @sentinelqa/cli dev -- login --api-url http://localhost:4000 --token sentinelqa-dev-token
pnpm --filter @sentinelqa/cli dev -- test run <testId> --wait
```

## Extension

Build the extension:

```bash
pnpm --filter @sentinelqa/extension build
```

Load `apps/extension/dist` as an unpacked Chrome extension.
