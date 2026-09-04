import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { BoardsModule } from './boards/boards.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PrismaModule } from './common/prisma/prisma.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Generous global default; per-route @Throttle() overrides (e.g. tight
    // limits on /auth/login and /auth/register) land in the auth module.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    PrismaModule,
    AuthModule,
    BoardsModule,
  ],
  controllers: [HealthController],
  providers: [
    // Order matters: rate-limit first (even unauthenticated callers), then
    // require a session. BoardAccessGuard/RolesGuard (Phase 5) are per-route,
    // not global — they need a resolved boardId this guard doesn't have.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
