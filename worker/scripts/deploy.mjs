// One-command deploy for your own copy: finds (or creates) your D1 database, remembers its id in a
// gitignored .env, writes a gitignored wrangler.local.jsonc with that id, then migrates and deploys.
//
//   npm run deploy          migrate + deploy
//   npm run secret          set API_TOKEN (wrangler asks for the value)
//   npm run deploy -- --config-only   only write wrangler.local.jsonc
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findDatabaseId, parseEnv, renderConfig, setEnvValue } from "./config.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = join(ROOT, ".env");
const BASE_CONFIG = join(ROOT, "wrangler.jsonc");
const LOCAL_CONFIG = "wrangler.local.jsonc";
const DB_NAME = "standamailtrack";

function wrangler(args, { capture = false } = {}) {
  // shell: true so `npx` resolves on Windows too; every argument here is a constant.
  const r = spawnSync("npx", ["wrangler", ...args], {
    cwd: ROOT,
    shell: true,
    stdio: capture ? ["inherit", "pipe", "inherit"] : "inherit",
    encoding: "utf8",
  });
  if (r.status !== 0) {
    console.error(`\n✖ wrangler ${args.join(" ")} failed (exit ${r.status}).`);
    process.exit(r.status ?? 1);
  }
  return r.stdout ?? "";
}

function databaseId() {
  const envText = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
  const fromEnv = parseEnv(envText).D1_DATABASE_ID;
  if (fromEnv) return fromEnv;

  console.log(`Looking up your D1 database "${DB_NAME}"…`);
  let id = findDatabaseId(wrangler(["d1", "list", "--json"], { capture: true }), DB_NAME);
  if (!id) {
    console.log(`Not found, creating "${DB_NAME}"…`);
    // --update-config=false: never let wrangler offer to edit the committed wrangler.jsonc.
    wrangler(["d1", "create", DB_NAME, "--update-config=false"]);
    id = findDatabaseId(wrangler(["d1", "list", "--json"], { capture: true }), DB_NAME);
    if (!id) throw new Error(`created "${DB_NAME}" but couldn't find it in \`wrangler d1 list\``);
  }
  writeFileSync(ENV_FILE, setEnvValue(envText, "D1_DATABASE_ID", id));
  console.log(`Saved D1_DATABASE_ID to worker/.env`);
  return id;
}

const id = databaseId();
try {
  writeFileSync(join(ROOT, LOCAL_CONFIG), renderConfig(readFileSync(BASE_CONFIG, "utf8"), id));
} catch (e) {
  console.error(`\n✖ ${e.message}\n  Fix or delete the D1_DATABASE_ID line in worker/.env, then run this again.`);
  process.exit(1);
}
console.log(`Wrote worker/${LOCAL_CONFIG} (database ${id})`);

if (process.argv.includes("--config-only")) process.exit(0);
if (process.argv.includes("--secret")) {
  wrangler(["secret", "put", "API_TOKEN", "-c", LOCAL_CONFIG]);
  process.exit(0);
}

wrangler(["d1", "migrations", "apply", DB_NAME, "--remote", "-c", LOCAL_CONFIG]);
wrangler(["deploy", "-c", LOCAL_CONFIG]);
console.log("\n✔ Deployed. Next: `npm run secret` (once) to set your API token.");
