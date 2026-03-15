import { ImapFlow } from "imapflow";
import PostalMime from "postal-mime";
import type { Email } from "postal-mime";
import { config, type EmailEntry } from "./config.ts";
import { log } from "./logger.ts";
import { smartTrim, formatAddress } from "./textUtils.ts";

export async function fetchEmails(sinceDate: Date): Promise<EmailEntry[]> {
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
    const uids = await client.search({ since: sinceDate }, { uid: true });

    if (!uids || uids.length === 0) {
      log.info("Keine E-Mails im Zeitraum gefunden.");
      return emails;
    }

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
          from: formatAddress(parsed.from?.name, parsed.from?.address),
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
