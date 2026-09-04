import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHmac, randomBytes } from 'crypto';
import { Request, Response } from 'express';
import { PrismaService } from '../common/prisma/prisma.service';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  REFRESH_COOKIE_PATH,
} from './auth.constants';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { PublicUser } from './public-user.type';
import { parseTtlMs } from '../common/ttl.util';

const BCRYPT_COST = 12;
const WS_TICKET_TTL_MS = 30_000;

interface WsTicketEntry {
  userId: string;
  expiresAt: number;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  // In-memory, single-instance store for short-lived WS handshake tickets
  // (PLAN §3/§9 — the ws-ticket exists because mk_at is httpOnly and can't
  // be read by client JS to hand to Socket.IO). Fine at MVP scope: a single
  // Nest instance, no cross-instance state to share (§7 covers Redis later).
  private readonly wsTickets = new Map<string, WsTicketEntry>();

  async register(dto: RegisterDto): Promise<PublicUser> {
    const email = dto.email.toLowerCase();
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_COST);

    try {
      return await this.prisma.user.create({
        data: { email, passwordHash, name: dto.name },
        select: { id: true, email: true, name: true },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('Email already registered');
      }
      throw err;
    }
  }

  async login(dto: LoginDto, res: Response): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    // Same message either way — don't tell an attacker which half was wrong.
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.issueSession(user.id, user.email, res);
    return { id: user.id, email: user.email, name: user.name };
  }

  async refresh(req: Request, res: Response): Promise<PublicUser> {
    const presented = req.cookies?.[REFRESH_COOKIE];
    if (!presented) {
      throw new UnauthorizedException();
    }

    const tokenHash = this.hashRefreshToken(presented);
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!existing) {
      throw new UnauthorizedException();
    }

    if (existing.revokedAt || existing.expiresAt < new Date()) {
      // A revoked (already-rotated) token being presented again is the
      // reuse-detection signal from PLAN §1: someone else has this token,
      // so the whole family is burned, not just this one row.
      await this.prisma.refreshToken.updateMany({
        where: { userId: existing.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      this.clearAuthCookies(res);
      throw new UnauthorizedException('Session revoked');
    }

    // Rotate: the presented row is retired, a new one takes its place,
    // linked via replacedByTokenId — both inside one transaction so a crash
    // mid-rotation can never leave two simultaneously-live tokens.
    const newRefreshToken = randomBytes(32).toString('hex');
    const newExpiresAt = new Date(
      Date.now() + parseTtlMs(process.env.REFRESH_TOKEN_TTL ?? '7d'),
    );
    await this.prisma.$transaction(async (tx) => {
      const newRow = await tx.refreshToken.create({
        data: {
          tokenHash: this.hashRefreshToken(newRefreshToken),
          userId: existing.userId,
          expiresAt: newExpiresAt,
        },
      });
      await tx.refreshToken.update({
        where: { id: existing.id },
        data: { revokedAt: new Date(), replacedByTokenId: newRow.id },
      });
    });

    const accessToken = await this.signAccessToken(
      existing.user.id,
      existing.user.email,
    );
    this.setAuthCookies(res, accessToken, newRefreshToken);

    return {
      id: existing.user.id,
      email: existing.user.email,
      name: existing.user.name,
    };
  }

  async logout(userId: string, res: Response): Promise<{ success: true }> {
    // mk_rt's Path is scoped to /api/v1/auth/refresh only (PLAN §1), so it
    // structurally never reaches this route — there's no refresh cookie
    // here to look up a single row by. Instead this revokes every active
    // refresh token for the authenticated caller (identified via mk_at,
    // which *is* sent here). Real server-side revocation either way: a
    // copied refresh token doesn't stay valid until natural expiry just
    // because the browser forgot it.
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    this.clearAuthCookies(res);
    return { success: true };
  }

  issueWsTicket(userId: string): { ticket: string; expiresIn: number } {
    this.sweepExpiredWsTickets();
    const ticket = randomBytes(24).toString('hex');
    this.wsTickets.set(ticket, {
      userId,
      expiresAt: Date.now() + WS_TICKET_TTL_MS,
    });
    return { ticket, expiresIn: WS_TICKET_TTL_MS / 1000 };
  }

  /**
   * Single-use: consumed (and discarded either way) by the gateway
   * handshake wired up in backend Phase 9. Not called from anywhere yet.
   */
  consumeWsTicket(ticket: string): string | null {
    const entry = this.wsTickets.get(ticket);
    this.wsTickets.delete(ticket);
    if (!entry || entry.expiresAt < Date.now()) {
      return null;
    }
    return entry.userId;
  }

  private sweepExpiredWsTickets(): void {
    const now = Date.now();
    for (const [ticket, entry] of this.wsTickets) {
      if (entry.expiresAt < now) {
        this.wsTickets.delete(ticket);
      }
    }
  }

  private async issueSession(
    userId: string,
    email: string,
    res: Response,
  ): Promise<void> {
    const accessToken = await this.signAccessToken(userId, email);
    const refreshToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(
      Date.now() + parseTtlMs(process.env.REFRESH_TOKEN_TTL ?? '7d'),
    );

    await this.prisma.refreshToken.create({
      data: {
        tokenHash: this.hashRefreshToken(refreshToken),
        userId,
        expiresAt,
      },
    });

    this.setAuthCookies(res, accessToken, refreshToken);
  }

  private signAccessToken(userId: string, email: string): Promise<string> {
    return this.jwtService.signAsync({ sub: userId, email });
  }

  // The refresh token itself is an opaque random value, never a JWT
  // (PLAN §1) — JWT_REFRESH_SECRET is used here as the HMAC key so the
  // stored hash is keyed, not a bare, invertible-by-rainbow-table SHA-256.
  private hashRefreshToken(token: string): string {
    return createHmac('sha256', process.env.JWT_REFRESH_SECRET as string)
      .update(token)
      .digest('hex');
  }

  private setAuthCookies(
    res: Response,
    accessToken: string,
    refreshToken: string,
  ): void {
    const secure = process.env.NODE_ENV === 'production';
    res.cookie(ACCESS_COOKIE, accessToken, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      maxAge: parseTtlMs(process.env.ACCESS_TOKEN_TTL ?? '15m'),
    });
    res.cookie(REFRESH_COOKIE, refreshToken, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: REFRESH_COOKIE_PATH,
      maxAge: parseTtlMs(process.env.REFRESH_TOKEN_TTL ?? '7d'),
    });
  }

  private clearAuthCookies(res: Response): void {
    const secure = process.env.NODE_ENV === 'production';
    // clearCookie must be called with the same path/sameSite the cookie was
    // set with, or the browser won't recognize it as the same cookie.
    res.clearCookie(ACCESS_COOKIE, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
    });
    res.clearCookie(REFRESH_COOKIE, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: REFRESH_COOKIE_PATH,
    });
  }
}
