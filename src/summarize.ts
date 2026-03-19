import Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
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
- Der Überblick soll eine interpretierende Verdichtung sein, keine neutrale Wiederholung.
- Vermeide leere Floskeln wie:
  - "Es gab mehrere E-Mails"
  - "Einige Mails erfordern Aufmerksamkeit"
  - "Die Mails behandeln verschiedene Themen"
  - "Es handelt sich um eine Mischung aus Informationen und Aufgaben"

Sei präzise, sachlich und konkret. Keine Füllsätze.
`;

const DIGEST_REPORT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["overview", "emails", "actionItems"],
  properties: {
    overview: { type: "string" },
    emails: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["from", "subject", "summary", "action"],
        properties: {
          from: { type: "string" },
          subject: { type: "string" },
          summary: { type: "string" },
          action: { type: ["string", "null"] },
        },
      },
    },
    actionItems: {
      type: "array",
      items: { type: "string" },
    },
  },
} as const;

function isDigestReport(value: unknown): value is DigestReport {
  if (typeof value !== "object" || value === null) return false;

  const report = value as Record<string, unknown>;
  if (typeof report.overview !== "string") return false;
  if (!Array.isArray(report.emails) || !Array.isArray(report.actionItems)) return false;

  return (
    report.emails.every((entry) => {
      if (typeof entry !== "object" || entry === null) return false;
      const email = entry as Record<string, unknown>;
      return (
        typeof email.from === "string" &&
        typeof email.subject === "string" &&
        typeof email.summary === "string" &&
        (typeof email.action === "string" || email.action === null)
      );
    }) && report.actionItems.every((item) => typeof item === "string")
  );
}

function extractFirstJsonObject(text: string): string | null {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (start === -1) {
      if (char === "{") {
        start = i;
        depth = 1;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
      if (depth < 0) {
        start = -1;
        depth = 0;
      }
    }
  }

  return null;
}

function parseDigestReport(rawText: string): DigestReport {
  const normalized = rawText
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  const candidates = [normalized, extractFirstJsonObject(normalized)].filter(
    (candidate): candidate is string => typeof candidate === "string" && candidate.length > 0,
  );

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (isDigestReport(parsed)) return parsed;
    } catch {
      continue;
    }
  }

  throw new Error(`Claude hat kein gültiges JSON zurückgegeben:\n${rawText}`);
}

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

  const response = await client.messages.parse({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: emailText }],
    output_config: {
      format: jsonSchemaOutputFormat(DIGEST_REPORT_SCHEMA),
    },
  });

  if (response.parsed_output && isDigestReport(response.parsed_output)) {
    return response.parsed_output;
  }

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock) throw new Error("Unerwarteter Response-Typ von Claude.");

  return parseDigestReport(textBlock.text);
}
