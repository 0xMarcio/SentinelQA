import { createHash, timingSafeEqual } from "node:crypto";

export function hashApiToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function verifyApiToken(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashApiToken(token));
  const expected = Buffer.from(expectedHash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

