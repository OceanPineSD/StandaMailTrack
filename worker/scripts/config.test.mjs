import assert from "node:assert/strict";
import { test } from "node:test";
import { findDatabaseId, parseEnv, renderConfig, setEnvValue } from "./config.mjs";

const JSONC = `{
  "name": "email-tracker",
  // a comment with "database_id": "not-this-one"
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "email-tracker",
      "database_id": "2c8de433-3a63-4ef5-881d-82ff8a976640",
      "migrations_dir": "migrations"
    }
  ]
}`;

test("renderConfig swaps in the given database id and keeps everything else", () => {
  const out = renderConfig(JSONC, "11111111-2222-3333-4444-555555555555");
  assert.match(out, /"database_id": "11111111-2222-3333-4444-555555555555"/);
  assert.doesNotMatch(out, /2c8de433/);
  assert.match(out, /"not-this-one"/); // comments untouched
  assert.match(out, /"migrations_dir": "migrations"/);
});

test("renderConfig refuses a config without a database_id or a malformed id", () => {
  assert.throws(() => renderConfig(`{ "name": "x" }`, "11111111-2222-3333-4444-555555555555"), /database_id/);
  assert.throws(() => renderConfig(JSONC, `x", "evil": "1`), /invalid/i);
});

test("findDatabaseId picks the database by name from `wrangler d1 list --json`", () => {
  const list = JSON.stringify([
    { uuid: "aaaaaaaa-0000-0000-0000-000000000000", name: "other" },
    { uuid: "bbbbbbbb-0000-0000-0000-000000000000", name: "email-tracker" },
  ]);
  assert.equal(findDatabaseId(list, "email-tracker"), "bbbbbbbb-0000-0000-0000-000000000000");
  assert.equal(findDatabaseId(list, "missing"), null);
  assert.equal(findDatabaseId("[]", "email-tracker"), null);
});

test("findDatabaseId tolerates log lines around the JSON", () => {
  const out = `Warning: something\n[{"uuid":"cccccccc-0000-0000-0000-000000000000","name":"email-tracker"}]\n`;
  assert.equal(findDatabaseId(out, "email-tracker"), "cccccccc-0000-0000-0000-000000000000");
});

test("parseEnv reads KEY=value lines and ignores comments and blanks", () => {
  assert.deepEqual(parseEnv(`# note\nD1_DATABASE_ID=abc\n\nOTHER = "x y"\n`), { D1_DATABASE_ID: "abc", OTHER: "x y" });
});

test("setEnvValue replaces an existing key or appends it", () => {
  assert.equal(setEnvValue("A=1\nD1_DATABASE_ID=old\n", "D1_DATABASE_ID", "new"), "A=1\nD1_DATABASE_ID=new\n");
  assert.equal(setEnvValue("A=1", "D1_DATABASE_ID", "new"), "A=1\nD1_DATABASE_ID=new\n");
  assert.equal(setEnvValue("", "D1_DATABASE_ID", "new"), "D1_DATABASE_ID=new\n");
  // keeps the user's own layout
  assert.equal(setEnvValue("A=1\n\n# db\nB=2\n", "D1_DATABASE_ID", "new"), "A=1\n\n# db\nB=2\nD1_DATABASE_ID=new\n");
});
