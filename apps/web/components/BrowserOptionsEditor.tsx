"use client";

import { Plus, Trash2 } from "lucide-react";
import type { BrowserSettings } from "@sentinelqa/dsl";
import { KeyValueEditor, recordToRows, rowsToRecord, type KeyValueRow } from "./KeyValueEditor";

export type UserAgentBrowser = "chrome" | "edge" | "firefox" | "safari";
export type UserAgentPlatform = "windows" | "macos" | "linux" | "ubuntu" | "android" | "iphone" | "ipad";

export interface CookieRow {
  id: string;
  name: string;
  value: string;
  domain: string;
  path: string;
}

export const defaultBrowser: BrowserSettings = {
  browser: "chromium",
  viewport: { width: 1920, height: 1080 },
  userAgentBrowser: "chrome",
  userAgentPlatform: "linux",
  headers: {},
  localStorage: {},
  cookies: [],
  actionDelayMs: 500,
  navigationSettleMs: 1200,
  finalScreenshotDelayMs: 1000,
  elementTimeoutMs: 15000,
  trace: true,
  video: true
};

export const userAgentBrowsers: Array<{ label: string; value: UserAgentBrowser }> = [
  { label: "Chrome", value: "chrome" },
  { label: "Microsoft Edge", value: "edge" },
  { label: "Firefox", value: "firefox" },
  { label: "Safari", value: "safari" }
];

export const userAgentPlatforms: Array<{ label: string; value: UserAgentPlatform }> = [
  { label: "Windows desktop", value: "windows" },
  { label: "macOS desktop", value: "macos" },
  { label: "Linux desktop", value: "linux" },
  { label: "Ubuntu desktop", value: "ubuntu" },
  { label: "Android mobile", value: "android" },
  { label: "iPhone", value: "iphone" },
  { label: "iPad", value: "ipad" }
];

export function normalizeUserAgentPlatform(value: unknown): UserAgentPlatform {
  if (value === "mac") return "macos";
  return userAgentPlatforms.some((platform) => platform.value === value) ? value as UserAgentPlatform : "linux";
}

export function normalizeUserAgentBrowser(value: unknown): UserAgentBrowser {
  return userAgentBrowsers.some((browser) => browser.value === value) ? value as UserAgentBrowser : "chrome";
}

export function normalizeBrowser(browser?: Partial<BrowserSettings>): BrowserSettings {
  return {
    ...defaultBrowser,
    ...browser,
    userAgentBrowser: normalizeUserAgentBrowser(browser?.userAgentBrowser),
    userAgentPlatform: normalizeUserAgentPlatform(browser?.userAgentPlatform),
    headers: browser?.headers ?? {},
    localStorage: browser?.localStorage ?? {},
    cookies: browser?.cookies ?? [],
    viewport: {
      width: browser?.viewport?.width ?? defaultBrowser.viewport.width,
      height: browser?.viewport?.height ?? defaultBrowser.viewport.height
    }
  };
}

export function cookiesToRows(cookies: BrowserSettings["cookies"] = []): CookieRow[] {
  const rows = cookies.map((cookie) => ({
    id: crypto.randomUUID(),
    name: cookie.name,
    value: cookie.value,
    domain: cookie.url ?? cookie.domain ?? "",
    path: cookie.path ?? "/"
  }));
  return rows.length > 0 ? rows : [newCookieRow()];
}

export function rowsToCookies(rows: CookieRow[]): BrowserSettings["cookies"] {
  return rows
    .map((row) => ({
      name: row.name.trim(),
      value: row.value,
      domain: row.domain.trim(),
      path: row.path.trim() || "/"
    }))
    .filter((row) => row.name.length > 0)
    .map((row) => {
      if (/^https?:\/\//i.test(row.domain)) {
        return { name: row.name, value: row.value, url: row.domain, path: row.path, httpOnly: false, secure: row.domain.startsWith("https://"), sameSite: "Lax" as const };
      }
      return { name: row.name, value: row.value, domain: row.domain || undefined, path: row.path, httpOnly: false, secure: true, sameSite: "Lax" as const };
    });
}

