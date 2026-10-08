#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { redact, restore, loadConfig, readVault, writeVault } from "./index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const command = args[0];

if (!command || command === "--help") {
  console.log(`pii-freely — local PII redaction

Usage:
  pfree redact [options] < input.txt
  pfree restore --mapping map.json < redacted.txt
  PFREE_KEY=... pfree restore --vault map.vault < redacted.txt

Commands:
  redact     Redact PII from stdin, write cleaned text to stdout
  restore    Restore PII from stdin using a mapping file or vault

Options:
  --mapping <file>     Plain JSON mapping (placeholder -> original). Extended if it exists.
  --vault <file>       Encrypted mapping (AES-256-GCM). Requires a key. Extended if it exists.
  --key <key>          Key for keyed placeholders and the vault. Prefer the PFREE_KEY
                       environment variable, which stays out of shell history.
  --json               redact: emit {"text", "entities"} instead of plain text.
                       Never includes original values.
  --config <file>      Path to a config JSON file (overrides defaults)
  --profile <name>     Load config from profiles/<name>.json

With a key, placeholders carry a keyed hash ([PERSON_a3f9c1]) that is stable
for the same value across runs. Without one, they are numbered ([PERSON_1]).`);
  process.exit(0);
}

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function resolveConfig() {
  const configFlag = flagValue(args, "--config");
  if (configFlag) return configFlag;

  const profile = flagValue(args, "--profile");
  if (profile) {
    const profilePath = resolve(__dirname, "profiles", `${profile}.json`);
    if (!existsSync(profilePath)) fail(`Profile not found: ${profilePath}`);
    return profilePath;
  }

  return null;
}

function resolveStore() {
  const mappingPath = flagValue(args, "--mapping");
  const vaultPath = flagValue(args, "--vault");
  const key = flagValue(args, "--key") ?? process.env.PFREE_KEY ?? null;

  if (mappingPath && vaultPath) fail("use either --mapping or --vault, not both");
  if (vaultPath && !key) fail("--vault requires a key (--key or PFREE_KEY)");

  return { mappingPath, vaultPath, key };
}

function loadMapping({ mappingPath, vaultPath, key }) {
  try {
    if (vaultPath && existsSync(vaultPath)) return readVault(vaultPath, key);
    if (mappingPath && existsSync(mappingPath)) return JSON.parse(readFileSync(mappingPath, "utf-8"));
  } catch (err) {
    fail(err.message);
  }
  return {};
}

if (command === "redact") {
  const input = readFileSync("/dev/stdin", "utf-8");
  const store = resolveStore();
  const config = loadConfig(resolveConfig());

  const result = await redact(input, { config, key: store.key, mapping: loadMapping(store) });

  if (args.includes("--json")) {
    process.stdout.write(JSON.stringify({ text: result.redacted, entities: result.entities }, null, 2) + "\n");
  } else {
    process.stdout.write(result.redacted);
  }

  if (store.vaultPath) {
    writeVault(store.vaultPath, result.mapping, store.key);
    console.error(`Vault written to ${store.vaultPath}`);
  } else if (store.mappingPath) {
    writeFileSync(store.mappingPath, JSON.stringify(result.mapping, null, 2), { mode: 0o600 });
    console.error(`Mapping written to ${store.mappingPath}`);
  }
} else if (command === "restore") {
  const input = readFileSync("/dev/stdin", "utf-8");
  const store = resolveStore();

  if (!store.mappingPath && !store.vaultPath) fail("restore requires --mapping or --vault");
  const path = store.vaultPath || store.mappingPath;
  if (!existsSync(path)) fail(`File not found: ${path}`);

  process.stdout.write(await restore(input, loadMapping(store)));
} else {
  fail(`Unknown command: ${command}`);
}

function flagValue(args, flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
}
