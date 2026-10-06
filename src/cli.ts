#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { WebAuthClient, authStatus, deleteSession } from './auth.js';
import { publicError, SafeError } from './errors.js';

async function promptVisible(question: string): Promise<string> {
  const readline = createInterface({ input: stdin, output: stdout });
  try { return (await readline.question(question)).trim(); } finally { readline.close(); }
}

async function promptSecret(question: string): Promise<string> {
  if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== 'function') {
    throw new SafeError('TTY_REQUIRED', 'Geheime Eingaben benötigen ein interaktives Terminal.');
  }
  stdout.write(question);
  stdin.setRawMode(true);
  stdin.resume();
  let value = '';
  try {
    for await (const chunk of stdin as AsyncIterable<Buffer>) {
      const text = chunk.toString('utf8');
      for (const character of text) {
        if (character === '\u0003') throw new SafeError('CANCELLED', 'Anmeldung abgebrochen.');
        if (character === '\r' || character === '\n') { stdout.write('\n'); return value; }
        if (character === '\u007f') value = value.slice(0, -1);
        else if (character >= ' ' && value.length < 128) value += character;
      }
    }
    throw new SafeError('INPUT_CLOSED', 'Eingabe wurde geschlossen.');
  } finally {
    stdin.setRawMode(false);
    stdin.pause();
  }
}

async function login(): Promise<void> {
  const phoneNumber = await promptVisible('Trade-Republic-Telefonnummer (z. B. +49170…): ');
  if (!/^\+[1-9]\d{7,14}$/.test(phoneNumber)) throw new SafeError('INVALID_PHONE', 'Ungültige Telefonnummer im internationalen Format.');
  const pin = await promptSecret('PIN (wird nicht gespeichert): ');
  if (!/^\d{4,8}$/.test(pin)) throw new SafeError('INVALID_PIN', 'Die PIN hat ein ungültiges Format.');
  const client = new WebAuthClient();
  const flow = await client.begin(phoneNumber, pin);
  if (flow.requiredAction === 'AUTHENTICATOR_VERIFICATION') {
    const code = await promptSecret('Authenticator-Code (wird nicht gespeichert): ');
    await client.submitAuthenticator(flow.processId, code);
  } else if (flow.requiredAction === undefined || flow.requiredAction === 'APP_CONFIRMATION') {
    stdout.write('Bitte die Anmeldung jetzt in der Trade-Republic-App bestätigen.\n');
    while (Date.now() < flow.expiresAt) {
      const process = await client.getProcess(flow.processId);
      if (process.status === 'CONFIRMED' || process.status === 'COMPLETED') break;
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    if (Date.now() >= flow.expiresAt) throw new SafeError('LOGIN_TIMEOUT', 'Die Bestätigung ist abgelaufen.');
  } else {
    throw new SafeError('LOGIN_CHANGED', `Unbekannte erforderliche Anmeldeaktion: ${flow.requiredAction}`);
  }
  await client.persist();
  stdout.write('Anmeldung gespeichert. PIN und Bestätigungscode wurden nicht gespeichert.\n');
}

async function main(): Promise<void> {
  const [group, command] = process.argv.slice(2);
  if (group !== 'auth' || !command) throw new SafeError('USAGE', 'Verwendung: trade-republic-auth auth <login|status|logout>');
  if (command === 'login') await login();
  else if (command === 'status') stdout.write(`${JSON.stringify(await authStatus(), null, 2)}\n`);
  else if (command === 'logout') { await deleteSession(); stdout.write('Lokale Sitzung aus dem Schlüsselbund entfernt.\n'); }
  else throw new SafeError('USAGE', 'Verwendung: trade-republic-auth auth <login|status|logout>');
}

main().catch((error: unknown) => {
  const safe = publicError(error);
  process.stderr.write(`${safe.code}: ${safe.message}\n`);
  process.exitCode = 1;
});
