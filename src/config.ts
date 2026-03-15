import * as os from "os";
import * as path from "path";

export const config = {
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
    : path.join(path.dirname(new URL(import.meta.url).pathname), "..", "email_summary_state.json"),
};

export interface EmailEntry {
  uid: string;
  from: string;
  subject: string;
  date: string;
  body: string;
}

export interface State {
  lastRun?: string;
  lastEmailCount?: number;
}

export interface EmailSummary {
  from: string;
  subject: string;
  summary: string;
  action: string | null;
}

export interface DigestReport {
  overview: string;
  emails: EmailSummary[];
  actionItems: string[];
}
