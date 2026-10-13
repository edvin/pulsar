#!/usr/bin/env node
/**
 * Add a Pulsar admin (or reset one's password): npm run add-user -- <username> [--local]
 * The password is generated here and shown once; only its PBKDF2 hash goes to D1.
 */
import { webcrypto as crypto } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const username = process.argv[2];
const local = process.argv.includes('--local');
if (!username || !/^[A-Za-z0-9._@-]{2,80}$/.test(username)) { console.error('usage: npm run add-user -- <username> [--local]'); process.exit(1); }

const ITERATIONS = 25_000; // as src/auth.ts
const b64 = (b) => Buffer.from(b).toString('base64');
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const password = Array.from(crypto.getRandomValues(new Uint8Array(20)), (x) => alphabet[x % alphabet.length]).join('');
const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
const hash = b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, key, 256));
const id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (x) => 'abcdefghijklmnopqrstuvwxyz0123456789'[x % 36]).join('');
const now = new Date().toISOString();
// Every value is base64, a fixed alphabet, or the validated username: safe in quotes.
const sql = `INSERT INTO users (id, username, pw_hash, pw_salt, iterations, created_at) VALUES ('${id}', '${username}', '${hash}', '${b64(salt)}', ${ITERATIONS}, '${now}')
  ON CONFLICT (username) DO UPDATE SET pw_hash = excluded.pw_hash, pw_salt = excluded.pw_salt, iterations = excluded.iterations;
DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = '${username}');`;
execFileSync('npx', ['wrangler', 'd1', 'execute', 'pulsar', local ? '--local' : '--remote', '--command', sql], { stdio: ['ignore', 'ignore', 'inherit'] });
console.log(`Admin "${username}" ${local ? '(local) ' : ''}set. Password (shown once): ${password}`);
