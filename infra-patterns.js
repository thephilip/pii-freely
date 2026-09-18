const PATTERNS = {
  ARN: {
    regex: /\barn:aws[a-z-]*:[a-z0-9-]+:\w*:\d{0,12}:[a-zA-Z0-9:/._+-]+\b/g,
    label: "ARN",
  },
  CLUSTER_ID: {
    regex: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    label: "CLUSTER_ID",
  },
  AWS_ACCOUNT_ID: {
    regex: /\b\d{12}\b/g,
    label: "AWS_ACCOUNT_ID",
    validate: (match, context) => {
      const before = context.slice(Math.max(0, context.indexOf(match) - 40), context.indexOf(match));
      return /account|aws|arn/i.test(before);
    },
  },
  PUBLIC_IPV4: {
    regex: /\b(?:(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\b/g,
    label: "PUBLIC_IPV4",
    validate: (match) => {
      if (match.startsWith("10.") || match.startsWith("192.168.") || match.startsWith("127.")) return false;
      if (match.startsWith("172.")) {
        const second = parseInt(match.split(".")[1], 10);
        if (second >= 16 && second <= 31) return false;
      }
      return true;
    },
  },
  PUBLIC_IPV6: {
    regex: /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b|\b(?:[0-9a-fA-F]{1,4}:){1,7}:|(?:::(?:[0-9a-fA-F]{1,4}:){0,5}[0-9a-fA-F]{1,4})\b/g,
    label: "PUBLIC_IPV6",
    validate: (match) => !match.startsWith("fe80") && !match.startsWith("::1") && match !== "::",
  },
  FQDN: {
    regex: /\b(?:api|console|oauth|apps)[\w.-]*\.(?:openshiftapps\.com|devshift\.net|rhcloud\.com|openshift\.com)\b/gi,
    label: "FQDN",
  },
  S3_BUCKET: {
    regex: /\bs3:\/\/[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]\b/gi,
    label: "S3_BUCKET",
  },
  OAUTH_TOKEN: {
    regex: /\bsha256~[A-Za-z0-9_-]{20,}\b/g,
    label: "OAUTH_TOKEN",
  },
  SUBSCRIPTION_ID: {
    regex: /\b[0-9a-zA-Z]{24,28}\b/g,
    label: "SUBSCRIPTION_ID",
    validate: (match, context) => {
      const before = context.slice(Math.max(0, context.indexOf(match) - 40), context.indexOf(match));
      return /subscription|sub.?id|org.?id/i.test(before);
    },
  },
  PEM_BLOCK: {
    regex: /-----BEGIN [A-Z0-9 ]+-----[\s\S]*?-----END [A-Z0-9 ]+-----/g,
    label: "PEM_BLOCK",
  },
  BASE64_DATA: {
    regex: /[A-Za-z0-9+/]{40,}={0,2}/g,
    label: "BASE64_DATA",
    validate: (match, context) => {
      const idx = context.indexOf(match);
      const before = context.slice(Math.max(0, idx - 80), idx);
      return /base64|data|certificate|tls\.crt|tls\.key|ca\.crt|ca-bundle|secret|token|credential|-----BEGIN/i.test(before);
    },
  },
};

export function runInfraPatterns(text, enabledCategories) {
  const items = [];
  const counters = {};
  let result = text;

  for (const [key, pattern] of Object.entries(PATTERNS)) {
    if (!enabledCategories[key]) continue;

    counters[key] = counters[key] || 0;
    const matches = [];

    let m;
    const re = new RegExp(pattern.regex.source, pattern.regex.flags);
    while ((m = re.exec(result)) !== null) {
      const val = m[0];
      if (pattern.validate && !pattern.validate(val, result)) continue;
      if (matches.includes(val)) continue;
      matches.push(val);
    }

    for (const val of matches) {
      counters[key]++;
      const placeholder = `[${pattern.label}_${counters[key]}]`;
      items.push({ label: pattern.label, original: val, placeholder });
      result = result.replaceAll(val, placeholder);
    }
  }

  return { text: result, items };
}
