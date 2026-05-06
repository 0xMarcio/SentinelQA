# API

All mutating and read endpoints except `/healthz`, `/auth/dev-login`, `/webhooks/test`, and `/email/*` require either the dashboard session cookie or `Authorization: Bearer <api-token>`.

Core endpoints:

- `POST /auth/dev-login`
- `GET /me`
- `GET|POST /orgs/:orgId/projects`
- `GET|PUT|DELETE /projects/:projectId`
- `GET|POST /projects/:projectId/suites`
- `GET|PUT|DELETE /suites/:suiteId`
- `GET|POST /suites/:suiteId/tests`
- `GET|PUT|DELETE /tests/:testId`
- `POST /tests/:testId/versions`
- `POST /tests/:testId/run`
- `POST /suites/:suiteId/run`
- `GET /runs/:runId`
- `GET /runs/:runId/steps`
- `GET /runs/:runId/artifacts`
- `POST /runs/:runId/comments`
- `POST /runs/:runId/accept-baseline`
- `GET|POST /suites/:suiteId/schedules`
- `PUT|DELETE /schedules/:scheduleId`
- `GET|PUT|POST /suites/:suiteId/variables`
- `GET|POST /projects/:projectId/environments`
- `PUT|DELETE /environments/:environmentId`
- `GET|POST /suites/:suiteId/data-sources`
- `PUT|DELETE /data-sources/:dataSourceId`
- `GET|POST /orgs/:orgId/notification-endpoints`
- `PUT|DELETE /notification-endpoints/:endpointId`
- `GET /email/:mailbox`
- `GET /email/:mailbox/latest`
- `POST /webhooks/test`
- `GET /healthz`

Run creation body:

```json
{
  "startUrl": "https://example.test",
  "environmentId": "env_id",
  "variables": { "email": "qa@example.test" },
  "trace": true,
  "video": true
}
```

Webhook payload:

```json
{
  "runId": "run_id",
  "testId": "test_id",
  "suiteId": "suite_id",
  "status": "passed",
  "queuedAt": "2026-05-05T20:00:00.000Z",
  "startedAt": "2026-05-05T20:00:01.000Z",
  "finishedAt": "2026-05-05T20:00:04.000Z",
  "durationMs": 3000,
  "artifactUrls": [{ "kind": "finalScreenshot", "url": "http://localhost:9000/..." }],
  "visualStatus": "passed",
  "failedSteps": []
}
```
