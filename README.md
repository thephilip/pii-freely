# pii-freely

Local PII redaction for text data. Runs entirely on-device using [Desert Ant's redact model](https://github.com/Desert-Ant-Labs/desert-ant-core/blob/main/docs/models/redact.md) for natural-language PII and regex patterns for infrastructure identifiers. Nothing leaves your machine.

Redaction is reversible. Mask data before sending text to an LLM or external service, then restore the originals locally when you need them back.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/thephilip/pii-freely/main/install.sh | bash
```

Or with a custom install location:

```bash
PII_FREELY_HOME=/opt/pii-freely curl -fsSL https://raw.githubusercontent.com/thephilip/pii-freely/main/install.sh | bash
```

This installs to `~/.pii-freely` and symlinks `pfree` into `~/.local/bin`.

Requires Node.js 18+.

## CLI

```bash
# Redact PII from stdin
echo "Call me at 555-867-5309" | pfree redact

# Save the mapping for later restoration (extended if the file already exists)
echo "Call me at 555-867-5309" | pfree redact --mapping map.json

# Restore originals
echo "Call me at [PHONE_1]" | pfree restore --mapping map.json

# Use a named profile
cat case-data.txt | pfree redact --profile full --mapping map.json

# Use a custom config file
cat case-data.txt | pfree redact --config my-config.json

# JSON output for piping to a model or script
cat case-data.txt | pfree redact --json --mapping map.json
```

### Keyed placeholders and encrypted vaults

Give a key and placeholders carry a keyed hash instead of a counter. The same value
always gets the same placeholder under the same key, across runs and documents, so
`[PERSON_99298e]` in Monday's ticket is the same person in Friday's.

```bash
export PFREE_KEY='a long passphrase'   # keeps the key out of shell history; --key also works

cat ticket.txt | pfree redact --vault case.vault > ticket.redacted.txt
cat reply.txt  | pfree restore --vault case.vault
```

A vault is the mapping encrypted with AES-256-GCM (key derived with scrypt), so it is
safe to keep beside the redacted text. Each `redact --vault` call adds new values to it.
The placeholder hashes are an HMAC under your key, so they cannot be reversed by
hashing guesses: a plain hash of a phone number or SSN could be.

### JSON output

`--json` writes the redacted text plus a legend of what each placeholder is (shown here with a key and name redaction on):

```json
{
  "text": "[PERSON_cac1c0] ([EMAIL_f205a6]) emailed [PERSON_99298e].",
  "entities": [
    { "placeholder": "[PERSON_cac1c0]", "type": "PERSON", "count": 1 },
    { "placeholder": "[EMAIL_f205a6]", "type": "EMAIL", "count": 1 },
    { "placeholder": "[PERSON_99298e]", "type": "PERSON", "count": 1 }
  ]
}
```

It never contains original values; those only go to `--mapping` or `--vault`.

## Module

```js
import { redact, restore, redactBatch, loadConfig, readVault, writeVault } from "./index.js";

const { redacted, mapping, items, entities } = await redact("Email me at user@example.com");
// redacted: "Email me at [EMAIL_1]"
// mapping:  { "[EMAIL_1]": "user@example.com" }
// entities: [{ placeholder: "[EMAIL_1]", type: "EMAIL", count: 1 }]

const original = await restore(redacted, mapping);
// "Email me at user@example.com"

// Keyed placeholders: stable for the same value under the same key
const keyed = await redact(text, { key: process.env.PFREE_KEY });
// "Email me at [EMAIL_f205a6]"

// Extend an existing mapping so known values keep their placeholders
const next = await redact(otherText, { mapping });

// Batch mode shares one mapping across all texts
const batch = await redactBatch(["text one", "text two"]);

// Encrypted mapping on disk
writeVault("case.vault", mapping, key);
const restored = readVault("case.vault", key);

// Use a specific profile
const result = await redact(text, { configPath: "./profiles/full.json" });

// Or pass a config object directly
const config = loadConfig("./profiles/light.json");
config.model.EMAIL = { corporate: false, personal: true };
const result = await redact(text, { config });
```

## What it detects

### Model-based (Desert Ant)

Natural-language PII detected by the on-device ML model (11.6 MB, 23M params):

| Category | Examples |
|---|---|
| `EMAIL` | email addresses |
| `PHONE` | phone numbers |
| `SSN` | social security numbers |
| `CREDIT_CARD` | credit card numbers |
| `GIVEN_NAME` / `SURNAME` | person names (off by default; adjacent parts merge into `PERSON`) |
| `STREET_NAME` / `BUILDING_NUMBER` / `CITY` / `STATE` / `ZIP_CODE` | address components |
| `GOVERNMENT_ID` / `DRIVERS_LICENSE` / `PASSPORT` / `TAX_ID` | government documents |
| `BANK_ACCOUNT` / `ROUTING_NUMBER` | financial identifiers |
| `IP_ADDRESS` | IP addresses |
| `URL` | URLs |

### Regex-based (infrastructure)

Deterministic patterns for cloud and cluster identifiers:

| Category | What it matches |
|---|---|
| `CLUSTER_ID` | UUIDs |
| `AWS_ACCOUNT_ID` | 12-digit numbers near AWS context |
| `PUBLIC_IPV4` / `PUBLIC_IPV6` | public IP addresses (skips RFC 1918) |
| `FQDN` | hostnames at or under the domains in `hostDomains` (none by default) |
| `ARN` | AWS resource names |
| `S3_BUCKET` | S3 URIs |
| `OAUTH_TOKEN` | `sha256~` bearer tokens |
| `SUBSCRIPTION_ID` | subscription/org IDs near keyword context |
| `PEM_BLOCK` | PEM-encoded certificates and private keys |
| `BASE64_DATA` | base64 blobs near cert/secret/credential context |

## Configuration

Copy `config.default.json` to customize, or create a profile under `profiles/`.

Every category accepts either a simple boolean or granular sub-options:

```json
{
  "model": {
    "PHONE": true,
    "GIVEN_NAME": false,
    "SURNAME": false,
    "EMAIL": { "corporate": true, "personal": true },
    "IP_ADDRESS": { "public": true, "private": false }
  },
  "infra": {
    "CLUSTER_ID": true,
    "FQDN": { "internal": false, "external": true }
  },
  "mergeNames": true,
  "minimumConfidence": 0.6,
  "hostDomains": ["internal.example.com"],
  "internalDomains": ["example.com"],
  "corporateDomains": ["example.com"]
}
```

### Sub-options

| Category | Sub-options | Logic |
|---|---|---|
| `IP_ADDRESS` | `public` / `private` | RFC 1918, loopback, link-local |
| `EMAIL` | `corporate` / `personal` | matched against `corporateDomains` |
| `URL` | `internal` / `external` | matched against `internalDomains` |
| `FQDN` | `internal` / `external` | matched against `internalDomains` |

`hostDomains`, `internalDomains` and `corporateDomains` are empty by default; fill them in with
your own organization's domains:

- `hostDomains`: hostnames at or under these domains are detected as `FQDN`
- `internalDomains`: decides `internal` vs `external` for `URL` and `FQDN`
- `corporateDomains`: decides `corporate` vs `personal` for `EMAIL`

Categories without a refiner ignore sub-option keys and redact if any value is `true`.

Name redaction (`GIVEN_NAME`, `SURNAME`) is off by default because the model's recall on
names is lower than on structured identifiers (see [Limitations](#limitations)). Turn both
on in your config, or use `--profile full`.

`mergeNames` (default `true`) folds adjacent `GIVEN_NAME`/`SURNAME` detections such as
"John Smith" into a single `[PERSON_1]`. Set it to `false` to keep `[GIVEN_NAME_1] [SURNAME_1]`.

### Profiles

Two built-in profiles:

- **full** (`--profile full`): Everything on, lower confidence threshold (0.5). Use for the most sensitive data.
- **light** (`--profile light`): Financial and auth PII only, no address or infra redaction. Higher confidence threshold (0.7).

Create your own by adding a JSON file to `profiles/`.

## How it works

1. Text runs through the Desert Ant redact model, which detects natural-language PII
2. Regex patterns scan the same text for infrastructure identifiers
3. The refiner layer drops detections that the config's sub-options exclude
4. Where detections overlap, the longest wins (a PEM block beats the base64 inside it)
5. Adjacent name parts merge into `PERSON`
6. Each distinct value gets one placeholder, numbered or keyed, recorded in the mapping

The mapping file is the only artifact that contains real PII. Keep it local, or use `--vault`.

## Limitations

- Person names (`GIVEN_NAME`/`SURNAME`) have lower recall than structured identifiers
- The model reports 88.8% recall overall. Layer additional regex patterns for formats critical to your use case.
- `AWS_ACCOUNT_ID` and `SUBSCRIPTION_ID` require nearby keyword context to avoid false positives on arbitrary 12-digit or 24-character strings
