"use client";

import Link from "next/link";
import { Bell, Boxes, CalendarDays, Gauge, Layers3, Settings } from "lucide-react";

export function NavShell({ children, projectId, suiteId, orgId }: { children: React.ReactNode; projectId?: string; suiteId?: string; orgId?: string }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/" className="brand">
          <span className="brand-mark">S</span>
          <span>SentinelQA</span>
        </Link>
        <nav>
          <Link href={projectId ? `/projects/${projectId}` : "/"}><Gauge size={18} /> Suites</Link>
          {suiteId ? <Link href={`/suites/${suiteId}`}><Layers3 size={18} /> Current Suite</Link> : null}
          {suiteId ? <Link href={`/suites/${suiteId}/settings`}><Settings size={18} /> Suite Settings</Link> : null}
          {suiteId ? <Link href={`/suites/${suiteId}/schedules`}><CalendarDays size={18} /> Schedules</Link> : null}
          {suiteId ? <Link href={`/suites/${suiteId}/data-sources`}><Boxes size={18} /> Data Sources</Link> : null}
          {orgId ? <Link href={`/orgs/${orgId}/notifications`}><Bell size={18} /> Notifications</Link> : null}
        </nav>
      </aside>
      <main className="workspace">{children}</main>
    </div>
  );
}
