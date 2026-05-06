"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { BellPlus } from "lucide-react";
import { NavShell } from "../../../../components/NavShell";
import { Status } from "../../../../components/Status";
import { api } from "../../../../lib/api";

interface Endpoint {
  id: string;
  name: string;
  kind: string;
  url: string;
  active: boolean;
}

export default function NotificationsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const router = useRouter();
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [name, setName] = useState("Local webhook");
  const [url, setUrl] = useState("http://localhost:4000/webhooks/test");

  async function load() {
    setEndpoints(await api<Endpoint[]>(`/orgs/${orgId}/notification-endpoints`));
  }

  useEffect(() => {
    load().catch(() => router.push("/login"));
  }, [orgId, router]);

  async function createEndpoint() {
    await api(`/orgs/${orgId}/notification-endpoints`, {
      method: "POST",
      body: JSON.stringify({ name, url, kind: "webhook", active: true })
    });
    await load();
  }

  return (
    <NavShell orgId={orgId}>
      <div className="topbar">
        <div>
          <div className="eyebrow">Organization</div>
          <h1>Notification endpoints</h1>
        </div>
      </div>
      <div className="grid two">
        <div className="table-panel">
          <table>
            <thead><tr><th>Name</th><th>Kind</th><th>URL</th><th>Status</th></tr></thead>
            <tbody>
              {endpoints.map((endpoint) => (
                <tr key={endpoint.id}>
                  <td>{endpoint.name}</td>
                  <td>{endpoint.kind}</td>
                  <td>{endpoint.url}</td>
                  <td><Status value={endpoint.active ? "active" : "paused"} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel grid">
          <h2>Create endpoint</h2>
          <div className="field"><label>Name</label><input value={name} onChange={(event) => setName(event.target.value)} /></div>
          <div className="field"><label>URL</label><input value={url} onChange={(event) => setUrl(event.target.value)} /></div>
          <button className="button" onClick={createEndpoint}><BellPlus size={16} /> Create</button>
        </div>
      </div>
    </NavShell>
  );
}

