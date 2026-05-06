import type { ButtonHTMLAttributes, ReactNode } from "react";

export function StatusBadge({ status }: { status: string }) {
  return <span className={`sq-badge sq-badge-${status}`}>{status.replaceAll("_", " ")}</span>;
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

