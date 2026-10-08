import { readFileSync, writeFileSync } from "fs";
import { scryptSync, randomBytes, createCipheriv, createDecipheriv, createHmac } from "crypto";

const FORMAT = "pii-freely-vault";
const VERSION = 1;
const SCRYPT = { N: 2 ** 15, r: 8, p: 1 };
const SCRYPT_MAXMEM = 64 * 1024 * 1024;
const ID_SALT = "pii-freely/placeholder-id/v1";

function requireKey(key) {
  if (typeof key !== "string" || key.length === 0) {
    throw new Error("A non-empty key is required");
  }
}

function scrypt(key, salt, params = SCRYPT) {
  return scryptSync(key, salt, 32, { ...params, maxmem: SCRYPT_MAXMEM });
}

const idKeyCache = new Map();

// Deterministic per key, so the same value gets the same placeholder across runs.
export function deriveIdKey(key) {
  requireKey(key);
  if (!idKeyCache.has(key)) idKeyCache.set(key, scrypt(key, ID_SALT));
  return idKeyCache.get(key);
}

export function placeholderDigest(idKey, label, original) {
  return createHmac("sha256", idKey).update(label).update("\0").update(original).digest("hex");
}

function header(kdf) {
  return Buffer.from(JSON.stringify({ format: FORMAT, version: VERSION, kdf }));
}

export function encryptMapping(mapping, key) {
  requireKey(key);
  const kdf = { name: "scrypt", ...SCRYPT, salt: randomBytes(16).toString("base64") };
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", scrypt(key, Buffer.from(kdf.salt, "base64")), iv);
  cipher.setAAD(header(kdf));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(mapping), "utf-8"), cipher.final()]);
  return {
    format: FORMAT,
    version: VERSION,
    kdf,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function decryptMapping(vault, key) {
  requireKey(key);
  if (vault?.format !== FORMAT) throw new Error("Not a pii-freely vault");
  if (vault.version !== VERSION) throw new Error(`Unsupported vault version: ${vault.version}`);

  const { name, salt, ...params } = vault.kdf;
  if (name !== "scrypt") throw new Error(`Unsupported vault KDF: ${name}`);

  const decipher = createDecipheriv(
    "aes-256-gcm",
    scrypt(key, Buffer.from(salt, "base64"), params),
    Buffer.from(vault.iv, "base64")
  );
  decipher.setAAD(header(vault.kdf));
  decipher.setAuthTag(Buffer.from(vault.tag, "base64"));
  try {
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(vault.ciphertext, "base64")),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString("utf-8"));
  } catch {
    throw new Error("Could not decrypt vault: wrong key or corrupted file");
  }
}

export function readVault(path, key) {
  return decryptMapping(JSON.parse(readFileSync(path, "utf-8")), key);
}

export function writeVault(path, mapping, key) {
  writeFileSync(path, JSON.stringify(encryptMapping(mapping, key), null, 2), { mode: 0o600 });
}
