import { z } from "zod";

const messageAddressSchema = z.object({
  Name: z.string().optional().nullable(),
  Address: z.string().optional().nullable()
}).passthrough();

const mailpitMessageSchema = z.object({
  ID: z.string().optional(),
  id: z.string().optional(),
  Subject: z.string().optional().nullable(),
  subject: z.string().optional().nullable(),
  From: messageAddressSchema.optional().nullable(),
  To: z.array(messageAddressSchema).optional().nullable(),
  Cc: z.array(messageAddressSchema).optional().nullable(),
  Bcc: z.array(messageAddressSchema).optional().nullable(),
  Created: z.string().optional().nullable(),
  created: z.string().optional().nullable(),
  Size: z.number().optional().nullable(),
  size: z.number().optional().nullable(),
  Snippet: z.string().optional().nullable(),
  snippet: z.string().optional().nullable()
}).passthrough();

const mailpitSearchSchema = z.object({
  messages: z.array(mailpitMessageSchema).default([])
}).passthrough();

const mailpitDetailSchema = z
  .object({
    ID: z.string().optional(),
    id: z.string().optional(),
    Subject: z.string().optional().nullable(),
    subject: z.string().optional().nullable(),
    From: messageAddressSchema.optional().nullable(),
    To: z.array(messageAddressSchema).optional().nullable(),
    Cc: z.array(messageAddressSchema).optional().nullable(),
    Bcc: z.array(messageAddressSchema).optional().nullable(),
    Created: z.string().optional().nullable(),
    created: z.string().optional().nullable(),
    Date: z.string().optional().nullable(),
    date: z.string().optional().nullable(),
    Size: z.number().optional().nullable(),
    size: z.number().optional().nullable(),
    Snippet: z.string().optional().nullable(),
    snippet: z.string().optional().nullable(),
    Text: z.string().optional().nullable(),
    text: z.string().optional().nullable(),
    HTML: z.string().optional().nullable(),
    html: z.string().optional().nullable()
  })
  .passthrough();

export interface RunEmailSummary {
  id: string;
  subject: string;
  from: string;
  to: string[];
  createdAt: string | null;
  size: number | null;
  snippet: string;
}

export interface MailboxEmail extends RunEmailSummary {
  html?: string | null;
  text?: string | null;
}

export interface MailboxResult {
  mailbox: string;
  emailAddress: string;
  expiresAfterSeconds: number;
  messages: MailboxEmail[];
}

const mailboxNameSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9._+-]+$/);

export function emailAddressForRun(runId: string) {
  return `run-${runId}@sentinelqa.local`;
}

export function emailAddressForMailbox(mailbox: string) {
  return `${normalizeMailbox(mailbox)}@${emailInboxDomain()}`;
}

function normalizeMailbox(mailbox: string) {
  return mailboxNameSchema.parse(mailbox.trim().replace(/@.*/, ""));
}

function emailInboxDomain() {
  return process.env.EMAIL_INBOX_DOMAIN ?? "email.sentinelqa.local";
}

function retentionSeconds() {
  return Number(process.env.EMAIL_RETENTION_SECONDS ?? 3600);
}

function mailpitApiBase() {
  return process.env.MAILPIT_API_URL ?? "http://localhost:8025";
}

function formatAddress(value: z.infer<typeof messageAddressSchema> | null | undefined) {
  if (!value) return "";
  const address = value.Address ?? "";
  const name = value.Name ?? "";
  return name && address ? `${name} <${address}>` : address || name;
}

function messageCreatedAt(message: z.infer<typeof mailpitMessageSchema>) {
  return message.Created ?? message.created ?? null;
}

function isWithinRetention(createdAt: string | null) {
  if (!createdAt) return true;
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return true;
  return Date.now() - created <= retentionSeconds() * 1000;
}

function toSummary(message: z.infer<typeof mailpitMessageSchema>): RunEmailSummary {
  return {
    id: message.ID ?? message.id ?? "",
    subject: message.Subject ?? message.subject ?? "",
    from: formatAddress(message.From),
    to: [...(message.To ?? []), ...(message.Cc ?? []), ...(message.Bcc ?? [])].map(formatAddress).filter(Boolean),
    createdAt: messageCreatedAt(message),
    size: message.Size ?? message.size ?? null,
    snippet: message.Snippet ?? message.snippet ?? ""
  };
}

async function searchAddress(address: string) {
  const url = new URL("/api/v1/search", mailpitApiBase());
  url.searchParams.set("query", address);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Mailpit returned ${response.status}`);
  }
  return mailpitSearchSchema.parse(await response.json()).messages.filter((message) => isWithinRetention(messageCreatedAt(message)));
}

async function getMessageDetail(id: string): Promise<MailboxEmail | null> {
  if (!id) return null;
  const response = await fetch(new URL(`/api/v1/message/${encodeURIComponent(id)}`, mailpitApiBase()));
  if (!response.ok) return null;
  const message = mailpitDetailSchema.parse(await response.json());
  return {
    id: message.ID ?? message.id ?? id,
    subject: message.Subject ?? message.subject ?? "",
    from: formatAddress(message.From),
    to: [...(message.To ?? []), ...(message.Cc ?? []), ...(message.Bcc ?? [])].map(formatAddress).filter(Boolean),
    createdAt: message.Created ?? message.created ?? message.Date ?? message.date ?? null,
    size: message.Size ?? message.size ?? null,
    snippet: message.Snippet ?? message.snippet ?? "",
    text: message.Text ?? message.text ?? null,
    html: message.HTML ?? message.html ?? null
  };
}

export async function listRunEmails(runId: string): Promise<RunEmailSummary[]> {
  return searchAddress(emailAddressForRun(runId)).then((messages) => messages.map(toSummary));
}

export async function listMailboxEmails(mailbox: string): Promise<MailboxResult> {
  const normalized = normalizeMailbox(mailbox);
  const emailAddress = emailAddressForMailbox(normalized);
  const messages = (await searchAddress(emailAddress)).map(toSummary);
  return { mailbox: normalized, emailAddress, expiresAfterSeconds: retentionSeconds(), messages };
}

export async function getLatestMailboxEmail(mailbox: string): Promise<MailboxResult> {
  const inbox = await listMailboxEmails(mailbox);
  const latest = inbox.messages[0] ? await getMessageDetail(inbox.messages[0].id) : null;
  return { ...inbox, messages: latest ? [latest] : [] };
}
