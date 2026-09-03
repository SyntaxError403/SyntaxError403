// A working numbers station. The transmission genuinely decodes: the keystream
// is derived from a published seed, so anyone who reads key.md can recover the
// plaintext by hand. Nothing here is decorative.
import { createHash } from "node:crypto";

// 40-symbol alphabet -> two decimal digits (00..39).
// 48 symbols -> two decimal digits (00..47). Extended beyond A-Z so punctuation in
// the ident line (comma, colon, parens, @, |, +, _) survives the round trip instead
// of being silently dropped.
export const ALPHABET = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,/-_:()@|+";

export function toDigits(msg) {
  const up = msg.toUpperCase();
  const out = [];
  for (const ch of up) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) continue; // unrepresentable characters are dropped
    out.push(Math.floor(i / 10), i % 10);
  }
  return out;
}

export function fromDigits(digits) {
  let s = "";
  for (let i = 0; i + 1 < digits.length; i += 2) {
    const idx = digits[i] * 10 + digits[i + 1];
    s += idx < ALPHABET.length ? ALPHABET[idx] : "?";
  }
  return s;
}

/**
 * Keystream: SHA-256(seed || counter), each byte taken mod 10.
 * Bytes >= 250 are rejected so the mod is unbiased over 0..9.
 */
export function keystream(seed, n) {
  const out = [];
  let counter = 0;
  while (out.length < n) {
    const h = createHash("sha256").update(`${seed}|${counter++}`).digest();
    for (const b of h) {
      if (b >= 250) continue;
      out.push(b % 10);
      if (out.length === n) break;
    }
  }
  return out;
}

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

export function encode(msg, seed, groupSize = 5) {
  const p = toDigits(msg);
  // Pad the PLAINTEXT to a whole number of 5-figure groups before adding the
  // keystream. Padding after encryption would decrypt to garbage instead of
  // spaces, leaving a spurious character on the end of every recovered message.
  // 10 keeps the padding aligned to both the group size (5) and the two digits
  // per character, so the tail always decodes to whole spaces.
  // Pad to the least common multiple of the group size and the two digits per
  // character, so the tail lands on both a group boundary and a whole character.
  const unit = (groupSize * 2) / gcd(groupSize, 2);
  while (p.length % unit !== 0) p.push(0);
  const k = keystream(seed, p.length);
  return p.map((d, i) => (d + k[i]) % 10);
}

export function decode(cipher, seed) {
  const k = keystream(seed, cipher.length);
  return fromDigits(cipher.map((d, i) => (d - k[i] + 10) % 10));
}

/** Pad to a whole number of 5-figure groups, then split. */
export function groups(digits, size = 5) {
  const padded = [...digits];
  while (padded.length % size !== 0) padded.push(0);
  const g = [];
  for (let i = 0; i < padded.length; i += size) g.push(padded.slice(i, i + size).join(""));
  return g;
}
