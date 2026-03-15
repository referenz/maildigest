#!/usr/bin/env node
/**
 * email_summary.ts
 * Ruft Gmail-E-Mails seit einem Stichtag ab, lässt sie per Claude zusammenfassen
 * und sendet die Zusammenfassung an eine Zieladresse.
 *
 * Konfiguration: .env-Datei im gleichen Verzeichnis (siehe .env.example)
 * Ausführung:    node --env-file=.env email_summary.ts
 */

import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import PostalMime from "postal-mime";
import type { Email } from "postal-mime";

// ---------------------------------------------------------------------------
// Konfiguration
// ---------------------------------------------------------------------------

const config = {
  gmail: {
    user: process.env.GMAIL_USER ?? "",
    appPassword: process.env.GMAIL_APP_PW ?? "",
  },
  target: {
    email: process.env.TARGET_EMAIL ?? "",
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY ?? "",
  },
  daysBack: parseInt(process.env.DAYS_BACK ?? "1", 10),
  imapFolder: process.env.IMAP_FOLDER ?? "INBOX",
  maxEmails: parseInt(process.env.MAX_EMAILS ?? "50", 10),
  stateFile: process.env.STATE_FILE
    ? path.resolve(process.env.STATE_FILE.replace("~", os.homedir()))
    : path.join(path.dirname(new URL(import.meta.url).pathname), "email_summary_state.json"),
};

// ---------------------------------------------------------------------------
// Typen
// ---------------------------------------------------------------------------

interface EmailEntry {
  uid: string;
  from: string;
  subject: string;
  date: string;
  body: string;
}

interface State {
  lastRun?: string;
  lastEmailCount?: number;
}

interface EmailSummary {
  from: string;
  subject: string;
  summary: string;
  action: string | null;
}

interface DigestReport {
  overview: string;
  emails: EmailSummary[];
  actionItems: string[];
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString().replace("T", " ").substring(0, 19);
}

