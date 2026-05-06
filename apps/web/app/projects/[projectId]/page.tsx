"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Copy, Play, Plus, Settings } from "lucide-react";
import { Loader } from "../../../components/Loader";
import { NavShell } from "../../../components/NavShell";
import { Status } from "../../../components/Status";
import { api } from "../../../lib/api";

interface Project {
  id: string;
  name: string;
  organizationId: string;
  suites: Array<{
    id: string;
    name: string;
    tests: Array<{ id: string; runs: Array<{ id: string; status: string; createdAt: string }> }>;
    schedules: Array<{ id: string; active: boolean }>;
  }>;
}

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [suiteName, setSuiteName] = useState("");
  const [suiteDescription, setSuiteDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [projectRecord, suites] = await Promise.all([
      api<Project>(`/projects/${projectId}`),
      api<Project["suites"]>(`/projects/${projectId}/suites`)
    ]);
    setProject({ ...projectRecord, suites });
  }

  useEffect(() => {
    load().catch(() => router.push("/login"));
  }, [projectId, router]);

  async function createSuite() {
    const name = suiteName.trim();
    if (!name) {
      setError("Suite name is required.");
      return;
    }
    setError(null);
    const suite = await api<{ id: string }>(`/projects/${projectId}/suites`, {
      method: "POST",
      body: JSON.stringify({ name, description: suiteDescription.trim() || null })
    });
    router.push(`/suites/${suite.id}`);
  }

  async function duplicateSuite(suiteId: string, suiteName: string) {
    const suite = await api<{ id: string }>(`/suites/${suiteId}/duplicate`, {
      method: "POST",
      body: JSON.stringify({ name: `${suiteName} copy` })
    });
    router.push(`/suites/${suite.id}/settings`);
  }

  async function runSuite(suiteId: string) {
    await api(`/suites/${suiteId}/run`, { method: "POST", body: "{}" });
    await load();
  }

  return (
    <>
      <Loader done={!!project} />
      {project ? (
    <NavShell projectId={project.id} orgId={project.organizationId}>
      <div className="topbar">
        <div>
          <div className="eyebrow">Project</div>
          <h1>{project.name}</h1>
        </div>
        <div className="actions">
          <button className="button" onClick={() => setCreateOpen((open) => !open)}><Plus size={16} /> New suite</button>
        </div>
      </div>
      {createOpen ? (
        <section className="panel create-panel">
          <div className="grid two">
            <div className="field">
              <label>Name</label>
              <input value={suiteName} onChange={(event) => setSuiteName(event.target.value)} autoFocus />
            </div>
            <div className="field">
              <label>Description</label>
              <input value={suiteDescription} onChange={(event) => setSuiteDescription(event.target.value)} />
            </div>
          </div>
          {error ? <p className="form-error">{error}</p> : null}
          <div className="actions">
            <button className="button" onClick={createSuite}>Create</button>
            <button className="button secondary" onClick={() => setCreateOpen(false)}>Cancel</button>
          </div>
        </section>
      ) : null}
      <div className="table-panel">
        <table>
          <thead>
            <tr>
              <th>Suite</th>
              <th>Tests</th>
              <th>Latest</th>
              <th>Schedules</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {project.suites.map((suite) => {
              const latest = suite.tests.flatMap((test) => test.runs).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
              return (
                <tr key={suite.id}>
                  <td><Link href={`/suites/${suite.id}`}>{suite.name}</Link></td>
                  <td>{suite.tests.length}</td>
                  <td><Status value={latest?.status} /></td>
                  <td>{suite.schedules.filter((schedule) => schedule.active).length}</td>
                  <td className="actions">
                    <button className="button secondary" onClick={() => runSuite(suite.id)}><Play size={16} /> Run</button>
                    <button className="button secondary" onClick={() => duplicateSuite(suite.id, suite.name)}><Copy size={16} /> Copy</button>
                    <Link className="button secondary" href={`/suites/${suite.id}/settings`}><Settings size={16} /> Settings</Link>
                    <Link className="button" href={`/suites/${suite.id}`}>Open</Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </NavShell>
      ) : null}
    </>
  );
}
