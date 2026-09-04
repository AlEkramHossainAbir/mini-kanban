import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Escape hatch for the global JwtAuthGuard (PLAN §4). Routes that must work
 * without a session — register, login, refresh, the health check — carry
 * this marker instead of each hand-rolling its own bypass.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
