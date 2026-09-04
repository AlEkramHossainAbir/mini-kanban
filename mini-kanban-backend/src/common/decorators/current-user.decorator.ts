import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { PublicUser } from '../../auth/public-user.type';

/**
 * Pulls `req.user` (attached by JwtStrategy.validate) into a handler
 * parameter, so controllers never touch the raw request object.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PublicUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
