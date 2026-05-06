import Link from "next/link";
import { API_BASE, formatDateTime } from "../../../lib/api";

interface MailboxEmail {
  id: string;
  subject: string;
  from: string;
  to: string[];
  createdAt: string | null;
  snippet: string;
}

interface MailboxResult {
  mailbox: string;
  emailAddress: string;
  expiresAfterSeconds: number;
  messages: MailboxEmail[];
}

async function loadMailbox(mailbox: string): Promise<MailboxResult> {
  const response = await fetch(`${API_BASE}/email/${encodeURIComponent(mailbox)}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Mailbox request failed: ${response.status}`);
  }
  return response.json() as Promise<MailboxResult>;
}

export default async function EmailInboxPage({ params }: { params: Promise<{ mailbox: string }> }) {
  const { mailbox } = await params;
  const inbox = await loadMailbox(mailbox);
  const minutes = Math.round(inbox.expiresAfterSeconds / 60);

  return (
    <main className="email-service">
      <section className="email-header">
        <div>
          <div className="eyebrow">SentinelQA Email</div>
          <h1>{inbox.mailbox}</h1>
          <p>{inbox.emailAddress}</p>
        </div>
        <Link className="button secondary" href={`/email/${encodeURIComponent(inbox.mailbox)}/latest`}>
          Latest message
        </Link>
      </section>
      <section className="panel grid">
        <div className="actions" style={{ justifyContent: "space-between" }}>
          <h2>Inbox</h2>
          <span className="muted">Messages are shown for {minutes} minutes.</span>
        </div>
        {inbox.messages.length ? (
          <table>
            <thead>
              <tr>
                <th>Subject</th>
                <th>From</th>
                <th>To</th>
                <th>Received</th>
              </tr>
            </thead>
            <tbody>
              {inbox.messages.map((message) => (
                <tr key={message.id || `${message.subject}-${message.createdAt}`}>
                  <td>{message.subject || "(no subject)"}{message.snippet ? <div className="muted">{message.snippet}</div> : null}</td>
                  <td>{message.from || "-"}</td>
                  <td>{message.to.join(", ") || "-"}</td>
                  <td>{formatDateTime(message.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>No messages have arrived for this mailbox.</p>
        )}
      </section>
    </main>
  );
}
