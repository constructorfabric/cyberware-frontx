/**
 * Percent-encoding / percent-decoding for `param-name` / `param-value`
 * (ADR 0003, "Entry"; FEATURE (navigation-substrate) §3, Grammar Parse step
 * 5.5, Grammar Serialize step 2.3). Internal to the grammar codec — not part
 * of this package's public surface.
 */

/** The `pchar-safe` set (ADR 0003, "Tokens"): stays raw, both directions. */
const RAW_CHAR = /^[A-Za-z0-9\-_.~/:@,!'()*?]$/;

/** Grammar delimiters and the two characters `+`/space, each escaped on write. */
const ENCODE_SPECIAL: Readonly<Record<string, string>> = {
  ';': '%3B',
  '=': '%3D',
  '&': '%26',
  '#': '%23',
  '%': '%25',
  '+': '%2B',
  ' ': '%20',
};

const HEX_PAIR = /^[0-9a-fA-F]{2}$/;

// Module-level, not allocated per call: `encodePercent`/`decodePercent` run
// once per param name/value, potentially many times per parsed URL, and
// neither encoder nor decoder holds any per-call state.
const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

/**
 * Percent-encode a param name or value on write (FEATURE §3, Grammar
 * Serialize, step 2.3): the encode table above takes precedence over
 * `pchar-safe`, every other ASCII `pchar-safe` character stays raw, and
 * every other character (including all non-ASCII) is UTF-8-encoded and
 * percent-escaped byte by byte.
 */
// @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-grammar-serialize:p1:inst-percent-encode
export function encodePercent(value: string): string {
  let out = '';
  for (const char of value) {
    const special = ENCODE_SPECIAL[char];
    if (special !== undefined) {
      out += special;
      continue;
    }
    if (char.length === 1 && RAW_CHAR.test(char)) {
      out += char;
      continue;
    }
    for (const byte of UTF8_ENCODER.encode(char)) {
      out += '%' + byte.toString(16).toUpperCase().padStart(2, '0');
    }
  }
  return out;
}
// @cpt-end:cpt-frontx-algo-routing-navigation-substrate-grammar-serialize:p1:inst-percent-encode

/**
 * Percent-decode a raw param name or value on read (FEATURE §3, Grammar
 * Parse, steps 5.5.3-5.5.4): every `%XX` escape decodes to the byte it
 * encodes, a run of consecutive escapes assembles as one UTF-8 decode, and
 * every other character — a raw `+` included — passes through unchanged, no
 * form-style `+`-to-space decoding. Returns `null` when a `%` is not
 * followed by two hex digits, or an assembled byte run is not valid UTF-8 —
 * both "malformed escape" per the FEATURE, reported by the caller as a
 * dropped, malformed *entry*, never a per-parameter failure.
 */
// @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-grammar-parse:p1:inst-decode-once
export function decodePercent(raw: string): string | null {
  let out = '';
  let bytes: number[] = [];

  const flushBytes = (): boolean => {
    if (bytes.length === 0) {
      return true;
    }
    // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-grammar-parse:p1:inst-if-malformed-escape
    try {
      out += UTF8_DECODER.decode(Uint8Array.from(bytes));
      return true;
    } catch {
      // Invalid-UTF-8 branch of the malformed-escape rule; the malformed-hex
      // branch is the two `return null` statements below, in the caller loop.
      return false;
    } finally {
      bytes = [];
    }
    // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-grammar-parse:p1:inst-if-malformed-escape
  };

  let i = 0;
  while (i < raw.length) {
    const char = raw[i];
    if (char === '%') {
      const hex = raw.slice(i + 1, i + 3);
      // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-grammar-parse:p1:inst-if-malformed-escape
      // Malformed-hex branch of the malformed-escape rule; the invalid-UTF-8
      // branch is `flushBytes`'s own `catch` above.
      if (!HEX_PAIR.test(hex)) {
        return null;
      }
      // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-grammar-parse:p1:inst-if-malformed-escape
      bytes.push(parseInt(hex, 16));
      i += 3;
      continue;
    }
    if (!flushBytes()) {
      return null;
    }
    out += char;
    i += 1;
  }
  if (!flushBytes()) {
    return null;
  }
  return out;
}
// @cpt-end:cpt-frontx-algo-routing-navigation-substrate-grammar-parse:p1:inst-decode-once
