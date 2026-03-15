import { type DigestReport } from "./config.ts";

function escape(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildHtml(report: DigestReport, sinceDate: Date): string {
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
