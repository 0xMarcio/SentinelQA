"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogIn } from "lucide-react";
import { api } from "../../lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function login() {
    setError(null);
    try {
      await api("/auth/dev-login", { method: "POST", body: "{}" });
      router.push("/");
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : String(loginError));
    }
  }

  return (
    <div className="login-screen">
      <div className="login-box grid">
        <div>
          <div className="eyebrow">Local session</div>
          <h1>SentinelQA</h1>
        </div>
        <button className="button" onClick={login}>
          <LogIn size={18} /> Dev login
        </button>
        {error ? <p style={{ color: "var(--red)" }}>{error}</p> : null}
      </div>
    </div>
  );
}

