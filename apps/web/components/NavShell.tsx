"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Boxes, CalendarDays, Gauge, Layers3, Settings } from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: typeof Gauge;
}

export function NavShell({
  children,
  projectId,
  suiteId,
  orgId
}: {
  children: React.ReactNode;
  projectId?: string;
  suiteId?: string;
  orgId?: string;
}) {
  const pathname = usePathname() ?? "/";

  const primary: NavItem[] = [
    { href: projectId ? `/projects/${projectId}` : "/", label: "Suites", icon: Gauge }
  ];

  const suite: NavItem[] = suiteId
    ? [
        { href: `/suites/${suiteId}`, label: "Current Suite", icon: Layers3 },
        { href: `/suites/${suiteId}/settings`, label: "Settings", icon: Settings },
        { href: `/suites/${suiteId}/schedules`, label: "Schedules", icon: CalendarDays },
        { href: `/suites/${suiteId}/data-sources`, label: "Data Sources", icon: Boxes }
      ]
    : [];

  const org: NavItem[] = orgId
    ? [{ href: `/orgs/${orgId}/notifications`, label: "Notifications", icon: Bell }]
    : [];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/" className="brand">
          <span className="brand-mark">S</span>
          <span>SentinelQA</span>
        </Link>
        <nav>
          {primary.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} />
          ))}
          {suite.length > 0 ? (
            <div className="nav-group">
              {suite.map((item) => (
                <NavLink key={item.href} item={item} pathname={pathname} />
              ))}
            </div>
          ) : null}
          {org.length > 0 ? (
            <div className="nav-group">
              {org.map((item) => (
                <NavLink key={item.href} item={item} pathname={pathname} />
              ))}
            </div>
          ) : null}
        </nav>
      </aside>
      <main className="workspace">{children}</main>
    </div>
  );
}

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const Icon = item.icon;
  const isActive =
    item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`);
  return (
    <Link href={item.href} className={isActive ? "active" : undefined} aria-current={isActive ? "page" : undefined}>
      <Icon size={15} />
      <span>{item.label}</span>
    </Link>
  );
}