const log = {
  info: (msg: string) => console.log(`${timestamp()} [INFO]  ${msg}`),
  error: (msg: string) => console.error(`${timestamp()} [ERROR] ${msg}`),
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

function loadState(): State {
  try {
    if (fs.existsSync(config.stateFile)) {
      return JSON.parse(fs.readFileSync(config.stateFile, "utf-8"));
    }
  } catch {}
  return {};
}

function saveState(state: State): void {
  fs.writeFileSync(config.stateFile, JSON.stringify(state, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// Smart-Trim: HTML bereinigen und Whitespace normalisieren
// ---------------------------------------------------------------------------

function smartTrim(raw: string, maxLen: number): string {
  let text = raw;

  // HTML-Tags: Block-Elemente durch Zeilenumbrüche ersetzen, Rest entfernen
  if (/<[a-z][\s\S]*>/i.test(text)) {
    text = text.replace(/<(br|p|div|li|tr|h[1-6])[^>]*\/?>/gi, "\n").replace(/<[^>]+>/g, " ");
  }

  // HTML-Entities dekodieren
  text = text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#\d+;/g, " ");

  // Whitespace normalisieren
  text = text
    .replace(/[^\S\n]+/g, " ") // mehrfache Leerzeichen → eines
    .replace(/\n{3,}/g, "\n\n") // mehr als 2 Zeilenumbrüche → 2
    .trim();

  return text.substring(0, maxLen);
}

// ---------------------------------------------------------------------------
// Schritt 1: E-Mails abrufen
// ---------------------------------------------------------------------------

async function fetchEmails(sinceDate: Date): Promise<EmailEntry[]> {
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: {
      user: config.gmail.user,
      pass: config.gmail.appPassword,
    },
    logger: false,
  });

  const emails: EmailEntry[] = [];

  await client.connect();

  const lock = await client.getMailboxLock(config.imapFolder);
  try {
    // IMAP-Suche nach E-Mails seit sinceDate
    const uids = await client.search({ since: sinceDate }, { uid: true });

    if (!uids || uids.length === 0) {
      log.info("Keine E-Mails im Zeitraum gefunden.");
      return emails;
    }

    // Auf MAX_EMAILS begrenzen (neueste zuerst)
    const limited = uids.slice(-config.maxEmails);
    log.info(`${uids.length} E-Mail(s) gefunden, verarbeite ${limited.length}.`);

    for await (const msg of client.fetch(limited, { source: true }, { uid: true })) {
      try {
        if (!msg.source) {
          log.error(`UID ${msg.uid}: kein Quelltext verfügbar, übersprungen.`);
          continue;
        }
        const parsed: Email = await PostalMime.parse(msg.source);
        emails.push({
          uid: String(msg.uid),
          from: parsed.from?.address ?? parsed.from?.name ?? "",
          subject: parsed.subject ?? "(kein Betreff)",
          date: parsed.date ?? "",
          body: smartTrim(parsed.text || parsed.html || "", 3000),
        });
      } catch (e) {
        log.error(`Fehler beim Parsen von UID ${msg.uid}: ${e}`);
      }
    }
  } finally {
    lock.release();
    await client.logout();
  }

  return emails;
}

// ---------------------------------------------------------------------------
// Schritt 2: LLM-Auswertung
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `Du bist ein persönlicher E-Mail-Assistent.
Analysiere die übergebenen E-Mails und antworte ausschließlich mit einem JSON-Objekt – ohne Codeblock, ohne Erklärungen.

Schema:
{
  "overview": "<Gesamtübersicht in 2–3 Sätzen>",
  "emails": [
    {
      "from": "<Absender>",
      "subject": "<Betreff>",
      "summary": "<Inhaltsangabe in 1–3 Sätzen>",
      "action": "<erforderliche Aktion oder null>"
    }
  ],
  "actionItems": ["<Aktion 1>", "<Aktion 2>"]
}

Sei präzise und sachlich. Keine Füllsätze.`;

async function summarizeWithClaude(emails: EmailEntry[]): Promise<DigestReport> {
  if (emails.length === 0) {
    return {
      overview: "Keine neuen E-Mails im ausgewerteten Zeitraum.",
      emails: [],
      actionItems: [],
    };
  }

  const emailText = emails
    .map(
      (m, i) => `
--- E-Mail ${i + 1} ---
Von:      ${m.from}
Betreff:  ${m.subject}
Datum:    ${m.date}
Inhalt:
${m.body}`,
    )
    .join("\n");

  log.info(`Sende ${emails.length} E-Mail(s) an Claude zur Auswertung...`);

  const client = new Anthropic({ apiKey: config.anthropic.apiKey });

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: emailText }],
  });

  const block = response.content[0];
  if (block.type !== "text") throw new Error("Unerwarteter Response-Typ von Claude.");

  try {
    const clean = block.text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();
    return JSON.parse(clean) as DigestReport;
  } catch {
    throw new Error(`Claude hat kein gültiges JSON zurückgegeben:\n${block.text}`);
  }
}

// ---------------------------------------------------------------------------
// Schritt 2b: HTML aus DigestReport erzeugen
// ---------------------------------------------------------------------------

