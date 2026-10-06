# Trade Republic MCP (read-only)

[![CI](https://github.com/mattiad19/trade-republic-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/mattiad19/trade-republic-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Lokaler MCP-Server für lesenden Zugriff auf Trade Republic. Er verwendet eine inoffizielle, nicht dokumentierte API und ist weder mit Trade Republic verbunden noch von Trade Republic unterstützt. Änderungen der API können die Anmeldung oder Datenabfragen jederzeit brechen. Die Nutzung kann gegen Vertragsbedingungen von Trade Republic verstoßen.

Der Server kann Depot, Guthaben, bestehende Orders, Wertpapierdetails und Marktdaten lesen. Er besitzt keine Werkzeuge für Käufe, Verkäufe, Stornierungen, Überweisungen oder Sparplanänderungen. Diese Beschränkung wird in der Laufzeit durch eine feste Topic-Allowlist erzwungen.

## Voraussetzungen und Installation

- macOS mit entsperrbarem Schlüsselbund und Xcode Command Line Tools
- Node.js 22 oder neuer

```sh
git clone https://github.com/mattiad19/trade-republic-mcp.git
cd trade-republic-mcp
npm install
npm run check
```

`npm install` führt wegen `.npmrc` keine Installationsskripte von Abhängigkeiten aus. `npm run build` kompiliert ausschließlich den lokalen Swift-Schlüsselbund-Helfer und TypeScript-Code.

## Lokale Anmeldung

```sh
node dist/src/cli.js auth login
node dist/src/cli.js auth status
node dist/src/cli.js auth logout
```

Telefonnummer, PIN und Authenticator-Code werden im Terminal abgefragt. PIN und Code erscheinen nicht auf dem Bildschirm und werden nicht gespeichert. Nur die Cookie-Sitzung liegt als generisches Passwort im macOS-Schlüsselbund unter dem Dienst `de.local.trade-republic-mcp`.

## Codex-Registrierung

```sh
codex mcp add trade-republic -- node "/ABSOLUTER/PFAD/dist/src/server.js"
```

Die Konfiguration enthält keine Zugangsdaten. Der MCP-Server kommuniziert über stdio und öffnet keinen Port. Diagnoseprotokolle gehen ausschließlich nach stderr und enthalten weder Tool-Eingaben noch Kontoantworten.

## Verfügbare Werkzeuge

`get_auth_status`, `get_portfolio`, `get_cash_balance`, `get_orders`, `search_assets`, `get_asset_info`, `get_price`, `get_price_history` und `get_order_book`.

`get_order_book` liefert nur das beste Geld- und Briefangebot. Quellzeitpunkt und lokaler Abrufzeitpunkt werden getrennt ausgegeben. Ein vorhandener Geldkurs wird nicht als Beweis für einen geöffneten Markt interpretiert.

Weitere Sicherheitsdetails und bekannte Grenzen stehen in [SECURITY.md](SECURITY.md).
