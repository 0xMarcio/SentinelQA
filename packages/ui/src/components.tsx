import type { ButtonHTMLAttributes, ReactNode } from "react";

export function StatusBadge({ status }: { status: string }) {
  const value = (status ?? "unknown").toString();
  const slug = value.toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  const label = value.replaceAll("_", " ");
  return <span className={`sq-badge sq-badge-${slug}`}>{label}</span>;
}

export function Button({ children, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`sq-button ${className}`.trim()} {...props}>
      {children}
    </button>
  );
}

export function EmptyState({ title, detail, action }: { title: string; detail?: string; action?: ReactNode }) {
  return (
    <div className="sq-empty">
      <h2>{title}</h2>
      {detail ? <p>{detail}</p> : null}
      {action}
    </div>
  );
}

export function StatTile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="sq-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
