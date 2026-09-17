import { Redact } from "@desert-ant-labs/redact/native";

console.log("Downloading model weights...");
const redact = await Redact.load();
await redact.redaction("warmup");
console.log("Model ready.");
