const PRIVATE_IP_RANGES = [
  /^10\./,
  /^127\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^fc/i,
  /^fd/i,
  /^fe80/i,
  /^::1$/,
  /^::$/,
];

const DEFAULT_INTERNAL_DOMAINS = [
  "redhat.com",
  "corp.redhat.com",
  "devshift.net",
  "rhcloud.com",
  "openshiftapps.com",
  "openshift.com",
  "access.redhat.com",
];

function isPrivateIP(value) {
  return PRIVATE_IP_RANGES.some((re) => re.test(value));
}

function isInternalDomain(value, internalDomains) {
  const domains = internalDomains || DEFAULT_INTERNAL_DOMAINS;
  const lower = value.toLowerCase();
  return domains.some((d) => lower === d || lower.endsWith("." + d));
}

function extractDomain(value) {
  try {
    const cleaned = value.replace(/^https?:\/\//, "").split(/[:/]/)[0];
    return cleaned.toLowerCase();
  } catch {
    return value.toLowerCase();
  }
}

function isCorporateEmail(value, corporateDomains) {
  const domain = value.split("@")[1]?.toLowerCase();
  if (!domain) return false;
  const domains = corporateDomains || DEFAULT_INTERNAL_DOMAINS;
  return domains.some((d) => domain === d || domain.endsWith("." + d));
}

const REFINERS = {
  IP_ADDRESS: {
    classify: (value) => (isPrivateIP(value) ? "private" : "public"),
    subcategories: ["public", "private"],
  },
  PUBLIC_IPV4: {
    classify: (value) => (isPrivateIP(value) ? "private" : "public"),
    subcategories: ["public", "private"],
  },
  PUBLIC_IPV6: {
    classify: (value) => (isPrivateIP(value) ? "private" : "public"),
    subcategories: ["public", "private"],
  },
  URL: {
    classify: (value, config) => {
      const domain = extractDomain(value);
      return isInternalDomain(domain, config.internalDomains) ? "internal" : "external";
    },
    subcategories: ["internal", "external"],
  },
  FQDN: {
    classify: (value, config) =>
      isInternalDomain(value, config.internalDomains) ? "internal" : "external",
    subcategories: ["internal", "external"],
  },
  EMAIL: {
    classify: (value, config) =>
      isCorporateEmail(value, config.corporateDomains) ? "corporate" : "personal",
    subcategories: ["corporate", "personal"],
  },
};

export function shouldRedact(label, originalValue, categoryConfig, globalConfig) {
  if (typeof categoryConfig === "boolean") return categoryConfig;
  if (typeof categoryConfig !== "object" || categoryConfig === null) return true;

  const refiner = REFINERS[label];
  if (!refiner) {
    return Object.values(categoryConfig).some((v) => v);
  }

  const subcategory = refiner.classify(originalValue, globalConfig);
  return categoryConfig[subcategory] !== false;
}

export function getRefinableCategories() {
  return Object.fromEntries(
    Object.entries(REFINERS).map(([key, r]) => [key, r.subcategories])
  );
}
