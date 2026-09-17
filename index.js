import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { Redact } from "@desert-ant-labs/redact/native";
import { runInfraPatterns } from "./infra-patterns.js";
import { shouldRedact } from "./refiners.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

let model = null;

async function getModel() {
  if (!model) {
    model = await Redact.load();
  }
  return model;
}

function isEnabled(categoryConfig) {
  if (typeof categoryConfig === "boolean") return categoryConfig;
  if (typeof categoryConfig === "object" && categoryConfig !== null) {
    return Object.values(categoryConfig).some((v) => v);
  }
  return true;
}

export function loadConfig(configPath) {
  const defaultPath = resolve(__dirname, "config.default.json");
  const base = JSON.parse(readFileSync(defaultPath, "utf-8"));

  if (configPath && existsSync(configPath)) {
    const overrides = JSON.parse(readFileSync(configPath, "utf-8"));
    if (overrides.model) {
      for (const [k, v] of Object.entries(overrides.model)) {
        base.model[k] = v;
      }
    }
    if (overrides.infra) {
      for (const [k, v] of Object.entries(overrides.infra)) {
        base.infra[k] = v;
      }
    }
    if (overrides.minimumConfidence !== undefined) base.minimumConfidence = overrides.minimumConfidence;
    if (overrides.internalDomains) base.internalDomains = overrides.internalDomains;
    if (overrides.corporateDomains) base.corporateDomains = overrides.corporateDomains;
  }

  return base;
}

export async function redact(text, options = {}) {
  const config = options.config || loadConfig(options.configPath);

  const enabledModelLabels = Object.entries(config.model)
    .filter(([, v]) => isEnabled(v))
    .map(([k]) => k);

  const redactor = await getModel();
  const result = await redactor.redaction(text, {
    minimumConfidence: config.minimumConfidence,
    labels: enabledModelLabels.length > 0 ? enabledModelLabels : undefined,
  });

  const mapping = {};
  const items = [];
  let redactedText = result.redactedText;

  const rejected = [];
  for (const item of result.items) {
    const categoryConfig = config.model[item.label];
    if (shouldRedact(item.label, item.original, categoryConfig, config)) {
      mapping[item.placeholder] = item.original;
      items.push({
        label: item.label,
        placeholder: item.placeholder,
        confidence: item.confidence,
      });
    } else {
      rejected.push(item);
    }
  }

  for (const item of rejected) {
    redactedText = redactedText.replaceAll(item.placeholder, item.original);
  }

  const infraEnabled = {};
  for (const [k, v] of Object.entries(config.infra)) {
    infraEnabled[k] = isEnabled(v);
  }

  const infraResult = runInfraPatterns(redactedText, infraEnabled);
  redactedText = infraResult.text;

  const rejectedInfra = [];
  for (const item of infraResult.items) {
    const categoryConfig = config.infra[item.label];
    if (shouldRedact(item.label, item.original, categoryConfig, config)) {
      mapping[item.placeholder] = item.original;
      items.push({
        label: item.label,
        placeholder: item.placeholder,
        confidence: 1.0,
      });
    } else {
      rejectedInfra.push(item);
    }
  }

  for (const item of rejectedInfra) {
    redactedText = redactedText.replaceAll(item.placeholder, item.original);
  }

  return { redacted: redactedText, mapping, items };
}

export async function restore(text, mapping) {
  let restored = text;
  for (const [placeholder, original] of Object.entries(mapping)) {
    restored = restored.replaceAll(placeholder, original);
  }
  return restored;
}

export async function redactBatch(texts, options = {}) {
  const config = options.config || loadConfig(options.configPath);
  const results = [];
  const combinedMapping = {};

  for (const text of texts) {
    const result = await redact(text, { config });
    Object.assign(combinedMapping, result.mapping);
    results.push(result.redacted);
  }

  return { redacted: results, mapping: combinedMapping };
}
