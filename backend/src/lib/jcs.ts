/**
 * Minimal RFC 8785 JSON Canonicalization Scheme (JCS) serializer.
 *
 * The signal agent signs JCS(envelope) with Ed25519; the backend must produce
 * byte-identical canonicalization to verify. Full RFC 8785 compliance for
 * the subset of JSON we emit (strings, numbers, booleans, null, arrays,
 * objects) is implemented here — no external dependency required.
 */

function canonicalNumber(n: number): string {
  if (!Number.isFinite(n)) {
    throw new Error(`JCS: non-finite number is not JSON-serializable: ${n}`);
  }
  if (n === 0) return '0';
  // JSON.stringify already produces a shortest valid ECMA-262 number
  // representation which matches RFC 8785 §3.2.2.3 for the integer and
  // most-decimal cases we emit. For pathological cases (1e21 etc) callers
  // should pre-format as strings.
  return JSON.stringify(n);
}

function canonicalString(s: string): string {
  // JSON.stringify handles escaping per ECMA-404. RFC 8785 §3.2.2.2 mandates
  // the same escape set: control chars, quote, backslash. Node's
  // JSON.stringify matches this.
  return JSON.stringify(s);
}

export function jcs(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return canonicalNumber(value);
  if (typeof value === 'string') return canonicalString(value);
  if (Array.isArray(value)) {
    const items = value.map((v) => jcs(v));
    return `[${items.join(',')}]`;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    // RFC 8785 §3.2.3: sort keys by their UTF-16 code unit values.
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    const parts = keys.map(
      (k) => `${canonicalString(k)}:${jcs(obj[k])}`,
    );
    return `{${parts.join(',')}}`;
  }
  throw new Error(`JCS: unsupported value type: ${typeof value}`);
}
