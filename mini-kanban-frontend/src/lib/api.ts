/**
 * The single fetch wrapper every call in the app goes through
 * (frontend ROADMAP Phase 3).
 *
 * Three responsibilities, all of them security- or correctness-load-bearing:
 *   1. `credentials: "include"` so the httpOnly auth cookies ride along.
 *   2. `X-Requested-With` on mutations — PLAN §5's CSRF defence. A custom
 *      header cannot be set by a cross-site form post, and forces a preflight
 *      that a non-allowlisted origin fails before the request reaches Nest.
 *   3. The 401 → refresh-once → retry dance (PLAN §1).
 *
 * Paths are always RELATIVE ("/api/v1/..."), never absolute: the browser must
 * only ever see one origin, which is what keeps SameSite=Lax cookies working
 * (PLAN §1, and the Phase 2 rewrite that implements it).
 */

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }

  /** The graded optimistic-concurrency conflict on task move (PLAN §3). */
  get isConflict(): boolean {
    return this.status === 409;
  }
}

const MUTATING = new Set(["POST", "PATCH", "PUT", "DELETE"]);

/** Nest's exception filter shape: { statusCode, path, timestamp, message }. */
function messageFrom(body: unknown, status: number): string {
  if (body && typeof body === "object" && "message" in body) {
    const m = (body as { message: unknown }).message;
    if (typeof m === "string") return m;
    if (Array.isArray(m) && m.length) return String(m[0]);
  }
  return `Request failed with ${status}`;
}

async function parse(res: Response): Promise<unknown> {
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * A single shared in-flight refresh promise.
 *
 * Without this, a board view that fires several queries at once turns one
 * expired access token into N concurrent POSTs to /auth/refresh. That is not
 * merely wasteful: refresh tokens ROTATE and the backend treats reuse of an
 * already-revoked token as theft and revokes the whole family (backend Phase
 * 4). A stampede would therefore log the user out. Every caller awaits the
 * same promise instead.
 */
let refreshInFlight: Promise<boolean> | null = null;

function refreshOnce(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = fetch("/api/v1/auth/refresh", {
      method: "POST",
      credentials: "include",
      headers: { "X-Requested-With": "mini-kanban" },
    })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => {
        // Cleared only after settling, so late callers join this attempt
        // rather than starting a second one.
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

/**
 * Is there a session worth refreshing? Reads `mk_sess`, the non-httpOnly,
 * non-secret presence flag the backend sets alongside the auth cookies and
 * expires with `mk_rt`, not `mk_at`.
 *
 * This is what lets a `skipAuthRetry` caller (`/auth/me` on first paint)
 * still recover an expired access token. Without it, `mk_at`'s 15-minute
 * lifetime made the app shell render signed-out for the remaining ~6 days
 * 23 hours of a valid session. It is a hint only — never authorization; the
 * refresh still has to succeed server-side against the real `mk_rt`.
 */
function hasSessionHint(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie
    .split(";")
    .some((c) => c.trim().startsWith("mk_sess="));
}

function redirectToLogin(): void {
  if (typeof window === "undefined") return;
  const { pathname, search } = window.location;
  if (pathname === "/login" || pathname === "/register") return;
  const next = encodeURIComponent(`${pathname}${search}`);
  window.location.assign(`/login?next=${next}`);
}

export interface ApiOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  /** Opt out of the refresh/redirect dance — used by /auth/me on first paint,
   *  where a 401 is an ordinary "not logged in" answer, not a session that
   *  just expired. */
  skipAuthRetry?: boolean;
}

export async function api<T = unknown>(
  path: string,
  options: ApiOptions = {}
): Promise<T> {
  const { body, skipAuthRetry, headers, ...rest } = options;
  const method = (rest.method ?? "GET").toUpperCase();

  const send = () =>
    fetch(path, {
      ...rest,
      method,
      credentials: "include",
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        // PLAN §5: the CSRF header goes on every mutating request.
        ...(MUTATING.has(method) ? { "X-Requested-With": "mini-kanban" } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  let res = await send();

  if (res.status === 401) {
    if (!skipAuthRetry) {
      const refreshed = await refreshOnce();
      if (refreshed) {
        res = await send();
      }
      if (!refreshed || res.status === 401) {
        redirectToLogin();
        throw new ApiError(401, await parse(res), "Session expired");
      }
    } else if (hasSessionHint()) {
      // A `skipAuthRetry` caller still gets ONE silent refresh when a
      // session plausibly exists — it just never redirects, because for
      // these callers a 401 is an ordinary "not logged in" answer rather
      // than a session that expired mid-use. The `mk_sess` guard is what
      // keeps a genuinely signed-out visitor from firing a pointless
      // refresh on every public page load.
      if (await refreshOnce()) {
        res = await send();
      }
    }
  }

  const parsed = await parse(res);
  if (!res.ok) {
    throw new ApiError(res.status, parsed, messageFrom(parsed, res.status));
  }
  return parsed as T;
}

export const get = <T>(path: string, o?: ApiOptions) =>
  api<T>(path, { ...o, method: "GET" });
export const post = <T>(path: string, body?: unknown, o?: ApiOptions) =>
  api<T>(path, { ...o, method: "POST", body });
export const patch = <T>(path: string, body?: unknown, o?: ApiOptions) =>
  api<T>(path, { ...o, method: "PATCH", body });
export const del = <T>(path: string, o?: ApiOptions) =>
  api<T>(path, { ...o, method: "DELETE" });
