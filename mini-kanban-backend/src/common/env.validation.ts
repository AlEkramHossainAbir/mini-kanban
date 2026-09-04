import { parseTtlMs } from './ttl.util';

/**
 * Fail-fast validation of the environment, run by `ConfigModule.forRoot({
 * validate })` at boot (backend ROADMAP Phase 13's variables).
 *
 * Without this, a missing `JWT_ACCESS_SECRET` lets the app start happily and
 * only surfaces as a `500` on the first login ("secretOrPrivateKey must have
 * a value") — the kind of failure that costs an hour on a fresh deploy.
 *
 * **Deliberately lenient outside production.** Root ROADMAP Phase 3's
 * acceptance test is `cp .env.example .env && docker compose up --build`
 * with *zero* manual steps, and `.env.example` necessarily ships placeholder
 * secrets. Rejecting those by length or content would break that promise, so
 * the strict checks (length, placeholder rejection) only apply when
 * `NODE_ENV=production`, where a real deploy must not run on placeholders.
 */

const REQUIRED = [
  'DATABASE_URL',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
] as const;
const TTL_VARS = ['ACCESS_TOKEN_TTL', 'REFRESH_TOKEN_TTL'] as const;
const MIN_PROD_SECRET_LENGTH = 32;

// The exact placeholders shipped in .env.example / the root .env.example.
const PLACEHOLDERS = [
  'replace-with-32+-random-bytes',
  'replace-with-a-different-32+-random-bytes',
  'generate-with-openssl-rand-base64-32',
  'generate-a-different-one',
];

export function validateEnv(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const errors: string[] = [];
  const get = (key: string) => {
    const v = config[key];
    return typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
  };

  for (const key of REQUIRED) {
    if (!get(key)) {
      errors.push(`${key} is required but missing or empty`);
    }
  }

  // Reusing one secret for both roles would make the refresh-token HMAC key
  // the same value that signs access tokens (PLAN §1) — they must differ.
  const access = get('JWT_ACCESS_SECRET');
  const refresh = get('JWT_REFRESH_SECRET');
  if (access && refresh && access === refresh) {
    errors.push(
      'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different values',
    );
  }

  for (const key of TTL_VARS) {
    const raw = get(key);
    if (!raw) continue; // optional — the code defaults to 15m / 7d
    try {
      parseTtlMs(raw);
    } catch {
      errors.push(
        `${key} must look like "15m", "7d", "30s" or "12h" (got ${JSON.stringify(raw)})`,
      );
    }
  }

  if (get('NODE_ENV') === 'production') {
    for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
      const val = get(key);
      if (!val) continue; // already reported above
      if (PLACEHOLDERS.includes(val)) {
        errors.push(
          `${key} is still the .env.example placeholder — generate one with \`openssl rand -base64 32\``,
        );
      } else if (val.length < MIN_PROD_SECRET_LENGTH) {
        errors.push(
          `${key} must be at least ${MIN_PROD_SECRET_LENGTH} characters in production (got ${val.length})`,
        );
      }
    }
  }

  if (errors.length) {
    throw new Error(
      `Invalid environment configuration:\n` +
        errors.map((e) => `  - ${e}`).join('\n') +
        `\nSee mini-kanban-backend/.env.example for the full list.`,
    );
  }

  return config;
}
