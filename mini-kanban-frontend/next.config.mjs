/**
 * Frontend ROADMAP Phase 2 — the same-origin proxy.
 *
 * PLAN §1: the browser must only ever see ONE origin. `SameSite=Lax` cookies are
 * not sent on cross-site requests, so pointing the browser straight at a split
 * API host (frontend on Vercel, API on Railway) works on localhost and then
 * silently breaks login on the deployed demo. Rewriting `/api/v1/*` through Next
 * keeps the auth cookies first-party and removes credentialed cross-origin CORS
 * from production altogether.
 *
 * This is ESM (`next.config.mjs`, as create-next-app scaffolded it), not the
 * CommonJS `next.config.js` the roadmap snippet shows — same config, and keeping
 * .mjs avoids Next warning about two competing config files.
 *
 * It exports the *function* form because that is the only way to learn the build
 * phase: `process.env.NEXT_PHASE` is undefined when Next 14 loads this file
 * (probed, not assumed), while the function receives the phase as its argument.
 */

const PHASE_PRODUCTION_BUILD = "phase-production-build";

// Server-side only, deliberately NOT NEXT_PUBLIC_*: the rewrite is resolved by the
// Next server, so the API's real address never reaches the client bundle.
// Verified — a sentinel value used here does NOT appear anywhere in .next/static.
//   local dev → http://localhost:4000
//   docker    → http://backend:4000   (the compose service name)
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:4000";

/**
 * BACKEND_URL IS READ AT BUILD TIME, NOT AT RUN TIME. This is the opposite of
 * what the variable's name suggests, and it is the easiest single way to break
 * root ROADMAP Phase 3's "zero manual steps" Docker acceptance.
 *
 * Next serialises rewrite destinations into `.next/routes-manifest.json` during
 * `next build`; the standalone server then serves from that manifest and never
 * re-reads this value. Verified empirically, not assumed: built with a sentinel
 * `http://baked-at-build-time:9999`, then started with BACKEND_URL=localhost:4000
 * — the manifest kept the sentinel and `/api/v1/health` returned 500, because the
 * runtime value was ignored.
 *
 * Consequence for Phase 12 / root Phase 3: the frontend image must receive
 * BACKEND_URL as a **build** ARG (`ARG BACKEND_URL` + `ENV BACKEND_URL=...` before
 * `npm run build`). Supplying it only through compose's `env_file:` at run time
 * bakes `http://localhost:4000` into the image, and every API call inside the
 * container 502s against a backend that isn't there.
 *
 * The check warns rather than throws on purpose: the roadmap's Phase 12 Dockerfile
 * currently runs `npm run build` with no environment, and a hard failure would
 * stop the image building at all.
 */
export default function nextConfig(phase) {
  if (phase === PHASE_PRODUCTION_BUILD && !process.env.BACKEND_URL) {
    console.warn(
      "\n[next.config] WARNING: building without BACKEND_URL set.\n" +
        `  The /api/v1 rewrite is being baked as "${BACKEND_URL}" and CANNOT be\n` +
        "  changed at run time. If this build becomes the Docker image, pass\n" +
        "  BACKEND_URL as a build ARG (http://backend:4000) instead.\n"
    );
  }

  /** @type {import('next').NextConfig} */
  return {
    // Required by the Phase 12 Dockerfile, which runs `node server.js` from
    // .next/standalone rather than `next start`.
    output: "standalone",

    async rewrites() {
      return [
        {
          source: "/api/v1/:path*",
          destination: `${BACKEND_URL}/api/v1/:path*`,
        },
      ];
    },
  };
}
