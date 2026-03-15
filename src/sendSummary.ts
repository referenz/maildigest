import * as nodemailer from "nodemailer";
import { config } from "./config.ts";
import { log } from "./logger.ts";

export async function sendSummary(htmlBody: string, sinceDate: Date): Promise<void> {
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
