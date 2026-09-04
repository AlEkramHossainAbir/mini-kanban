import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { PublicUser } from './public-user.type';

// Tight throttle on the two credential-guessing routes (PLAN §5) — well
// under the generous 100/min global default set in AppModule.
const AUTH_THROTTLE = { default: { ttl: 60_000, limit: 5 } };

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('register')
  register(@Body() dto: RegisterDto): Promise<PublicUser> {
    return this.authService.register(dto);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @HttpCode(200)
  @Post('login')
  login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PublicUser> {
    return this.authService.login(dto, res);
  }

  @Public()
  @HttpCode(200)
  @Post('refresh')
  refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PublicUser> {
    return this.authService.refresh(req, res);
  }

  // Not @Public(): mk_rt's Path never reaches this route (see AuthService),
  // so the caller has to be identified via mk_at instead — if that's
  // expired the client's 401-interceptor refreshes once and retries this
  // same request (PLAN §1), same as any other authenticated call.
  @HttpCode(200)
  @Post('logout')
  logout(
    @CurrentUser() user: PublicUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ success: true }> {
    return this.authService.logout(user.id, res);
  }

  @Get('me')
  me(@CurrentUser() user: PublicUser): PublicUser {
    return user;
  }

  @Get('ws-ticket')
  wsTicket(@CurrentUser() user: PublicUser) {
    return this.authService.issueWsTicket(user.id);
  }
}
