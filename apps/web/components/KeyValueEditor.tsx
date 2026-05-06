"use client";

import { Plus, Trash2 } from "lucide-react";

export interface KeyValueRow {
  id: string;
  name: string;
  value: string;
}

export function newKeyValueRow(name = "", value = ""): KeyValueRow {
  return { id: crypto.randomUUID(), name, value };
}

export function recordToRows(variables: Record<string, string> = {}) {
  const rows = Object.entries(variables).map(([name, value]) => newKeyValueRow(name, value));
  return rows.length > 0 ? rows : [newKeyValueRow()];
}

export function rowsToRecord(rows: KeyValueRow[]) {
  return Object.fromEntries(
    rows
      .map((row): [string, string] => [row.name.trim(), row.value])
      .filter(([name]) => name.length > 0)
  );
}

export function KeyValueEditor({
  title,
  rows,
  onChange,
  addLabel,
  namePlaceholder,
  valuePlaceholder,
  secret = false
}: {
  title: string;
  rows: KeyValueRow[];
  onChange(rows: KeyValueRow[]): void;
  addLabel: string;
  namePlaceholder: string;
  valuePlaceholder: string;
  secret?: boolean;
}) {
  const updateRow = (rowId: string, patch: Partial<KeyValueRow>) => {
    onChange(rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row)));
  };

  const removeRow = (rowId: string) => {
    const next = rows.filter((row) => row.id !== rowId);
    onChange(next.length > 0 ? next : [newKeyValueRow()]);
  };

  return (
    <section className="key-value-editor">
      <div className="key-value-header">
        <h3>{title}</h3>
        <button type="button" className="button secondary" onClick={() => onChange([...rows, newKeyValueRow()])}>
          <Plus size={16} /> {addLabel}
        </button>
      </div>
      <div className="key-value-list">
        {rows.map((row) => (
          <div key={row.id} className="key-value-row">
            <label className="field">
              <span>Name</span>
              <input value={row.name} onChange={(event) => updateRow(row.id, { name: event.target.value })} placeholder={namePlaceholder} />
            </label>
            <label className="field">
              <span>Value</span>
              <input
                type={secret ? "password" : "text"}
                value={row.value}
                onChange={(event) => updateRow(row.id, { value: event.target.value })}
                placeholder={valuePlaceholder}
                autoComplete="off"
              />
            </label>
            <button type="button" className="icon-button key-value-remove" onClick={() => removeRow(row.id)} title="Remove">
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
