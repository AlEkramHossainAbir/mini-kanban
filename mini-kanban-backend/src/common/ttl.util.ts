const UNIT_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/**
 * Parses the ACCESS_TOKEN_TTL / REFRESH_TOKEN_TTL env strings ("15m", "7d")
 * into milliseconds for cookie `maxAge`. `@nestjs/jwt` accepts the same
 * strings directly for `signOptions.expiresIn`, so this is only needed on
 * the cookie side.
 */
export function parseTtlMs(ttl: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(ttl.trim());
  if (!match) {
    throw new Error(`Invalid TTL string: "${ttl}" (expected e.g. "15m", "7d")`);
  }
  const [, amount, unit] = match;
  return Number(amount) * UNIT_MS[unit];
}
