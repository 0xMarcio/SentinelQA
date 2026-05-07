"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { BrowserSettings } from "@sentinelqa/dsl";
import { Loader } from "../../../../../components/Loader";
import { NavShell } from "../../../../../components/NavShell";
import { TestEditor } from "../../../../../components/TestEditor";
import { api } from "../../../../../lib/api";

interface SuiteRecord {
  id: string;
  browserOptions?: Partial<BrowserSettings>;
}

export default function NewTestPage() {
  const { suiteId } = useParams<{ suiteId: string }>();
  const [suite, setSuite] = useState<SuiteRecord | null>(null);

  useEffect(() => {
    api<SuiteRecord>(`/suites/${suiteId}`).then(setSuite).catch(() => setSuite({ id: suiteId }));
  }, [suiteId]);

  return (
    <>
      <Loader done={!!suite} />
      {suite ? (
        <NavShell suiteId={suiteId}>
          <div className="topbar">
            <div>
              <div className="eyebrow">Create</div>
              <h1>New test</h1>
            </div>
          </div>
          <TestEditor suiteId={suiteId} suiteBrowserOptions={suite.browserOptions} />
        </NavShell>
      ) : null}
    </>
  );
}
