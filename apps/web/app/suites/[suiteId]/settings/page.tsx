"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Copy, Save, Trash2 } from "lucide-react";
import { KeyValueEditor, recordToRows, rowsToRecord, type KeyValueRow } from "../../../../components/KeyValueEditor";
import { Loader } from "../../../../components/Loader";
import { NavShell } from "../../../../components/NavShell";
import { api } from "../../../../lib/api";

interface SuiteSettings {
  id: string;
  name: string;
  description?: string | null;
  variables?: Record<string, string>;
  secretVariables?: Record<string, string>;
  project: { id: string; organizationId: string };
}

export default function SuiteSettingsPage() {
  const { suiteId } = useParams<{ suiteId: string }>();
  const router = useRouter();
  const [suite, setSuite] = useState<SuiteSettings | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [variables, setVariables] = useState<KeyValueRow[]>(recordToRows());
  const [secrets, setSecrets] = useState<KeyValueRow[]>(recordToRows());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const next = await api<SuiteSettings>(`/suites/${suiteId}`);
    setSuite(next);
    setName(next.name);
    setDescription(next.description ?? "");
    setVariables(recordToRows(next.variables ?? {}));
    setSecrets(recordToRows(next.secretVariables ?? {}));
  }

  useEffect(() => {
    load().catch(() => router.push("/login"));
  }, [suiteId, router]);

  async function save() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Suite name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await api<SuiteSettings>(`/suites/${suiteId}`, {
        method: "PUT",
        body: JSON.stringify({
          name: trimmedName,
          description: description.trim() || null,
          variables: rowsToRecord(variables),
          secretVariables: rowsToRecord(secrets)
        })
      });
      setSuite((current) => current ? { ...current, ...updated } : updated);
      router.push(`/suites/${suiteId}`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function duplicateSuite() {
    if (!suite) return;
    const copied = await api<{ id: string }>(`/suites/${suite.id}/duplicate`, {
      method: "POST",
      body: JSON.stringify({ name: `${suite.name} copy` })
    });
    router.push(`/suites/${copied.id}/settings`);
  }

  async function deleteSuite() {
    if (!suite || !confirm(`Delete "${suite.name}" and all tests in it?`)) return;
    await api(`/suites/${suite.id}`, { method: "DELETE" });
    router.push(`/projects/${suite.project.id}`);
  }

  return (
    <>
      <Loader done={!!suite} />
      {suite ? (
    <NavShell projectId={suite.project.id} suiteId={suite.id} orgId={suite.project.organizationId}>
      <div className="topbar">
        <div>
          <div className="eyebrow">Suite settings</div>
          <h1>{suite.name}</h1>
        </div>
        <div className="actions">
          <Link className="button secondary" href={`/suites/${suite.id}`}>Back</Link>
          <button className="button secondary" onClick={duplicateSuite}><Copy size={16} /> Copy</button>
          <button className="button danger" onClick={deleteSuite}><Trash2 size={16} /> Delete</button>
          <button className="button" onClick={save} disabled={saving}><Save size={16} /> {saving ? "Saving" : "Save"}</button>
        </div>
      </div>

      <div className="panel suite-settings">
        <section className="settings-stack">
          <div className="grid two">
            <div className="field">
              <label>Name</label>
              <input value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <div className="field">
              <label>Description</label>
              <input value={description} onChange={(event) => setDescription(event.target.value)} />
            </div>
          </div>

          <KeyValueEditor
            title="Variables"
            rows={variables}
            onChange={setVariables}
            addLabel="Add variable"
            namePlaceholder="baseUrl"
            valuePlaceholder="https://app.example.com"
          />

          <KeyValueEditor
            title="Secrets"
            rows={secrets}
            onChange={setSecrets}
            addLabel="Add secret"
            namePlaceholder="apiToken"
            valuePlaceholder="secret value"
            secret
          />

          {error ? <p className="form-error">{error}</p> : null}
        </section>
      </div>
    </NavShell>
      ) : null}
    </>
  );
}
