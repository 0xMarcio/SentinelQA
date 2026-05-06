"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FolderPlus } from "lucide-react";
import { Loader } from "../components/Loader";
import { NavShell } from "../components/NavShell";
import { api } from "../lib/api";

interface Me {
  organizations: Array<{ id: string; name: string; projects: Array<{ id: string; name: string }> }>;
}

export default function HomePage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [projectName, setProjectName] = useState("New Project");

  useEffect(() => {
    api<Me>("/me")
      .then(setMe)
      .catch(() => router.push("/login"));
  }, [router]);

  async function createProject(orgId: string) {
    const project = await api<{ id: string }>(`/orgs/${orgId}/projects`, {
      method: "POST",
      body: JSON.stringify({ name: projectName })
    });
    router.push(`/projects/${project.id}`);
  }

  const org = me?.organizations[0];
  return (
    <>
      <Loader done={!!me} />
      {me ? (
    <NavShell orgId={org?.id}>
      <div className="topbar">
        <div>
          <div className="eyebrow">Organization</div>
          <h1>{org?.name ?? "SentinelQA"}</h1>
        </div>
      </div>
      <div className="grid two">
        <div className="table-panel">
          <table>
            <thead>
              <tr>
                <th>Project</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {org?.projects.map((project) => (
                <tr key={project.id}>
                  <td>{project.name}</td>
                  <td><Link className="button secondary" href={`/projects/${project.id}`}>Open</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {org ? (
          <div className="panel grid">
            <h2>Create project</h2>
            <div className="field">
              <label>Name</label>
              <input value={projectName} onChange={(event) => setProjectName(event.target.value)} />
            </div>
            <button className="button" onClick={() => createProject(org.id)}>
              <FolderPlus size={16} /> Create
            </button>
          </div>
        ) : null}
      </div>
    </NavShell>
      ) : null}
    </>
  );
}

