#!/usr/bin/env node
// StandaMailTrack snippet generator. Node 18+, no dependencies.
//
// generate: turn a recipient CSV into one tracked HTML snippet per person.
//   node scripts/snippets.mjs generate \
//     --csv recipients.csv --base https://your-worker.example.workers.dev \
//     --token YOUR_API_TOKEN --secret YOUR_HMAC_SECRET \
//     --links "https://www.linkedin.com/in/you/,https://example.com" \
//     --out out/
//
//   recipients.csv needs a header row with: email, campaign. A name column is optional.
//   Each row is registered with the server under a pseudonym, never the address.
//   The address stays in out/mapping.csv on your machine only.
//
// join: match a server export back to real recipients, locally.
//   node scripts/snippets.mjs join --export export.csv --mapping out/mapping.csv --out report.csv

import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith("--") || argv[i + 1] === undefined) fail(`bad argument: ${argv[i]}`);
    out[argv[i].slice(2)] = argv[i + 1];
  }
  return out;
}

/** Minimal RFC 4180 CSV parser: quoted fields, embedded commas, CRLF or LF. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") row.push(field), (field = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field), (field = "");
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length) (row.push(field), rows.push(row));
  return rows;
}

function csvField(value) {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/** Deterministic 22-char base62 id from HMAC-SHA256(secret, campaign + "|" + email). */
function recipientId(secret, campaign, email) {
  const digest = createHmac("sha256", secret).update(`${campaign}|${email.toLowerCase().trim()}`).digest();
  let id = "";
  for (let i = 0; id.length < 22; i++) id += ALPHABET[digest[i % digest.length] % 62];
  return id;
}

function escapeHtml(s) {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

async function registerEmail(base, token, body) {
  const res = await fetch(`${base}/api/emails`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) fail(`register failed for ${body.id}: ${res.status} ${await res.text()}`);
}

async function generate(a) {
  for (const k of ["csv", "base", "token", "secret", "links", "out"]) if (!a[k]) fail(`--${k} is required`);
  const base = a.base.replace(/\/$/, "");
  const links = a.links.split(",").map((l) => l.trim()).filter(Boolean);
  if (!links.length) fail("--links needs at least one URL");
  const rows = parseCsv(readFileSync(a.csv, "utf8"));
  const header = rows.shift().map((h) => h.trim().toLowerCase());
  const col = (name) => header.indexOf(name);
  if (col("email") < 0 || col("campaign") < 0) fail("CSV needs email and campaign columns");
  mkdirSync(a.out, { recursive: true });

  const mapping = ["email,name,campaign,id,pseudonym"];
  for (const row of rows) {
    const email = row[col("email")]?.trim();
    const campaign = row[col("campaign")]?.trim();
    const name = col("name") >= 0 ? (row[col("name")] ?? "").trim() : "";
    if (!email || !campaign) continue;
    const id = recipientId(a.secret, campaign, email);
    const pseudonym = `anon-${id.slice(0, 10)}`;

    await registerEmail(base, a.token, { id, subject: campaign, recipients: [pseudonym], links });

    const tracked = links
      .map((url, idx) => `<a href="${base}/c/${id}/${idx}">${escapeHtml(url.replace(/^https?:\/\//, ""))}</a>`)
      .join("<br>\n");
    const snippet = `${tracked}\n<img src="${base}/p/${id}.gif" width="1" height="1" alt="" style="display:none">\n`;
    const file = join(a.out, `${email.replaceAll(/[^A-Za-z0-9@.+-]/g, "_")}.html`);
    writeFileSync(file, snippet);
    mapping.push([email, name, campaign, id, pseudonym].map(csvField).join(","));
    console.log(`✓ ${email} -> ${file}`);
  }
  writeFileSync(join(a.out, "mapping.csv"), mapping.join("\n") + "\n");
  console.log(`✓ wrote ${join(a.out, "mapping.csv")} (keep this local, it holds the addresses)`);
}

function joinExport(a) {
  for (const k of ["export", "mapping", "out"]) if (!a[k]) fail(`--${k} is required`);
  const exp = parseCsv(readFileSync(a.export, "utf8"));
  const map = parseCsv(readFileSync(a.mapping, "utf8"));
  const mapHeader = map.shift();
  const idCol = mapHeader.indexOf("id");
  const byId = new Map(map.map((r) => [r[idCol], r]));
  const expHeader = exp.shift();
  const expIdCol = expHeader.indexOf("id");
  const out = ["email,name," + expHeader.join(",")];
  for (const r of exp) {
    const m = byId.get(r[expIdCol]);
    out.push([...(m ? m.slice(0, 2) : ["", ""]), ...r].map(csvField).join(","));
  }
  writeFileSync(a.out, out.join("\n") + "\n");
  console.log(`✓ wrote ${a.out} (${exp.length} events)`);
}

const [command, ...rest] = process.argv.slice(2);
if (command === "generate") await generate(args(rest));
else if (command === "join") joinExport(args(rest));
else fail("usage: snippets.mjs generate|join --help-free, see comments at the top of this file");
