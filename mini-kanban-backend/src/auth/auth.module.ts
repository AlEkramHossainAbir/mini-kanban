import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuditModule } from '../audit/audit.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    PassportModule,
    AuditModule, // refresh-token reuse detection is an audited event (PLAN §5)
    // registerAsync, not register: a plain register() reads process.env while
    // this module is still being *imported*, which is before
    // ConfigModule.forRoot() has loaded .env. That only worked by accident —
    // importing @prisma/client happens to load .env as a side effect. The
    // factory runs at DI time instead, once config is definitely in place.
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: process.env.JWT_ACCESS_SECRET,
        signOptions: { expiresIn: process.env.ACCESS_TOKEN_TTL ?? '15m' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