function escape(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildHtml(report: DigestReport, sinceDate: Date): string {
  const dateLabel = sinceDate.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  const emailCards = report.emails
    .map(
      (m) => `
    <div style="background:#fff;border:1px solid #e8e8e8;border-radius:8px;padding:14px 16px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:4px;margin-bottom:6px">
        <span style="font-size:0.78em;color:#888;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:260px">${escape(m.from)}</span>
      </div>
      <div style="font-weight:600;font-size:0.95em;color:#111;margin-bottom:5px">${escape(m.subject)}</div>
      <div style="font-size:0.88em;color:#444;line-height:1.5">${escape(m.summary)}</div>
      ${m.action ? `<div style="margin-top:8px;padding:6px 10px;background:#fff8f0;border-left:3px solid #e07b00;border-radius:0 4px 4px 0;font-size:0.82em;color:#b85c00">⚡ ${escape(m.action)}</div>` : ""}
    </div>`,
    )
    .join("");

  const actionItems =
    report.actionItems.length > 0
      ? report.actionItems
          .map(
            (a) => `
      <div style="display:flex;align-items:baseline;gap:8px;padding:7px 0;border-bottom:1px solid #fde68a;font-size:0.88em;color:#333">
        <span style="color:#d97706;flex-shrink:0;font-weight:700">→</span>
        <span>${escape(a)}</span>
      </div>`,
          )
          .join("")
      : `<div style="font-size:0.88em;color:#888;padding:6px 0">Keine Aktionen erforderlich.</div>`;

  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>E-Mail-Digest ${dateLabel}</title>
  <style>
    @media (max-width:600px) {
      .wrapper { padding: 12px !important; }
      .card    { padding: 12px 14px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#222">

  <div class="wrapper" style="max-width:640px;margin:0 auto;padding:24px 16px">

    <!-- Header -->
    <div style="background:#18181b;border-radius:10px;padding:20px 24px;margin-bottom:16px;color:#fff">
      <div style="font-size:0.75em;color:#a1a1aa;letter-spacing:0.05em;text-transform:uppercase;margin-bottom:4px">Maildigest</div>
      <div style="font-size:1.2em;font-weight:700">${dateLabel}</div>
      <div style="margin-top:12px;font-size:0.9em;color:#d4d4d8;line-height:1.6">${escape(report.overview)}</div>
    </div>

    <!-- E-Mails -->
    <div style="font-size:0.75em;color:#71717a;letter-spacing:0.05em;text-transform:uppercase;margin-bottom:8px;padding-left:2px">
      E-Mails · ${report.emails.length}
    </div>
    ${emailCards}

    <!-- Aktionen -->
    ${
      report.actionItems.length > 0
        ? `
    <div style="background:#fffbeb;border:1px solid #fbbf24;border-radius:8px;padding:16px 18px;margin-top:16px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
        <span style="font-size:1em">⚡</span>
        <span style="font-size:0.75em;font-weight:700;color:#92400e;letter-spacing:0.06em;text-transform:uppercase">Offene Aktionen</span>
        <span style="margin-left:auto;background:#f59e0b;color:#fff;font-size:0.72em;font-weight:700;padding:2px 8px;border-radius:999px">${report.actionItems.length}</span>
      </div>
      ${actionItems}
    </div>`
        : ""
    }

    <!-- Footer -->
    <div style="text-align:center;font-size:0.75em;color:#a1a1aa;margin-top:20px;padding-bottom:8px">
      Erstellt von maildigest · ${new Date().toLocaleString("de-DE")}
    </div>

  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Schritt 3: Zusammenfassung versenden
// ---------------------------------------------------------------------------

async function sendSummary(htmlBody: string, sinceDate: Date): Promise<void> {
  const dateLabel = sinceDate.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user: config.gmail.user,
      pass: config.gmail.appPassword,
    },
  });

  await transporter.sendMail({
    from: config.gmail.user,
    to: config.target.email,
    subject: `E-Mail-Zusammenfassung seit ${dateLabel}`,
    text: "Bitte öffne diese E-Mail in einem HTML-fähigen Client.",
    html: htmlBody,
  });

  log.info(`Zusammenfassung erfolgreich an ${config.target.email} gesendet.`);
}

// ---------------------------------------------------------------------------
// Hauptprogramm
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Pflichtfelder prüfen
  const required: [string, string][] = [
    ["GMAIL_USER", config.gmail.user],
    ["GMAIL_APP_PW", config.gmail.appPassword],
    ["TARGET_EMAIL", config.target.email],
    ["ANTHROPIC_API_KEY", config.anthropic.apiKey],
  ];
  for (const [name, value] of required) {
    if (!value) throw new Error(`Umgebungsvariable ${name} fehlt. Bitte .env prüfen.`);
  }

  const sinceDate = new Date(Date.now() - config.daysBack * 24 * 60 * 60 * 1000);
  log.info(`Verarbeite E-Mails seit: ${sinceDate.toISOString().substring(0, 10)}`);

  const state = loadState();
  state.lastRun = new Date().toISOString();

  const emails = await fetchEmails(sinceDate);
  const report = await summarizeWithClaude(emails);
  const html = buildHtml(report, sinceDate);
  await sendSummary(html, sinceDate);

  state.lastEmailCount = emails.length;
  saveState(state);
  log.info("Fertig.");
}

main().catch((err) => {
  log.error(String(err));
  process.exit(1);
});
