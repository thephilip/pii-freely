import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { Redact } from "@desert-ant-labs/redact/native";
import { findInfraMatches } from "./infra-patterns.js";
import { shouldRedact } from "./refiners.js";
import { deriveIdKey, placeholderDigest } from "./vault.js";

export { readVault, writeVault, encryptMapping, decryptMapping } from "./vault.js";

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
    if (overrides.mergeNames !== undefined) base.mergeNames = overrides.mergeNames;
  }

  return base;
}

const NAME_LABELS = new Set(["GIVEN_NAME", "SURNAME"]);
const ID_LENGTH = 6;

function parsePlaceholder(placeholder) {
  const m = /^\[([A-Z0-9_]+)_([0-9a-z]+)\]$/.exec(placeholder);
  return m ? { label: m[1], suffix: m[2] } : null;
}

/**
 * Hands out placeholders and remembers which value each one stands for.
 * Share one registry across texts so the same value always gets the same
 * placeholder. With a key, placeholders carry a keyed hash ([PERSON_a3f9c1])
 * that is stable across runs; without one, they are numbered ([PERSON_1]).
 */
export class PlaceholderRegistry {
  #idKey;
  #mapping = {};
  #byValue = new Map();
  #counters = {};

  constructor({ key, mapping } = {}) {
    this.#idKey = key ? deriveIdKey(key) : null;
    for (const [placeholder, original] of Object.entries(mapping || {})) {
      this.#add(placeholder, original);
    }
  }

  #add(placeholder, original) {
    this.#mapping[placeholder] = original;
    const parsed = parsePlaceholder(placeholder);
    if (!parsed) return;
    this.#byValue.set(`${parsed.label}\0${original}`, placeholder);
    if (/^\d+$/.test(parsed.suffix)) {
      this.#counters[parsed.label] = Math.max(this.#counters[parsed.label] || 0, Number(parsed.suffix));
    }
  }

  placeholderFor(label, original) {
    const existing = this.#byValue.get(`${label}\0${original}`);
    if (existing) return existing;

    let placeholder;
    if (this.#idKey) {
      const digest = placeholderDigest(this.#idKey, label, original);
      let len = ID_LENGTH;
      do {
        placeholder = `[${label}_${digest.slice(0, len)}]`;
        len += 2;
      } while (Object.hasOwn(this.#mapping, placeholder));
    } else {
      do {
        this.#counters[label] = (this.#counters[label] || 0) + 1;
        placeholder = `[${label}_${this.#counters[label]}]`;
      } while (Object.hasOwn(this.#mapping, placeholder));
    }

    this.#add(placeholder, original);
    return placeholder;
  }

  get mapping() {
    return { ...this.#mapping };
  }
}

// Overlapping detections: the longest span wins, ties go to the model.
function resolveOverlaps(spans) {
  const ranked = [...spans].sort(
    (a, b) => (b.end - b.start) - (a.end - a.start) ||
      (a.source === b.source ? 0 : a.source === "model" ? -1 : 1) ||
      a.start - b.start
  );
  const kept = [];
  for (const span of ranked) {
    if (kept.every((k) => span.end <= k.start || span.start >= k.end)) kept.push(span);
  }
  return kept.sort((a, b) => a.start - b.start);
}

// "John Q Smith" arrives as adjacent GIVEN_NAME/SURNAME spans; fold each run into one PERSON.
function mergeNames(spans, text) {
  const merged = [];
  for (let i = 0; i < spans.length; i++) {
    let j = i;
    if (NAME_LABELS.has(spans[i].label)) {
      while (
        j + 1 < spans.length &&
        NAME_LABELS.has(spans[j + 1].label) &&
        /^[ \t]+$/.test(text.slice(spans[j].end, spans[j + 1].start))
      ) {
        j++;
      }
    }
    if (j === i) {
      merged.push(spans[i]);
      continue;
    }
    const run = spans.slice(i, j + 1);
    merged.push({
      label: "PERSON",
      original: text.slice(run[0].start, run[run.length - 1].end),
      start: run[0].start,
      end: run[run.length - 1].end,
      confidence: Math.min(...run.map((s) => s.confidence)),
      source: "model",
    });
    i = j;
  }
  return merged;
}

async function detect(text, config) {
  const enabledModelLabels = Object.entries(config.model)
    .filter(([, v]) => isEnabled(v))
    .map(([k]) => k);

  const spans = [];

  if (enabledModelLabels.length > 0) {
    const redactor = await getModel();
    const result = await redactor.redaction(text, {
      minimumConfidence: config.minimumConfidence,
      labels: enabledModelLabels,
    });
    for (const item of result.items) {
      if (shouldRedact(item.label, item.original, config.model[item.label], config)) {
        spans.push({ ...item, source: "model" });
      }
    }
  }

  const infraEnabled = {};
  for (const [k, v] of Object.entries(config.infra)) {
    infraEnabled[k] = isEnabled(v);
  }
  for (const match of findInfraMatches(text, infraEnabled)) {
    if (shouldRedact(match.label, match.original, config.infra[match.label], config)) {
      spans.push({ ...match, confidence: 1.0, source: "infra" });
    }
  }

  const resolved = resolveOverlaps(spans);
  return config.mergeNames === false ? resolved : mergeNames(resolved, text);
}

/**
 * Redact one text. Options:
 *   config / configPath  detection settings
 *   key                  derive stable keyed placeholders instead of numbered ones
 *   mapping              an existing mapping to extend, so known values keep their placeholders
 *   registry             a PlaceholderRegistry to share across calls (overrides key/mapping)
 *
 * Returns the redacted text, the full mapping (placeholder -> original), one item
 * per occurrence, and `entities`: one entry per distinct placeholder in this text,
 * with no original values, safe to send alongside the text.
 */
export async function redact(text, options = {}) {
  const config = options.config || loadConfig(options.configPath);
  const registry = options.registry || new PlaceholderRegistry(options);

  const spans = await detect(text, config);

  let redacted = "";
  let cursor = 0;
  const items = [];
  const entities = new Map();

  for (const span of spans) {
    const placeholder = registry.placeholderFor(span.label, span.original);
    redacted += text.slice(cursor, span.start) + placeholder;
    cursor = span.end;

    items.push({ label: span.label, placeholder, confidence: span.confidence });
    const entity = entities.get(placeholder) || { placeholder, type: span.label, count: 0 };
    entity.count++;
    entities.set(placeholder, entity);
  }
  redacted += text.slice(cursor);

  return { redacted, mapping: registry.mapping, items, entities: [...entities.values()] };
}

// One pass over the text, so a restored value is never itself re-scanned for placeholders.
export async function restore(text, mapping) {
  const placeholders = Object.keys(mapping).sort((a, b) => b.length - a.length);
  if (placeholders.length === 0) return text;
  const pattern = new RegExp(placeholders.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");
  return text.replace(pattern, (placeholder) => mapping[placeholder]);
}

// All texts share one registry, so placeholders are consistent across the batch.
export async function redactBatch(texts, options = {}) {
  const config = options.config || loadConfig(options.configPath);
  const registry = options.registry || new PlaceholderRegistry(options);
  const results = [];
  const entities = [];

  for (const text of texts) {
    const result = await redact(text, { config, registry });
    results.push(result.redacted);
    entities.push(result.entities);
  }

  return { redacted: results, mapping: registry.mapping, entities };
}
