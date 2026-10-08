import { test } from "node:test";
import assert from "node:assert/strict";
import { redact, restore, redactBatch, loadConfig, encryptMapping, decryptMapping } from "./index.js";

const sample = `
Customer John Smith (john.smith@acme.com) called about account issues.
His personal email is john.smith@gmail.com.
His phone number is 555-867-5309 and he lives at 742 Evergreen Terrace,
Springfield, IL 62704. SSN on file: 123-45-6789.
Credit card ending in 4242-4242-4242-4242 was flagged.

Cluster ID: a1b2c3d4-e5f6-7890-abcd-ef1234567890
API endpoint: api.my-cluster.p1.example-apps.com
Public IP: 54.231.10.99
Internal IP: 10.0.1.50
ARN: arn:aws:iam::123456789012:role/my-role
Token: sha256~ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij
S3: s3://my-customer-bucket
`;

function withNames() {
  const config = loadConfig();
  config.model.GIVEN_NAME = true;
  config.model.SURNAME = true;
  return config;
}

// Infra-only config: deterministic, no model needed.
function infraOnly() {
  const config = loadConfig();
  for (const k of Object.keys(config.model)) config.model[k] = false;
  return config;
}

test("default config round-trips, keeps private IPs and names", async () => {
  const result = await redact(sample);
  assert.ok(result.redacted.includes("Internal IP: 10.0.1.50"));
  assert.ok(result.redacted.includes("Customer John Smith ("));
  assert.ok(!result.redacted.includes("john.smith@gmail.com"));
  assert.equal(await restore(result.redacted, result.mapping), sample);
});

test("adjacent name parts merge into one PERSON", async () => {
  const result = await redact(sample, { config: withNames() });
  assert.ok(result.redacted.includes("Customer [PERSON_1] ("));
  assert.equal(result.mapping["[PERSON_1]"], "John Smith");
  assert.ok(!result.items.some((i) => i.label === "GIVEN_NAME" || i.label === "SURNAME"));
});

test("mergeNames: false keeps separate name parts", async () => {
  const config = withNames();
  config.mergeNames = false;
  const result = await redact(sample, { config });
  assert.ok(result.redacted.includes("[GIVEN_NAME_1] [SURNAME_1]"));
});

test("repeated values share one placeholder", async () => {
  const text = "ARN arn:aws:iam::123456789012:role/a then again arn:aws:iam::123456789012:role/a";
  const result = await redact(text, { config: infraOnly() });
  assert.equal(result.redacted, "ARN [ARN_1] then again [ARN_1]");
  assert.deepEqual(result.entities, [{ placeholder: "[ARN_1]", type: "ARN", count: 2 }]);
});

test("longest overlapping span wins", async () => {
  const result = await redact("role arn:aws:iam::123456789012:role/x", { config: infraOnly() });
  assert.equal(result.redacted, "role [ARN_1]");
});

test("entities never contain original values", async () => {
  const result = await redact(sample);
  assert.ok(result.entities.length > 0);
  for (const entity of result.entities) {
    assert.deepEqual(Object.keys(entity).sort(), ["count", "placeholder", "type"]);
    assert.ok(entity.placeholder in result.mapping);
  }
});

test("redactBatch does not reuse placeholders for different values", async () => {
  const config = infraOnly();
  const batch = await redactBatch(["Bucket s3://alpha-bucket", "Bucket s3://beta-bucket"], { config });
  assert.deepEqual(batch.redacted, ["Bucket [S3_BUCKET_1]", "Bucket [S3_BUCKET_2]"]);
  assert.equal(await restore(batch.redacted[0], batch.mapping), "Bucket s3://alpha-bucket");
  assert.equal(await restore(batch.redacted[1], batch.mapping), "Bucket s3://beta-bucket");
});

test("an existing mapping is extended, not renumbered", async () => {
  const mapping = { "[S3_BUCKET_1]": "s3://alpha-bucket" };
  const result = await redact("s3://beta-bucket and s3://alpha-bucket", { config: infraOnly(), mapping });
  assert.equal(result.redacted, "[S3_BUCKET_2] and [S3_BUCKET_1]");
});

test("keyed placeholders are stable per key and differ across keys", async () => {
  const config = infraOnly();
  const text = "Bucket s3://alpha-bucket";
  const a = await redact(text, { config, key: "key-one" });
  const b = await redact(text, { config, key: "key-one" });
  const c = await redact(text, { config, key: "key-two" });
  assert.match(a.redacted, /^Bucket \[S3_BUCKET_[0-9a-f]{6}\]$/);
  assert.equal(a.redacted, b.redacted);
  assert.notEqual(a.redacted, c.redacted);
  assert.equal(await restore(a.redacted, a.mapping), text);
});

test("restore is single-pass", async () => {
  const mapping = { "[A_1]": "[B_1]", "[B_1]": "secret" };
  assert.equal(await restore("[A_1] [B_1]", mapping), "[B_1] secret");
});

test("vault round-trips and rejects the wrong key", () => {
  const mapping = { "[EMAIL_1]": "user@example.com" };
  const vault = encryptMapping(mapping, "correct horse");
  assert.ok(!JSON.stringify(vault).includes("user@example.com"));
  assert.deepEqual(decryptMapping(vault, "correct horse"), mapping);
  assert.throws(() => decryptMapping(vault, "wrong"), /wrong key/);
});

test("profiles still load and round-trip", async () => {
  for (const configPath of ["./profiles/full.json", "./profiles/light.json"]) {
    const result = await redact(sample, { configPath });
    assert.equal(await restore(result.redacted, result.mapping), sample);
  }
});
