# Sicherheitsmodell

Der Server ist für genau einen lokalen macOS-Benutzer ausgelegt. stdio vermeidet eine Netzwerk-Angriffsfläche des MCP-Servers; der Prozess hat jedoch dieselben Benutzerrechte wie Codex. Ein kompromittierter Prozess desselben Benutzers kann daher nicht vollständig isoliert werden.

## OWASP Top 10:2025

| Kategorie | Maßnahme und Nachweis |
|---|---|
| A01 Broken Access Control | Nur neun fest registrierte Lesewerkzeuge. Die Protokollschicht erlaubt sieben feste Lesetopics und verwirft ein `type`-Feld im Payload. Negative Tests prüfen fehlende Handelswerkzeuge und Topic-Überschreibung. |
| A02 Security Misconfiguration | Ausschließlich stdio, kein HTTP-Listener, keine Umgebungsvariablen mit Zugangsdaten, TLS-Prüfung durch Node, deaktivierte Redirects und WebSocket-Kompression. |
| A03 Software Supply Chain Failures | Exakte Versionen und Lockfile, deaktivierte npm-Installationsskripte, `npm audit`, Typecheck und Lint. Der Server lädt zur Laufzeit keinen Code nach. |
| A04 Cryptographic Failures | Sitzung ausschließlich im macOS-Schlüsselbund mit `AfterFirstUnlockThisDeviceOnly`; Geheimnisse gelangen per Pipe zum Helfer. HTTPS/WSS verwenden die Plattform-Zertifikatsprüfung. Keine Klartext-Ausweichspeicherung. |
| A05 Injection | Strikte Zod-Schemas, ISIN-Format, ausschließlich Börsenplatz LSX, begrenzte Suche. Keine Shellausführung mit Benutzereingaben, freie URLs oder freie Topics. Fremde Beschreibungen bleiben Daten. |
| A06 Insecure Design | Read-only ist eine Laufzeiteigenschaft, nicht nur eine Tool-Beschreibung. Authentifizierung, Schlüsselbund und Lesedaten sind getrennt; keine generische Proxyfunktion. Gleichzeitige Upstream-Anfragen sind auf drei begrenzt. |
| A07 Authentication Failures | PIN und Code werden einmalig verdeckt eingegeben, nicht gespeichert und nicht automatisch wiederholt. Unbekannte Auth-Aktionen brechen geschlossen ab. Jede Datenabfrage prüft und erneuert die gespeicherte Sitzung. Logout löscht sie. |
| A08 Software or Data Integrity Failures | API-Antworten werden vor Nutzung gegen begrenzte Schemas geprüft. Lockfile und exakte Abhängigkeiten schützen den Build; strukturierte Daten erweitern niemals Berechtigungen. |
| A09 Security Logging & Alerting Failures | stderr enthält Werkzeugname, Dauer und bereinigtes Ergebnis. Eingaben, Cookies, Sitzungen und Kontoantworten werden nie protokolliert. Da dies ein lokaler Einzelprozess ist, gibt es kein zentrales Alerting; Prozessfehler bleiben im lokalen Codex-Protokoll sichtbar. |
| A10 Mishandling of Exceptional Conditions | Größen- und Zeitlimits, geschlossene Fehlerpfade, begrenzte Parallelität und bereinigte Fehlermeldungen. Verbindungsfehler beenden die Anfrage und räumen den Socket auf; es gibt keine automatische Wiederholung mutierender Aktionen, weil solche Aktionen nicht existieren. |

## Meldung von Schwachstellen

Sicherheitsprobleme über GitHubs private Vulnerability-Reporting-Funktion melden. Keine Zugangsdaten oder Kontoauszüge in öffentliche Issues einfügen. Bitte die betroffene Version, eine minimale Reproduktion ohne echte Geheimnisse und die Auswirkung dokumentieren.

## Bekannte Grenzen

- Trade Republic bietet keine öffentliche API für diesen Zweck; Live-Kompatibilität ist erst nach einer persönlichen Anmeldung feststellbar.
- Die Read-only-Sperre stammt von diesem Server. Trade Republic stellt dafür keine nachgewiesenen eingeschränkten Zugangsdaten bereit.
- `get_orders` muss wegen variierender inoffizieller Antwortformen teilweise unbekannte Felder als Daten weiterreichen. Sie werden weder ausgeführt noch in Logs geschrieben und sind durch Anzahl und WebSocket-Größe begrenzt.
