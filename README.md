# pii-freely

Local PII redaction for text data. Runs entirely on-device using [Desert Ant's redact model](https://github.com/Desert-Ant-Labs/desert-ant-core/blob/main/docs/models/redact.md) for natural-language PII and regex patterns for infrastructure identifiers. Nothing leaves your machine.

Redaction is reversible. Mask data before sending text to an LLM or external service, then restore the originals locally when you need them back.

## Install

```bash
git clone <repo-url> pii-freely && cd pii-freely
bash install.sh
```

This installs to `~/.pii-freely` and adds a shell alias. Override the install location with `PII_FREELY_HOME`.

Requires Node.js 18+.

## CLI

```bash
# Redact PII from stdin
echo "Call John at 555-867-5309" | pfree redact

# Save the mapping for later restoration
echo "Call John at 555-867-5309" | pfree redact --mapping map.json

# Restore originals
echo "Call John at [PHONE_1]" | pfree restore --mapping map.json

# Use a named profile
cat case-data.txt | pfree redact --profile full --mapping map.json

# Use a custom config file
cat case-data.txt | pfree redact --config my-config.json
```

## Module

```js
import { redact, restore, redactBatch, loadConfig } from "./index.js";

const { redacted, mapping, items } = await redact("Email me at user@example.com");
// redacted: "Email me at [EMAIL_1]"
// mapping: { "[EMAIL_1]": "user@example.com" }

const original = await restore(redacted, mapping);
// "Email me at user@example.com"

// Batch mode shares a single mapping across all texts
const batch = await redactBatch(["text one", "text two"]);

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
| `GIVEN_NAME` / `SURNAME` | person names |
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
| `FQDN` | OpenShift/RH platform hostnames |
| `ARN` | AWS resource names |
| `S3_BUCKET` | S3 URIs |
| `OAUTH_TOKEN` | `sha256~` bearer tokens |
| `SUBSCRIPTION_ID` | subscription/org IDs near keyword context |

## Configuration

Copy `config.default.json` to customize, or create a profile under `profiles/`.

Every category accepts either a simple boolean or granular sub-options:

```json
{
  "model": {
    "PHONE": true,
    "EMAIL": { "corporate": true, "personal": true },
    "IP_ADDRESS": { "public": true, "private": false }
  },
  "infra": {
    "CLUSTER_ID": true,
    "FQDN": { "internal": false, "external": true }
  },
  "minimumConfidence": 0.6,
  "internalDomains": ["redhat.com", "corp.redhat.com"],
  "corporateDomains": ["redhat.com"]
}
```

### Sub-options

| Category | Sub-options | Logic |
|---|---|---|
| `IP_ADDRESS` | `public` / `private` | RFC 1918, loopback, link-local |
| `EMAIL` | `corporate` / `personal` | matched against `corporateDomains` |
| `URL` | `internal` / `external` | matched against `internalDomains` |
| `FQDN` | `internal` / `external` | matched against `internalDomains` |

Categories without a refiner ignore sub-option keys and redact if any value is `true`.

### Profiles

Two built-in profiles:

- **full** (`--profile full`): Everything on, lower confidence threshold (0.5). Use for customer case data.
- **light** (`--profile light`): Financial and auth PII only, no address or infra redaction. Higher confidence threshold (0.7).

Create your own by adding a JSON file to `profiles/`.

## How it works

1. Text runs through the Desert Ant redact model, which detects natural-language PII
2. The refiner layer checks each detection against sub-option rules and restores items that don't match the config
3. Regex patterns scan for infrastructure identifiers
4. The same refiner layer filters infra detections
5. A unified mapping ties each `[PLACEHOLDER_N]` to its original value

The mapping file is the only artifact that contains real PII. Keep it local.

## Limitations

- Person names (`GIVEN_NAME`/`SURNAME`) have lower recall than structured identifiers
- The model reports 88.8% recall overall. Layer additional regex patterns for formats critical to your use case.
- `AWS_ACCOUNT_ID` and `SUBSCRIPTION_ID` require nearby keyword context to avoid false positives on arbitrary 12-digit or 24-character strings
