import { validateEnv } from './env.validation';

const ok = {
  DATABASE_URL:
    'postgresql://kanban:kanban@localhost:5432/kanban?schema=public',
  JWT_ACCESS_SECRET: 'a'.repeat(44),
  JWT_REFRESH_SECRET: 'b'.repeat(44),
  ACCESS_TOKEN_TTL: '15m',
  REFRESH_TOKEN_TTL: '7d',
  NODE_ENV: 'development',
};

describe('validateEnv', () => {
  it('accepts a well-formed environment', () => {
    expect(() => validateEnv({ ...ok })).not.toThrow();
  });

  it.each(['DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'])(
    'rejects a missing %s',
    (key) => {
      const cfg = { ...ok };
      delete (cfg as Record<string, unknown>)[key];
      expect(() => validateEnv(cfg)).toThrow(new RegExp(`${key} is required`));
    },
  );

  it('rejects an empty (whitespace-only) required var', () => {
    expect(() => validateEnv({ ...ok, JWT_ACCESS_SECRET: '   ' })).toThrow(
      /JWT_ACCESS_SECRET is required/,
    );
  });

  it('rejects the two JWT secrets being identical', () => {
    const same = 'c'.repeat(44);
    expect(() =>
      validateEnv({ ...ok, JWT_ACCESS_SECRET: same, JWT_REFRESH_SECRET: same }),
    ).toThrow(/must be different values/);
  });

  it('rejects a malformed TTL', () => {
    expect(() =>
      validateEnv({ ...ok, ACCESS_TOKEN_TTL: '15 minutes' }),
    ).toThrow(/ACCESS_TOKEN_TTL must look like/);
  });

  it('allows the TTLs to be absent (the code defaults them)', () => {
    const cfg = { ...ok };
    delete (cfg as Record<string, unknown>).ACCESS_TOKEN_TTL;
    delete (cfg as Record<string, unknown>).REFRESH_TOKEN_TTL;
    expect(() => validateEnv(cfg)).not.toThrow();
  });

  it('reports every problem at once, not just the first', () => {
    expect(() => validateEnv({ NODE_ENV: 'development' })).toThrow(
      /DATABASE_URL[\s\S]*JWT_ACCESS_SECRET[\s\S]*JWT_REFRESH_SECRET/,
    );
  });

  describe('outside production it stays lenient', () => {
    // Root ROADMAP Phase 3 promises `cp .env.example .env && docker compose up`
    // works with zero manual steps — placeholder secrets must not block boot.
    it('accepts .env.example placeholders', () => {
      expect(() =>
        validateEnv({
          ...ok,
          JWT_ACCESS_SECRET: 'generate-with-openssl-rand-base64-32',
          JWT_REFRESH_SECRET: 'generate-a-different-one',
        }),
      ).not.toThrow();
    });

    it('accepts a short secret', () => {
      expect(() =>
        validateEnv({
          ...ok,
          JWT_ACCESS_SECRET: 'short',
          JWT_REFRESH_SECRET: 'other',
        }),
      ).not.toThrow();
    });
  });

  describe('in production it gets strict', () => {
    const prod = { ...ok, NODE_ENV: 'production' };

    it('rejects a leftover placeholder secret', () => {
      expect(() =>
        validateEnv({
          ...prod,
          JWT_ACCESS_SECRET: 'generate-with-openssl-rand-base64-32',
        }),
      ).toThrow(/still the .env.example placeholder/);
    });

    it('rejects a too-short secret', () => {
      expect(() =>
        validateEnv({ ...prod, JWT_ACCESS_SECRET: 'tooshort' }),
      ).toThrow(/at least 32 characters in production/);
    });

    it('accepts real generated secrets', () => {
      expect(() => validateEnv({ ...prod })).not.toThrow();
    });
  });
});
