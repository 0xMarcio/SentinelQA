import { StatusBadge } from "@sentinelqa/ui";

export function Status({ value }: { value?: string | null }) {
  return <StatusBadge status={value ?? "unknown"} />;
}

