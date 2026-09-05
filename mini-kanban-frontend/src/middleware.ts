import { NextResponse, type NextRequest } from "next/server";

/**
 * Bounces signed-out visitors off /boards/* before a protected page renders.
 *
 * PRESENCE ONLY, deliberately (PLAN §4). This does not verify the JWT, and it
 * must not be read as authorization: the cookie is httpOnly and unreadable
 * here anyway, and every board/column/task route is still guarded server-side
 * by JwtAuthGuard → BoardAccessGuard → RolesGuard. A forged mk_at cookie gets
 * past this redirect and then fails at the API, which is the layer that counts.
 * The value here is purely UX — no flash of an empty board for a signed-out
 * visitor.
 *
 * `mk_sess` is checked alongside `mk_at`, and dropping it is a real bug, not
 * belt-and-braces. `mk_at`'s cookie lifetime is ACCESS_TOKEN_TTL (15m) while
 * the session lasts REFRESH_TOKEN_TTL (7d); `mk_rt` is Path-scoped to
 * `/api/v1/auth/refresh` so it is never sent here. Gating on `mk_at` alone
 * therefore bounced every user to /login after 15 idle minutes and made them
 * retype their password, while a perfectly valid refresh token sat unused —
 * the entire rotation design in PLAN §1 was unreachable from a navigation.
 * `mk_sess` is the non-secret presence flag that closes that gap; letting the
 * request through hands the 401 to lib/api.ts, which refreshes and retries.
 */
export function middleware(req: NextRequest) {
  const hasSession = req.cookies.has("mk_at") || req.cookies.has("mk_sess");
  const { pathname, search } = req.nextUrl;

  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(`${pathname}${search}`)}`;
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Only the protected area. /login and /register must stay reachable, and
  // /api/v1/* must never be intercepted — it belongs to the rewrite proxy.
  matcher: ["/boards/:path*"],
};
