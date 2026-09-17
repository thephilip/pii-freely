import { redact, restore, loadConfig } from "./index.js";

const sample = `
Customer John Smith (john.smith@acme.com) called about account issues.
His personal email is john.smith@gmail.com.
His phone number is 555-867-5309 and he lives at 742 Evergreen Terrace,
Springfield, IL 62704. SSN on file: 123-45-6789.
Credit card ending in 4242-4242-4242-4242 was flagged.

Cluster ID: a1b2c3d4-e5f6-7890-abcd-ef1234567890
API endpoint: api.my-cluster.p1.openshiftapps.com
Public IP: 54.231.10.99
Internal IP: 10.0.1.50
ARN: arn:aws:iam::123456789012:role/my-role
Token: sha256~ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij
S3: s3://my-customer-bucket
`;

console.log("=== Default Config (public IPs redacted, private preserved) ===");
const result = await redact(sample);
console.log(result.redacted);
console.log("Items:", result.items.map((i) => `${i.label}:${i.placeholder}`).join(", "));

const restored = await restore(result.redacted, result.mapping);
const match = restored.trim() === sample.trim();
console.log(`Round-trip: ${match ? "PASS" : "FAIL"}`);

console.log("\n=== Full Profile (everything redacted) ===");
const fullResult = await redact(sample, { configPath: "./profiles/full.json" });
console.log(fullResult.redacted);
console.log("Items:", fullResult.items.map((i) => `${i.label}:${i.placeholder}`).join(", "));

console.log("\n=== Light Profile (personal email only, no corporate) ===");
const lightResult = await redact(sample, { configPath: "./profiles/light.json" });
console.log(lightResult.redacted);
console.log("Items:", lightResult.items.map((i) => `${i.label}:${i.placeholder}`).join(", "));

console.log("\n=== Custom: redact personal email, keep corporate ===");
const customConfig = loadConfig();
customConfig.model.EMAIL = { corporate: false, personal: true };
const customResult = await redact(sample, { config: customConfig });
console.log(customResult.redacted);
console.log("Items:", customResult.items.map((i) => `${i.label}:${i.placeholder}`).join(", "));
