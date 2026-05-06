"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { TestDsl } from "@sentinelqa/dsl";
import { NavShell } from "../../../../components/NavShell";
import { TestEditor } from "../../../../components/TestEditor";
import { api } from "../../../../lib/api";

interface TestRecord {
  id: string;
  suite: { id: string; projectId: string };
  versions: Array<{ dsl: TestDsl }>;
}

export default function EditTestPage() {
  const { testId } = useParams<{ testId: string }>();
  const router = useRouter();
  const [test, setTest] = useState<TestRecord | null>(null);

  useEffect(() => {
    api<TestRecord>(`/tests/${testId}`).then(setTest).catch(() => router.push("/login"));
  }, [testId, router]);

  if (!test) return <div className="workspace">Loading</div>;
  return (
    <NavShell projectId={test.suite.projectId} suiteId={test.suite.id}>
      <div className="topbar">
        <div>
          <div className="eyebrow">Edit</div>
          <h1>Test editor</h1>
        </div>
      </div>
      <TestEditor testId={test.id} initial={test.versions[0]?.dsl} />
    </NavShell>
  );
}

