"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogIn } from "lucide-react";
import { api } from "../../lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function login() {
    setError(null);
    setBusy(true);
    try {
      await api("/auth/dev-login", { method: "POST", body: "{}" });
      router.push("/");
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : String(loginError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-box grid">
        <div>
          <div className="eyebrow">Local session</div>
          <h1>SentinelQA</h1>
        </div>
        <button className="button" onClick={login} disabled={busy}>
          <LogIn size={16} /> {busy ? "Signing in" : "Dev login"}
        </button>
        {error ? <p className="form-error">{error}</p> : null}
      </div>
    </div>
  );
}
