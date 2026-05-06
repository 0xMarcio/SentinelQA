"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Edit3, Play } from "lucide-react";
import { Loader } from "../../../components/Loader";
import { NavShell } from "../../../components/NavShell";
import { Status } from "../../../components/Status";
import { api, formatDateTime, formatDuration } from "../../../lib/api";

interface TestRecord {
  id: string;
  name: string;
  startUrl: string;
  visualEnabled: boolean;
  visualThreshold: number;
  suite: { id: string; projectId: string };
  versions: Array<{ id: string; version: number; createdAt: string; dsl: unknown }>;
  runs: Array<{ id: string; status: string; visualStatus?: string | null; durationMs?: number | null; createdAt: string; startUrl: string }>;
}

export default function TestPage() {
  const { testId } = useParams<{ testId: string }>();
  const router = useRouter();
  const [test, setTest] = useState<TestRecord | null>(null);

  async function load() {
    setTest(await api<TestRecord>(`/tests/${testId}`));
  }

  useEffect(() => {
    load().catch(() => router.push("/login"));
  }, [testId, router]);

  async function runTest() {
    const run = await api<{ id: string }>(`/tests/${testId}/run`, { method: "POST", body: "{}" });
    router.push(`/runs/${run.id}`);
  }

  const latest = test?.runs[0];
  return (
    <>
      <Loader done={!!test} />
      {test ? (
    <NavShell projectId={test.suite.projectId} suiteId={test.suite.id}>
      <div className="topbar">
        <div>
          <div className="eyebrow">Test</div>
          <h1>{test.name}</h1>
        </div>
        <div className="actions">
          <Link className="button secondary" href={`/tests/${test.id}/edit`}><Edit3 size={16} /> Edit</Link>
          <button className="button" onClick={runTest}><Play size={16} /> Run</button>
        </div>
      </div>
      <div className="grid three">
        <div className="sq-stat"><span>Latest</span><strong><Status value={latest?.status} /></strong></div>
        <div className="sq-stat"><span>Visual</span><strong><Status value={latest?.visualStatus ?? (test.visualEnabled ? "enabled" : "off")} /></strong></div>
        <div className="sq-stat"><span>Duration</span><strong>{formatDuration(latest?.durationMs)}</strong></div>
      </div>
      <div className="panel grid" style={{ marginTop: 16 }}>
        <h2>Settings</h2>
        <div className="grid two">
          <div><div className="eyebrow">Start URL</div>{test.startUrl}</div>
          <div><div className="eyebrow">Versions</div>{test.versions.length}</div>
        </div>
      </div>
      <div className="table-panel" style={{ marginTop: 16 }}>
        <table>
          <thead>
            <tr>
              <th>Run</th>
              <th>Status</th>
              <th>Visual</th>
              <th>Duration</th>
              <th>Started</th>
            </tr>
          </thead>
          <tbody>
            {test.runs.map((run) => (
              <tr key={run.id}>
                <td><Link href={`/runs/${run.id}`}>{run.id}</Link></td>
                <td><Status value={run.status} /></td>
                <td><Status value={run.visualStatus} /></td>
                <td>{formatDuration(run.durationMs)}</td>
                <td>{formatDateTime(run.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </NavShell>
      ) : null}
    </>
  );
}
