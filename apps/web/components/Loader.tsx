"use client";

import { useEffect, useState } from "react";

export function Loader({ done = false }: { done?: boolean }) {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setHidden(true), 320);
    return () => clearTimeout(timer);
  }, [done]);

  if (hidden) return null;

  return (
    <div className={done ? "loader loader-done" : "loader"} aria-hidden={done} role="status">
      <svg className="loader-spinner" viewBox="0 0 50 50" aria-label="Loading">
        <circle cx="25" cy="25" r="20" />
      </svg>
    </div>
  );
}
