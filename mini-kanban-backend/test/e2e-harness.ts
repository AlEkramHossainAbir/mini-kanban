import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/common/configure-app';
import { PrismaService } from '../src/common/prisma/prisma.service';

export interface E2eContext {
  app: INestApplication;
  prisma: PrismaService;
  server: App;
  /** An anonymous agent with its own rate-limit bucket (see `client()` notes). */
  client(): ReturnType<typeof request.agent>;
  /** Registers a fresh user, logs them in, and hands back a cookie-bearing agent. */
  signUp(): Promise<E2eUser>;
  /** Deletes every user this context created — cascades to their boards. */
  close(): Promise<void>;
}

export interface E2eUser {
  id: string;
  email: string;
  password: string;
  /** Carries mk_at / mk_rt across requests, respecting each cookie's Path. */
  agent: ReturnType<typeof request.agent>;
}

export const E2E_PASSWORD = 'Passw0rd!e2e';

/**
 * Boots the real AppModule through the same `configureApp()` that `main.ts`
 * uses — global prefix, cookie-parser, helmet, the whitelist ValidationPipe,
 * the rate limiter and the guard chain are all live, so these specs exercise
 * the app as it actually ships rather than a stripped-down testing module.
 *
 * Nothing is stubbed out, including the throttler. `/auth/login` allows only
 * 5 hits/min *per client IP*, and every request here would otherwise arrive
 * from 127.0.0.1 — so each agent carries its own `X-Forwarded-For` instead,
 * which `configureApp()`'s `trust proxy` turns into a distinct `req.ip` and
 * therefore a distinct bucket. That keeps results independent of how many
 * users a spec creates while leaving the real guard in the path (and quietly
 * proves `trust proxy` works, without which the limiter would see the load
 * balancer's IP and throttle every user as one client).
 */
export async function createE2eContext(): Promise<E2eContext> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = configureApp(
    moduleRef.createNestApplication<NestExpressApplication>(),
  );
  await app.init();

  const prisma = app.get(PrismaService);
  const server = app.getHttpServer() as App;
  const createdUserIds: string[] = [];

  let clientCount = 0;
  const nextClient = () => {
    // A unique, non-routable source IP per agent — one rate-limit bucket each.
    clientCount += 1;
    const agent = request.agent(server);
    agent.set('X-Forwarded-For', `203.0.113.${clientCount % 254}`);
    return agent;
  };

  return {
    app,
    prisma,
    server,
    client: nextClient,

    async signUp(): Promise<E2eUser> {
      // Unique per call: these specs run against the same database as the
      // rest of local dev, so nothing may collide on User.email's unique
      // index or depend on a pre-seeded row.
      const email = `e2e-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
      const agent = nextClient();

      const registered = await agent
        .post('/api/v1/auth/register')
        .send({ email, password: E2E_PASSWORD, name: 'E2E User' })
        .expect(201);

      await agent
        .post('/api/v1/auth/login')
        .send({ email, password: E2E_PASSWORD })
        .expect(200);

      createdUserIds.push(registered.body.id);
      return { id: registered.body.id, email, password: E2E_PASSWORD, agent };
    },

    async close(): Promise<void> {
      if (createdUserIds.length > 0) {
        // AuditLog.userId is onDelete: SetNull, so its rows would outlive the
        // users and pile up in the dev database — cleared explicitly. Boards,
        // columns, tasks, memberships and refresh tokens all cascade.
        await prisma.auditLog.deleteMany({
          where: { userId: { in: createdUserIds } },
        });
        await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      }
      await app.close();
    },
  };
}

/** Reads one cookie's raw `Set-Cookie` string off a response, if present. */
export function setCookie(
  res: request.Response,
  name: string,
): string | undefined {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  return raw?.find((c) => c.startsWith(`${name}=`));
}

/** The value half of a `Set-Cookie` string — empty when the cookie is cleared. */
export function cookieValue(setCookieString: string): string {
  return setCookieString.split(';')[0].split('=')[1] ?? '';
}
