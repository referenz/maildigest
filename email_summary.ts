#!/usr/bin/env node
/**
 * email_summary.ts
 * Ruft Gmail-E-Mails seit einem Stichtag ab, lässt sie per Claude zusammenfassen
 * und sendet die Zusammenfassung an eine Zieladresse.
 *
 * Konfiguration: .env-Datei im gleichen Verzeichnis (siehe .env.example)
 * Ausführung:    node --env-file=.env email_summary.ts
 * Cron (tägl.):  0 7 * * * cd /pfad/zum/projekt && node --env-file=.env email_summary.ts
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
    : path.join(
        path.dirname(new URL(import.meta.url).pathname),
        "email_summary_state.json",
      ),
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
    log.info(
      `${uids.length} E-Mail(s) gefunden, verarbeite ${limited.length}.`,
    );

    for await (const msg of client.fetch(
      limited,
      { source: true },
      { uid: true },
    )) {
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
          body: (parsed.text ?? "").substring(0, 3000),
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
Du bekommst eine Liste von E-Mails und erstellst daraus eine übersichtliche deutsche Zusammenfassung.

Struktur der Ausgabe (HTML):
1. Kurze Gesamtübersicht (2–3 Sätze)
2. Für jede E-Mail: Absender, Betreff, kurze Inhaltsangabe (1–3 Sätze), ggf. erforderliche Aktion
3. Abschluss: Liste aller Punkte, die eine Reaktion erfordern

Sei präzise und sachlich. Keine Füllsätze.`;

async function summarizeWithClaude(emails: EmailEntry[]): Promise<string> {
  if (emails.length === 0) {
    return "<p>Keine neuen E-Mails im ausgewerteten Zeitraum.</p>";
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
    max_tokens: 8096,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: emailText }],
  });

  const block = response.content[0];
  if (block.type !== "text")
    throw new Error("Unerwarteter Response-Typ von Claude.");
  return block.text;
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
    if (!value)
      throw new Error(`Umgebungsvariable ${name} fehlt. Bitte .env prüfen.`);
  }

  const sinceDate = new Date(
    Date.now() - config.daysBack * 24 * 60 * 60 * 1000,
  );
  log.info(
    `Verarbeite E-Mails seit: ${sinceDate.toISOString().substring(0, 10)}`,
  );

  const state = loadState();
  state.lastRun = new Date().toISOString();

  const emails = await fetchEmails(sinceDate);
  const summary = await summarizeWithClaude(emails);
  await sendSummary(summary, sinceDate);

  state.lastEmailCount = emails.length;
  saveState(state);
  log.info("Fertig.");
}

main().catch((err) => {
  log.error(String(err));
  process.exit(1);
});
