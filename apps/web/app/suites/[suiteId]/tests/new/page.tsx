"use client";

import { useParams } from "next/navigation";
import { NavShell } from "../../../../../components/NavShell";
import { TestEditor } from "../../../../../components/TestEditor";

export default function NewTestPage() {
  const { suiteId } = useParams<{ suiteId: string }>();
  return (
    <NavShell suiteId={suiteId}>
      <div className="topbar">
        <div>
          <div className="eyebrow">Create</div>
          <h1>New test</h1>
        </div>
      </div>
      <TestEditor suiteId={suiteId} />
    </NavShell>
  );
}

