const SECRET_PATTERNS = [
  /(token\s*[=:]\s*)[^\s,;]+/gi,
  /(authorization\s*[=:]\s*)(?:Bearer\s+)?[^\s,;]+/gi,
  /(bearer\s+)[^\s,;]+/gi,
  /(api[_-]?key\s*[=:]\s*)[^\s,;]+/gi,
  /(secret\s*[=:]\s*)[^\s,;]+/gi,
  /(password\s*[=:]\s*)[^\s,;]+/gi
];
export function redactSecrets(value) {
  let output = String(value);
  for (const pattern of SECRET_PATTERNS) output = output.replace(pattern, '$1[REDACTED]');
  return output;
}
