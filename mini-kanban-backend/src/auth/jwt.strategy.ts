import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Request } from 'express';
import { Strategy } from 'passport-jwt';
import { PrismaService } from '../common/prisma/prisma.service';
import { ACCESS_COOKIE } from './auth.constants';
import { PublicUser } from './public-user.type';

interface AccessTokenPayload {
  sub: string;
  email: string;
}

/**
 * Validates `mk_at`. Board roles are deliberately *not* trusted from the
 * token payload (PLAN §1) — this only establishes who the caller is;
 * BoardAccessGuard (Phase 5) checks membership fresh from the database.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: (req: Request) => req?.cookies?.[ACCESS_COOKIE] ?? null,
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_ACCESS_SECRET,
    });
  }

  async validate(payload: AccessTokenPayload): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, name: true },
    });
    if (!user) {
      // Token is structurally valid but the account behind it is gone.
      throw new UnauthorizedException();
    }
    return user;
  }
}
