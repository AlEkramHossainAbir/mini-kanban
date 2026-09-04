export const ACCESS_COOKIE = 'mk_at';
export const REFRESH_COOKIE = 'mk_rt';

// Scoped tight on purpose (PLAN §1) — minimizes where the refresh token is
// ever sent, unlike the access cookie which needs to reach every route.
export const REFRESH_COOKIE_PATH = '/api/v1/auth/refresh';
