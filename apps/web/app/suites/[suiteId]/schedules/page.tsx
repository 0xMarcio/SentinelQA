"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { NavShell } from "../../../../components/NavShell";
import { Status } from "../../../../components/Status";
import { api, formatDateTime } from "../../../../lib/api";

interface Schedule {
  id: string;
  name: string;
  active: boolean;
  intervalMinutes?: number | null;
  cron?: string | null;
  nextRunAt?: string | null;
}

export default function SchedulesPage() {
  const { suiteId } = useParams<{ suiteId: string }>();
  const router = useRouter();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [name, setName] = useState("Every 15 minutes");
  const [intervalMinutes, setIntervalMinutes] = useState(15);

  async function load() {
    setSchedules(await api<Schedule[]>(`/suites/${suiteId}/schedules`));
  }

  useEffect(() => {
    load().catch(() => router.push("/login"));
  }, [suiteId, router]);

  async function createSchedule() {
    await api(`/suites/${suiteId}/schedules`, {
      method: "POST",
      body: JSON.stringify({ name, intervalMinutes, active: true })
    });
    await load();
  }

  async function toggle(schedule: Schedule) {
    await api(`/schedules/${schedule.id}`, { method: "PUT", body: JSON.stringify({ active: !schedule.active }) });
    await load();
  }

  return (
    <NavShell suiteId={suiteId}>
      <div className="topbar">
        <div>
          <div className="eyebrow">Suite</div>
          <h1>Schedules</h1>
        </div>
      </div>
      <div className="grid two">
        <div className="table-panel">
          <table>
            <thead>
              <tr><th>Name</th><th>Cadence</th><th>Next</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {schedules.map((schedule) => (
                <tr key={schedule.id}>
                  <td>{schedule.name}</td>
                  <td>{schedule.cron ?? `${schedule.intervalMinutes} min`}</td>
                  <td>{formatDateTime(schedule.nextRunAt)}</td>
                  <td><Status value={schedule.active ? "active" : "paused"} /></td>
                  <td><button className="button secondary" onClick={() => toggle(schedule)}>{schedule.active ? "Pause" : "Resume"}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel grid">
          <h2>Create schedule</h2>
          <div className="field"><label>Name</label><input value={name} onChange={(event) => setName(event.target.value)} /></div>
          <div className="field"><label>Interval minutes</label><input type="number" min="1" value={intervalMinutes} onChange={(event) => setIntervalMinutes(Number(event.target.value))} /></div>
          <button className="button" onClick={createSchedule}><Plus size={16} /> Create</button>
        </div>
      </div>
    </NavShell>
  );
}
