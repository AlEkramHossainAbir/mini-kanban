import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { HttpExceptionFilter } from './filters/http-exception.filter';

/**
 * Every app-wide concern from the roadmap's Phase 3, in one place.
 *
 * `main.ts` and the e2e suite both call this, so a test exercises the same
 * global prefix, pipes, filters and security middleware the real server runs.
 * Wiring this only in `main.ts` is the classic way to get green e2e tests for
 * routes that 404 in production.
 */
export function configureApp(
  app: NestExpressApplication,
): NestExpressApplication {
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  app.use(helmet());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableCors({
    // Local dev only — production sits behind the Next.js same-origin rewrite
    // proxy (PLAN §1), so this origin is never hit there. The fallback matters:
    // `origin: undefined` makes cors reflect any origin, which PLAN §5 rules
    // out ("explicit allowlist, never `*`").
    origin: process.env.FRONTEND_URL ?? 'http://localhost:3000',
    credentials: true,
  });
  // Without this, the throttler (and any rate-limit-by-IP logic) sees the
  // load balancer's address and rate-limits every user as one client.
  app.set('trust proxy', 1);
  app.enableShutdownHooks();

  return app;
}
