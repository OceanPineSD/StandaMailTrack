// Pure helpers for deploy.mjs (unit-tested in config.test.mjs).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_LINE = /("database_id"\s*:\s*")[^"]*(")/;

/** wrangler.jsonc with its D1 database_id replaced (comment lines are left alone). */
export function renderConfig(jsonc, databaseId) {
  if (!UUID.test(databaseId)) throw new Error(`invalid D1 database id: ${databaseId}`);
  let found = false;
  const out = jsonc
    .split("\n")
    .map((line) => {
      if (found || line.trimStart().startsWith("//") || !ID_LINE.test(line)) return line;
      found = true;
      return line.replace(ID_LINE, `$1${databaseId}$2`);
    })
    .join("\n");
  if (!found) throw new Error("wrangler.jsonc has no database_id to replace");
  return out;
}

/** The id of the D1 database called `name` in `wrangler d1 list --json` output, or null. */
export function findDatabaseId(listOutput, name) {
  const start = listOutput.indexOf("[");
  const end = listOutput.lastIndexOf("]");
  if (start < 0 || end < start) return null;
  const list = JSON.parse(listOutput.slice(start, end + 1));
  const db = list.find((d) => d.name === name);
  return db ? (db.uuid ?? db.database_id ?? db.id ?? null) : null;
}

/** KEY=value pairs from a .env file. */
export function parseEnv(text) {
  const env = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return env;
}

/** .env text with `key` set to `value`, replacing an existing line or appending one; other lines are kept. */
export function setEnvValue(text, key, value) {
  const lines = text === "" ? [] : text.replace(/\r?\n$/, "").split(/\r?\n/);
  const i = lines.findIndex((l) => l.trim().startsWith(`${key}=`));
  if (i >= 0) lines[i] = `${key}=${value}`;
  else lines.push(`${key}=${value}`);
  return lines.join("\n") + "\n";
}
