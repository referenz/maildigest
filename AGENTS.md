# AGENTS.md

Dieses Dokument beschreibt das Projekt für KI-Assistenten (Claude Code, Copilot, Cursor etc.).

## Projektübersicht

**maildigest** ist ein TypeScript-Skript, das automatisiert:

1. E-Mails aus einem Gmail-Postfach per IMAP abruft
2. Die E-Mails per Anthropic Claude (Haiku) zusammenfasst
3. Die Zusammenfassung als HTML-E-Mail an eine Zieladresse versendet

Gedacht als täglicher Cron-Job auf einem Linux-System.

## Stack

- **Laufzeit**: Node.js 25+ (natives TypeScript via Type Stripping, kein Transpilationsschritt)
- **Sprache**: TypeScript (strict mode)
- **Modulformat**: ESM (`"type": "module"`)
- **LLM**: Anthropic Claude Haiku (`claude-haiku-4-5-20251001`)
- **Konfiguration**: `.env`-Datei, geladen via `node --env-file=.env`

## Projektstruktur

```
maildigest/
├── email_summary.ts   # Hauptskript (einzige Quelldatei)
├── package.json
├── tsconfig.json      # Nur für Typprüfung (noEmit: true), kein Build-Schritt
├── .env               # Nicht im Repository – siehe .env.example
├── .env.example       # Vorlage für Umgebungsvariablen
├── AGENTS.md          # Diese Datei
└── README.md
```

## Umgebungsvariablen

| Variable          | Pflicht | Beschreibung                                      |
|-------------------|---------|---------------------------------------------------|
| `GMAIL_USER`      | ✅      | Gmail-Adresse (Quelle)                            |
| `GMAIL_APP_PW`    | ✅      | 16-stelliges Google App-Passwort (ohne Leerzeichen)|
| `TARGET_EMAIL`    | ✅      | Zieladresse für die Zusammenfassung               |
| `ANTHROPIC_API_KEY` | ✅   | API-Key von console.anthropic.com                 |
| `DAYS_BACK`       | ❌      | Wie viele Tage zurückschauen (Standard: `1`)      |
| `IMAP_FOLDER`     | ❌      | Gmail-Ordner (Standard: `INBOX`)                  |
| `MAX_EMAILS`      | ❌      | Max. E-Mails pro Lauf (Standard: `50`)            |
| `STATE_FILE`      | ❌      | Pfad zur State-Datei (Standard: `~/.email_summary_state.json`) |

## Skript ausführen

```bash
# Einmalig / manuell
node --env-file=.env email_summary.ts

# Via npm
npm start

# Typprüfung
npm run typecheck
```

## Automatische Ausführung (systemd-Timer)

Ausführung täglich um 07:00 Uhr via systemd User-Timer (`~/.config/systemd/user/`):

- `maildigest.service` – `Type=oneshot`, `WorkingDirectory` auf das Projektverzeichnis setzen
- `maildigest.timer` – `OnCalendar=*-*-* 07:00:00`, `Persistent=true`

Aktivieren: `systemctl --user enable --now maildigest.timer`
Logs: `journalctl --user -u maildigest.service`

## Abhängigkeiten

| Paket               | Zweck                        |
|---------------------|------------------------------|
| `@anthropic-ai/sdk` | Claude API                   |
| `imap`              | IMAP-Verbindung zu Gmail     |
| `mailparser`        | Parsen von RFC822-Nachrichten|
| `nodemailer`        | SMTP-Versand via Gmail       |

`dotenv`, `ts-node` und `tsx` werden **nicht** benötigt – Node 25 übernimmt diese Aufgaben nativ.

## Wichtige Designentscheidungen

- **Kein Build-Schritt**: Node 25 führt `.ts`-Dateien direkt aus (Type Stripping via amaro). `tsc` wird nur zur Typprüfung verwendet (`noEmit: true`).
- **Kein dotenv**: Umgebungsvariablen werden nativ über `--env-file` geladen.
- **Body-Limit**: E-Mail-Bodies werden auf 3.000 Zeichen gekürzt (Kostenkontrolle).
- **Modellwahl**: Claude Haiku statt Sonnet – für reine Zusammenfassungsaufgaben ausreichend und deutlich günstiger.
- **State-Datei**: Speichert Zeitstempel und E-Mail-Anzahl des letzten Laufs unter `./email_summary_state.json`. Aktuell informativ; kann für UID-Tracking zur Duplikatvermeidung erweitert werden.

## Bekannte Einschränkungen

- Unterstützt nur Gmail (IMAP `imap.gmail.com`) als Quelle
- Anhänge werden nicht verarbeitet, nur Plaintext-Bodies
- Authentifizierung per App-Passwort (kein OAuth2)
