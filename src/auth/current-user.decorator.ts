import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthUser } from './auth.service';
import { AuthedRequest } from './jwt-auth.guard';

// `@CurrentUser()` → full AuthUser; `@CurrentUser('userId')` → one field.
// Only valid on routes behind JwtAuthGuard.
export const CurrentUser = createParamDecorator(
  (field: keyof AuthUser | undefined, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const user = req.user;
    return field ? user?.[field] : user;
  },
);
