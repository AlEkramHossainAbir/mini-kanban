import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';

/** The header the frontend attaches to every mutation (src/lib/api.ts). */
export const CSRF_HEADER = 'x-requested-with';

/** Only state-changing verbs are checked; GET/HEAD/OPTIONS stay untouched. */
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * The server half of PLAN §5's CSRF defence.
 *
 * §5 promises that "every mutating request additionally requires a custom
 * header, which forces a CORS preflight". The client half already existed —
 * the frontend sends `X-Requested-With: mini-kanban` — but nothing verified
 * it, so the header bought no protection at all: a mutation sent without it
 * was accepted (confirmed with a live `POST /boards` that returned 201).
 *
 * Why a header check is a real defence rather than security theatre: a browser
 * will not let a cross-origin page attach a custom header to a request without
 * first winning a CORS preflight, and `enableCors` allowlists only
 * FRONTEND_URL. An attacker's page can still make a classic cross-site form
 * POST — forms cannot set headers — but that request now arrives without the
 * header and is rejected here. This layers under `SameSite=Lax`, which already
 * withholds the auth cookies from most cross-site requests; neither control is
 * asked to be sufficient on its own.
 *
 * Presence is what matters, not the value. The security property comes from
 * the header being *unsettable* cross-origin, so pinning an exact string would
 * add brittleness (any other first-party client, curl-based ops scripts) while
 * adding no protection.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    // Skip non-HTTP contexts — WebSocket frames don't carry HTTP headers and
    // the gateway authenticates its handshake with a single-use ws-ticket
    // instead (backend Phase 4/9).
    if (context.getType() !== 'http') {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request>();
    if (!MUTATING_METHODS.has(req.method.toUpperCase())) {
      return true;
    }

    const header = req.headers[CSRF_HEADER];
    const present = Array.isArray(header)
      ? header.some((v) => v.trim().length > 0)
      : typeof header === 'string' && header.trim().length > 0;

    if (!present) {
      throw new ForbiddenException(
        'Missing X-Requested-With header on a state-changing request.',
      );
    }
    return true;
  }
}
