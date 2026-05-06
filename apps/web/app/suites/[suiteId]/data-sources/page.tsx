"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { API_BASE, api, formatDateTime } from "../../../../lib/api";
import { NavShell } from "../../../../components/NavShell";

interface DataSource {
  id: string;
  name: string;
  rows: Array<Record<string, string>>;
  createdAt: string;
}

export default function DataSourcesPage() {
  const { suiteId } = useParams<{ suiteId: string }>();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [sources, setSources] = useState<DataSource[]>([]);

  async function load() {
    setSources(await api<DataSource[]>(`/suites/${suiteId}/data-sources`));
  }

  useEffect(() => {
    load().catch(() => router.push("/login"));
  }, [suiteId, router]);

  async function upload() {
    const file = inputRef.current?.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    const response = await fetch(`${API_BASE}/suites/${suiteId}/data-sources`, {
      method: "POST",
      credentials: "include",
      body: form
    });
    if (!response.ok) throw new Error(await response.text());
    await load();
  }

  return (
    <NavShell suiteId={suiteId}>
      <div className="topbar">
        <div>
          <div className="eyebrow">Suite</div>
          <h1>Data sources</h1>
        </div>
        <div className="actions">
          <input ref={inputRef} type="file" accept=".csv,text/csv" />
          <button className="button" onClick={upload}><Upload size={16} /> Upload CSV</button>
        </div>
      </div>
      <div className="table-panel">
        <table>
          <thead><tr><th>Name</th><th>Rows</th><th>Created</th></tr></thead>
          <tbody>
            {sources.map((source) => (
              <tr key={source.id}>
                <td>{source.name}</td>
                <td>{source.rows.length}</td>
                <td>{formatDateTime(source.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </NavShell>
  );
}
