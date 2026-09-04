import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { BoardsModule } from './boards/boards.module';
import { ColumnsModule } from './columns/columns.module';
import { validateEnv } from './common/env.validation';
import { CsrfGuard } from './common/guards/csrf.guard';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PrismaModule } from './common/prisma/prisma.module';
import { GatewayModule } from './gateway/gateway.module';
import { HealthController } from './health/health.controller';
import { TasksModule } from './tasks/tasks.module';

@Module({
  imports: [
    // `validate` runs at boot: a missing/duplicated JWT secret or a
    // malformed TTL stops the process with a readable error instead of
    // surfacing as a 500 on the first login.
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    // Generous global default; per-route @Throttle() overrides (e.g. tight
    // limits on /auth/login and /auth/register) land in the auth module.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    PrismaModule,
    AuthModule,
    BoardsModule,
    ColumnsModule,
    TasksModule,
    GatewayModule,
  ],
  controllers: [HealthController],
  providers: [
    // Order matters: rate-limit first (even unauthenticated callers), then
    // reject state-changing requests that carry no custom header (PLAN §5's
    // CSRF defence — cheap, and worth doing before any session lookup), then
    // require a session. BoardAccessGuard/RolesGuard (Phase 5) are per-route,
    // not global — they need a resolved boardId this guard doesn't have.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
