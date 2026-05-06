"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { CalendarDays, Database, Play, Plus, Settings } from "lucide-react";
import { NavShell } from "../../../components/NavShell";
import { Status } from "../../../components/Status";
import { api, formatDateTime, formatDuration } from "../../../lib/api";

interface Suite {
  id: string;
  name: string;
  description?: string | null;
  variables?: Record<string, string>;
  secretVariables?: Record<string, string>;
  project: { id: string; organizationId: string };
  tests: Array<{
    id: string;
    name: string;
    startUrl: string;
    runs: Array<{ id: string; status: string; durationMs?: number | null; createdAt: string }>;
  }>;
  schedules: Array<{ id: string; active: boolean; name: string }>;
  suiteRuns: Array<{
    id: string;
    status: string;
    createdAt: string;
    finishedAt?: string | null;
    runs: Array<{ id: string; status: string; durationMs?: number | null }>;
  }>;
}

export default function SuitePage() {
  const { suiteId } = useParams<{ suiteId: string }>();
  const router = useRouter();
  const [suite, setSuite] = useState<Suite | null>(null);

  async function load() {
    setSuite(await api<Suite>(`/suites/${suiteId}`));
  }

  useEffect(() => {
    load().catch(() => router.push("/login"));
  }, [suiteId, router]);

  async function runTest(testId: string) {
    const run = await api<{ id: string }>(`/tests/${testId}/run`, { method: "POST", body: "{}" });
    router.push(`/runs/${run.id}`);
  }

  async function runSuite() {
    await api(`/suites/${suiteId}/run`, { method: "POST", body: "{}" });
    await load();
  }

  if (!suite) return <div className="workspace">Loading</div>;
  return (
    <NavShell projectId={suite.project.id} suiteId={suite.id} orgId={suite.project.organizationId}>
      <div className="topbar">
        <div>
          <div className="eyebrow">Suite</div>
          <h1>{suite.name}</h1>
        </div>
        <div className="actions">
          <Link className="button secondary" href={`/suites/${suite.id}/settings`}><Settings size={16} /> Settings</Link>
          <Link className="button secondary" href={`/suites/${suite.id}/schedules`}><CalendarDays size={16} /> Schedules</Link>
          <Link className="button secondary" href={`/suites/${suite.id}/data-sources`}><Database size={16} /> Data</Link>
          <Link className="button secondary" href={`/suites/${suite.id}/tests/new`}><Plus size={16} /> New test</Link>
          <button className="button" onClick={runSuite}><Play size={16} /> Run suite</button>
        </div>
      </div>
      <div className="grid four suite-stats">
        <div className="sq-stat"><span>Tests</span><strong>{suite.tests.length}</strong></div>
        <div className="sq-stat"><span>Schedules</span><strong>{suite.schedules.filter((schedule) => schedule.active).length}</strong></div>
        <div className="sq-stat"><span>Variables</span><strong>{Object.keys(suite.variables ?? {}).length}</strong></div>
        <div className="sq-stat"><span>Secrets</span><strong>{Object.keys(suite.secretVariables ?? {}).length}</strong></div>
      </div>
      {suite.description ? <p className="suite-description">{suite.description}</p> : null}
      <div className="table-panel">
        <table>
          <thead>
            <tr>
              <th>Test</th>
              <th>Start URL</th>
              <th>Latest</th>
              <th>Duration</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {suite.tests.map((test) => {
              const latest = test.runs[0];
              return (
                <tr key={test.id}>
                  <td><Link href={`/tests/${test.id}`}>{test.name}</Link></td>
                  <td>{test.startUrl}</td>
                  <td><Status value={latest?.status} /></td>
                  <td>{formatDuration(latest?.durationMs)}</td>
                  <td className="actions">
                    <button className="button secondary" onClick={() => runTest(test.id)}><Play size={16} /> Run</button>
                    <Link className="button" href={`/tests/${test.id}`}>Open</Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {suite.suiteRuns.length > 0 ? (
        <section className="table-panel">
          <table>
            <thead>
              <tr>
                <th>Suite run</th>
                <th>Status</th>
                <th>Tests</th>
                <th>Started</th>
              </tr>
            </thead>
            <tbody>
              {suite.suiteRuns.map((suiteRun) => {
                const firstRun = suiteRun.runs[0];
                return (
                  <tr key={suiteRun.id}>
                    <td>{firstRun ? <Link href={`/runs/${firstRun.id}`}>{suiteRun.id}</Link> : suiteRun.id}</td>
                    <td><Status value={suiteRun.status} /></td>
                    <td>{suiteRun.runs.length}</td>
                    <td>{formatDateTime(suiteRun.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ) : null}
    </NavShell>
  );
}
