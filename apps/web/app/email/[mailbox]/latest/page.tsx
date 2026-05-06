import Link from "next/link";
import { API_BASE, formatDateTime } from "../../../../lib/api";

interface MailboxEmail {
  id: string;
  subject: string;
  from: string;
  to: string[];
  createdAt: string | null;
  snippet: string;
  html?: string | null;
  text?: string | null;
}

interface MailboxResult {
  mailbox: string;
  emailAddress: string;
  expiresAfterSeconds: number;
  messages: MailboxEmail[];
}

async function loadLatest(mailbox: string): Promise<MailboxResult> {
  const response = await fetch(`${API_BASE}/email/${encodeURIComponent(mailbox)}/latest`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Mailbox request failed: ${response.status}`);
  }
  return response.json() as Promise<MailboxResult>;
}

export default async function LatestEmailPage({ params }: { params: Promise<{ mailbox: string }> }) {
  const { mailbox } = await params;
  const inbox = await loadLatest(mailbox);
  const message = inbox.messages[0];

  return (
    <main className="email-service">
      <section className="email-header">
        <div>
          <div className="eyebrow">SentinelQA Email</div>
          <h1>{inbox.mailbox} latest</h1>
          <p>{inbox.emailAddress}</p>
        </div>
        <Link className="button secondary" href={`/email/${encodeURIComponent(inbox.mailbox)}`}>
          Inbox
        </Link>
      </section>
      <section className="panel grid">
        {message ? (
          <>
            <div>
              <div className="eyebrow">Subject</div>
              <h2>{message.subject || "(no subject)"}</h2>
            </div>
            <div className="grid three">
              <div><div className="eyebrow">From</div>{message.from || "-"}</div>
              <div><div className="eyebrow">To</div>{message.to.join(", ") || "-"}</div>
              <div><div className="eyebrow">Received</div>{formatDateTime(message.createdAt)}</div>
            </div>
            {message.html ? (
              <iframe className="email-preview" srcDoc={message.html} title="Latest email" />
            ) : (
              <pre className="email-text">{message.text || message.snippet || "No message body available."}</pre>
            )}
          </>
        ) : (
          <p>No messages have arrived for this mailbox.</p>
        )}
      </section>
    </main>
  );
}
