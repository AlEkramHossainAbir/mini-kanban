export const ACCESS_COOKIE = 'mk_at';
export const REFRESH_COOKIE = 'mk_rt';

// Scoped tight on purpose (PLAN §1) — minimizes where the refresh token is
// ever sent, unlike the access cookie which needs to reach every route.
export const REFRESH_COOKIE_PATH = '/api/v1/auth/refresh';

/**
 * A non-secret, deliberately NON-httpOnly presence flag ("1"), scoped to
 * `/` and living exactly as long as `mk_rt`.
 *
 * It exists because `mk_at` expires after ACCESS_TOKEN_TTL (15m) while the
 * session itself lasts REFRESH_TOKEN_TTL (7d), and `mk_rt` is Path-scoped
 * to the refresh route so nothing outside that route can see it. Without a
 * third cookie, neither the Next.js middleware nor client JS can tell
 * "signed out" apart from "access token expired, session still good" — so
 * both treated a 15-minute-old tab as signed out and threw away a valid
 * 7-day session (see mini-kanban-frontend/src/middleware.ts).
 *
 * It carries no authority and no identity: it is only ever read as a hint
 * that a refresh is worth attempting. Every real authorization decision
 * still comes from `mk_at`/`mk_rt` server-side.
 */
export const SESSION_HINT_COOKIE = 'mk_sess';