function newCookieRow(): CookieRow {
  return { id: crypto.randomUUID(), name: "", value: "", domain: "", path: "/" };
}

export function BrowserOptionsEditor({
  userAgentBrowser,
  setUserAgentBrowser,
  userAgentPlatform,
  setUserAgentPlatform,
  headers,
  setHeaders,
  localStorageEntries,
  setLocalStorageEntries,
  cookies,
  setCookies
}: {
  userAgentBrowser: UserAgentBrowser;
  setUserAgentBrowser(value: UserAgentBrowser): void;
  userAgentPlatform: UserAgentPlatform;
  setUserAgentPlatform(value: UserAgentPlatform): void;
  headers: KeyValueRow[];
  setHeaders(rows: KeyValueRow[]): void;
  localStorageEntries: KeyValueRow[];
  setLocalStorageEntries(rows: KeyValueRow[]): void;
  cookies: CookieRow[];
  setCookies(rows: CookieRow[]): void;
}) {
  return (
    <div className="settings-stack">
      <div className="grid two">
        <label className="field">
          <span>Browser</span>
          <select value={userAgentBrowser} onChange={(event) => setUserAgentBrowser(event.target.value as UserAgentBrowser)}>
            {userAgentBrowsers.map((browser) => (
              <option key={browser.value} value={browser.value}>{browser.label}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Platform</span>
          <select value={userAgentPlatform} onChange={(event) => setUserAgentPlatform(event.target.value as UserAgentPlatform)}>
            {userAgentPlatforms.map((platform) => (
              <option key={platform.value} value={platform.value}>{platform.label}</option>
            ))}
          </select>
        </label>
      </div>
      <KeyValueEditor
        title="Headers"
        rows={headers}
        onChange={setHeaders}
        addLabel="Add header"
        namePlaceholder="Authorization"
        valuePlaceholder="Bearer {{token}}"
      />
      <CookieEditor rows={cookies} onChange={setCookies} />
      <KeyValueEditor
        title="Local storage"
        rows={localStorageEntries}
        onChange={setLocalStorageEntries}
        addLabel="Add item"
        namePlaceholder="theme"
        valuePlaceholder="dark"
      />
    </div>
  );
}

function CookieEditor({ rows, onChange }: { rows: CookieRow[]; onChange(rows: CookieRow[]): void }) {
  const updateRow = (rowId: string, patch: Partial<CookieRow>) => {
    onChange(rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row)));
  };

  const removeRow = (rowId: string) => {
    const next = rows.filter((row) => row.id !== rowId);
    onChange(next.length > 0 ? next : [newCookieRow()]);
  };

  return (
    <section className="key-value-editor">
      <div className="key-value-header">
        <h3>Cookies</h3>
        <button type="button" className="button secondary" onClick={() => onChange([...rows, newCookieRow()])}>
          <Plus size={16} /> Add cookie
        </button>
      </div>
      <div className="key-value-list">
        {rows.map((row) => (
          <div key={row.id} className="cookie-row">
            <label className="field">
              <span>Name</span>
              <input value={row.name} onChange={(event) => updateRow(row.id, { name: event.target.value })} placeholder="session" />
            </label>
            <label className="field">
              <span>Value</span>
              <input value={row.value} onChange={(event) => updateRow(row.id, { value: event.target.value })} placeholder="{{sessionId}}" autoComplete="off" />
            </label>
            <label className="field">
              <span>Domain</span>
              <input value={row.domain} onChange={(event) => updateRow(row.id, { domain: event.target.value })} placeholder=".example.com" />
            </label>
            <label className="field">
              <span>Path</span>
              <input value={row.path} onChange={(event) => updateRow(row.id, { path: event.target.value })} placeholder="/" />
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

export { recordToRows, rowsToRecord, type KeyValueRow };
