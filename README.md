# maildigest

Tägliche E-Mail-Zusammenfassung per KI. Ruft E-Mails aus einem Gmail-Postfach ab, lässt sie von Claude (Haiku) zusammenfassen und verschickt das Ergebnis als HTML-E-Mail an eine Zieladresse.

## Voraussetzungen

- Node.js 25+
- Gmail-Account mit aktivierter 2-Faktor-Authentifizierung
- [Google App-Passwort](https://myaccount.google.com/apppasswords)
- [Anthropic API-Key](https://console.anthropic.com)

## Installation

```bash
git clone https://github.com/dein-name/maildigest.git
cd maildigest
npm install
```

## Konfiguration

`.env.example` kopieren und ausfüllen:

```bash
cp .env.example .env
```

| Variable            | Pflicht | Beschreibung                                                  |
|---------------------|---------|---------------------------------------------------------------|
| `GMAIL_USER`        | ✅      | Gmail-Adresse (Quelle)                                        |
| `GMAIL_APP_PW`      | ✅      | 16-stelliges App-Passwort (ohne Leerzeichen)                  |
| `TARGET_EMAIL`      | ✅      | Zieladresse für die Zusammenfassung                           |
| `ANTHROPIC_API_KEY` | ✅      | API-Key von console.anthropic.com                             |
| `DAYS_BACK`         | ❌      | Wie viele Tage zurückschauen (Standard: `1`)                  |
| `IMAP_FOLDER`       | ❌      | Gmail-Ordner (Standard: `INBOX`)                              |
| `MAX_EMAILS`        | ❌      | Max. E-Mails pro Lauf (Standard: `50`)                        |
| `STATE_FILE`        | ❌      | Pfad zur State-Datei (Standard: `./email_summary_state.json`) |

### App-Passwort erstellen

1. [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) öffnen
2. Namen vergeben (z.B. `maildigest`) → **Erstellen**
3. Das angezeigte 16-stellige Passwort in `.env` eintragen – Leerzeichen weglassen

## Ausführung

```bash
# Einmalig / manuell
npm start

# Typprüfung
npm run typecheck
```

## Automatische Ausführung per systemd-Timer

Zwei Unit-Dateien anlegen (Pfad anpassen):

**`~/.config/systemd/user/maildigest.service`**

```ini
[Unit]
Description=maildigest – tägliche E-Mail-Zusammenfassung
After=network-online.target

[Service]
Type=oneshot
WorkingDirectory=/pfad/zu/maildigest
ExecStart=node --env-file=.env email_summary.ts
StandardOutput=journal
StandardError=journal
```

**`~/.config/systemd/user/maildigest.timer`**

```ini
[Unit]
Description=maildigest täglich um 07:00 Uhr

[Timer]
OnCalendar=*-*-* 07:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

Timer aktivieren und starten:

```bash
systemctl --user daemon-reload
systemctl --user enable --now maildigest.timer
```

Status prüfen:

```bash
# Timer-Status und nächster Lauf
systemctl --user status maildigest.timer

# Logs
journalctl --user -u maildigest.service
```

`Persistent=true` sorgt dafür, dass ein verpasster Lauf (z.B. weil der Rechner ausgeschaltet war) beim nächsten Start nachgeholt wird.

## Kosten

maildigest verwendet Claude Haiku – das günstigste Modell der Claude-Familie. Bei 50 E-Mails täglich à ~500 Wörter entstehen Kosten im Cent-Bereich pro Monat.

## Hinweise

- **Datenschutz**: E-Mail-Inhalte werden an die Anthropic API übermittelt. Für vertrauliche oder berufliche Postfächer ist das Skript nicht geeignet.
- **Anhänge**: Werden nicht verarbeitet, nur Plaintext-Bodies.
- **Authentifizierung**: Ausschließlich per App-Passwort (kein OAuth2).
- **`.env` niemals committen**: Sicherstellen, dass `.env` in der `.gitignore` steht.

## Lizenz

MIT
