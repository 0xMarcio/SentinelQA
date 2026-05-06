#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { Command } from "commander";

interface Config {
  apiUrl: string;
  token: string;
}

const configPath = resolve(homedir(), ".sentinelqa", "config.json");

async function loadConfig(): Promise<Config> {
  const raw = await readFile(configPath, "utf8").catch(() => null);
  if (!raw) {
    throw new Error("Not logged in. Run: sentinel login --api-url http://localhost:4000 --token sentinelqa-dev-token");
  }
  return JSON.parse(raw) as Config;
}

async function saveConfig(config: Config) {
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2));
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const config = await loadConfig();
  const response = await fetch(`${config.apiUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.token}`,
      ...(init.headers ?? {})
    }
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  }
  return response.json() as Promise<T>;
}

function parseVars(values: string[] | undefined): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const pair of values ?? []) {
    const [key, ...rest] = pair.split("=");
    if (!key || rest.length === 0) {
      throw new Error(`Invalid --var value "${pair}". Use key=value.`);
    }
    variables[key] = rest.join("=");
  }
  return variables;
}

async function waitForRun(runId: string, json: boolean): Promise<number> {
  for (;;) {
    const run = await api<{ id: string; status: string }>(`/runs/${runId}`);
    if (run.status !== "queued" && run.status !== "running") {
      if (json) {
        console.log(JSON.stringify(run, null, 2));
      } else {
        console.log(`${run.id} ${run.status}`);
      }
      return run.status === "passed" ? 0 : 1;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 2000));
  }
}

const program = new Command();
program.name("sentinel").description("SentinelQA CLI").version("0.1.0");

program
  .command("login")
  .requiredOption("--api-url <url>")
  .requiredOption("--token <token>")
  .action(async (options) => {
    await saveConfig({ apiUrl: String(options.apiUrl).replace(/\/$/, ""), token: String(options.token) });
    console.log("Saved SentinelQA CLI credentials");
  });

const test = program.command("test");
test
  .command("run")
  .argument("<testId>")
  .option("--start-url <url>")
  .option("--var <key=value>", "runtime variable", (value, previous: string[]) => [...previous, value], [])
  .option("--wait")
  .option("--json")
  .action(async (testId, options) => {
    const run = await api<{ id: string; status: string }>(`/tests/${testId}/run`, {
      method: "POST",
      body: JSON.stringify({
        startUrl: options.startUrl,
        variables: parseVars(options.var)
      })
    });
    if (!options.wait) {
      console.log(options.json ? JSON.stringify(run, null, 2) : run.id);
      return;
    }
    process.exitCode = await waitForRun(run.id, Boolean(options.json));
  });

test
  .command("export")
  .argument("<testId>")
  .action(async (testId) => {
    const testRecord = await api<{ versions: Array<{ version: number; dsl: unknown }> }>(`/tests/${testId}`);
    const latest = testRecord.versions[0];
    if (!latest) throw new Error("Test has no versions");
    console.log(JSON.stringify(latest.dsl, null, 2));
  });

test
  .command("import")
  .argument("<file>")
  .requiredOption("--suite <suiteId>")
  .action(async (file, options) => {
    const dsl = JSON.parse(await readFile(resolve(file), "utf8")) as { name: string; startUrl: string };
    const created = await api<{ id: string }>(`/suites/${options.suite}/tests`, {
      method: "POST",
      body: JSON.stringify({
        name: dsl.name,
        startUrl: dsl.startUrl,
        dsl
      })
    });
    console.log(created.id);
  });

const suite = program.command("suite");
suite
  .command("run")
  .argument("<suiteId>")
  .option("--start-url <url>")
  .option("--wait")
  .option("--json")
  .action(async (suiteId, options) => {
    const result = await api<{ suiteRun: { id: string }; runs: Array<{ id: string }> }>(`/suites/${suiteId}/run`, {
      method: "POST",
      body: JSON.stringify({ startUrl: options.startUrl })
    });
    if (!options.wait) {
      console.log(options.json ? JSON.stringify(result, null, 2) : result.suiteRun.id);
      return;
    }
    let exitCode = 0;
    for (const run of result.runs) {
      const code = await waitForRun(run.id, Boolean(options.json));
      if (code !== 0) exitCode = code;
    }
    process.exitCode = exitCode;
  });

const run = program.command("run");
run
  .command("wait")
  .argument("<runId>")
  .option("--json")
  .action(async (runId, options) => {
    process.exitCode = await waitForRun(runId, Boolean(options.json));
  });

program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

