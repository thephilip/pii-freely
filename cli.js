#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { redact, restore, loadConfig } from "./index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const command = args[0];

if (!command || command === "--help") {
  console.log(`pii-freely — local PII redaction

Usage:
  pii-freely redact [options] < input.txt
  pii-freely restore --mapping out.json < redacted.txt

Commands:
  redact     Redact PII from stdin, write cleaned text to stdout
  restore    Restore PII from stdin using a mapping file

Options:
  --mapping <file>     Path to read/write the placeholder-to-original mapping
  --config <file>      Path to a config JSON file (overrides defaults)
  --profile <name>     Load config from profiles/<name>.json`);
  process.exit(0);
}

function resolveConfig() {
  const configFlag = flagValue(args, "--config");
  if (configFlag) return configFlag;

  const profile = flagValue(args, "--profile");
  if (profile) {
    const profilePath = resolve(__dirname, "profiles", `${profile}.json`);
    if (!existsSync(profilePath)) {
      console.error(`Profile not found: ${profilePath}`);
      process.exit(1);
    }
    return profilePath;
  }

  return null;
}

if (command === "redact") {
  const input = readFileSync("/dev/stdin", "utf-8");
  const mappingPath = flagValue(args, "--mapping");
  const config = loadConfig(resolveConfig());

  const result = await redact(input, { config });
  process.stdout.write(result.redacted);

  if (mappingPath) {
    writeFileSync(mappingPath, JSON.stringify(result.mapping, null, 2));
    console.error(`Mapping written to ${mappingPath}`);
  }
} else if (command === "restore") {
  const input = readFileSync("/dev/stdin", "utf-8");
  const mappingPath = flagValue(args, "--mapping");

  if (!mappingPath) {
    console.error("Error: --mapping is required for restore");
    process.exit(1);
  }

  const mapping = JSON.parse(readFileSync(mappingPath, "utf-8"));
  const result = await restore(input, mapping);
  process.stdout.write(result);
} else {
  console.error(`Unknown command: ${command}`);
  process.exit(1);
}

function flagValue(args, flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
}
