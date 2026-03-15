import Anthropic from "@anthropic-ai/sdk";
import { config, type EmailEntry, type DigestReport } from "./config.ts";
import { log } from "./logger.ts";

const SYSTEM_PROMPT = `Du bist ein persönlicher E-Mail-Assistent.
Analysiere die übergebenen E-Mails und antworte ausschließlich mit einem JSON-Objekt – ohne Codeblock, ohne Erklärungen.

Schema:
{
  "overview": "<qualitative Einordnung des gesamten Posteingangs in 2–3 Sätzen>",
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

Regeln für "overview":
- Der overview ist keine Aufzählung und keine Mengenangabe.
- Er soll den Posteingang qualitativ einordnen.
- Beschreibe das dominierende Muster der Mails: z. B. organisatorisch, operativ, informativ, abstimmungsorientiert, fragmentiert, dringend, routinemäßig oder entscheidungsbezogen.
- Benenne, welche Art von Aufmerksamkeit insgesamt gefragt ist.
- Verdichte die Gesamtlage, statt einzelne Mails nachzuerzählen.
- Vermeide leere Floskeln wie:
  - "Es gab mehrere E-Mails"
  - "Einige Mails erfordern Aufmerksamkeit"
  - "Die Mails behandeln verschiedene Themen"
  - "Es handelt sich um eine Mischung aus Informationen und Aufgaben"

Sei präzise, sachlich und konkret. Keine Füllsätze.
`;

export async function summarizeWithClaude(emails: EmailEntry[]): Promise<DigestReport> {
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
