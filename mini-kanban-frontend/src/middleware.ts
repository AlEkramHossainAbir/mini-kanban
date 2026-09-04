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
 */
export function middleware(req: NextRequest) {
  const hasSession = req.cookies.has("mk_at");
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
