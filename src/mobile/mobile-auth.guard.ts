import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { MobileUserService } from './mobile-user.service';

// Requests that passed the guard carry the resolved userId.
export interface MobileRequest extends Request {
  userId: string;
}

@Injectable()
export class MobileAuthGuard implements CanActivate {
  constructor(private readonly users: MobileUserService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<MobileRequest>();
    const header = req.headers.authorization ?? '';
    const token = header.replace(/^Bearer\s+/i, '').trim();

    const userId = await this.users.resolveToken(token);
    if (!userId) throw new UnauthorizedException('Invalid or missing token.');

    req.userId = userId;
    return true;
  }
}
