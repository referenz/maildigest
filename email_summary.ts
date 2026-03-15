#!/usr/bin/env node
/**
 * email_summary.ts
 * Ruft Gmail-E-Mails seit einem Stichtag ab, lässt sie per Claude zusammenfassen
 * und sendet die Zusammenfassung an eine Zieladresse.
 *
 * Konfiguration: .env-Datei im gleichen Verzeichnis (siehe .env.example)
 * Ausführung:    node --env-file=.env email_summary.ts
 */

import { config } from "./src/config.ts";
import { log } from "./src/logger.ts";
import { loadState, saveState } from "./src/state.ts";
import { fetchEmails } from "./src/fetchEmails.ts";
import { summarizeWithClaude } from "./src/summarize.ts";
import { buildHtml } from "./src/buildHtml.ts";
import { sendSummary } from "./src/sendSummary.ts";

async function main(): Promise<void> {
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
