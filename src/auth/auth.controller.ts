import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';
import {
  loginSchema,
  parseBody,
  refreshSchema,
  registerSchema,
} from './validation';

// ─────────────────────────────────────────────────────────────────
// User authentication for the mobile / web app. Returns a Bearer
// access token + a refresh token. All feature endpoints under /api/*
// expect `Authorization: Bearer <accessToken>`.
// ─────────────────────────────────────────────────────────────────
@Controller('api/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  register(@Body() body: unknown) {
    const { email, password, name } = parseBody(registerSchema, body);
    return this.auth.register(email, password, name);
  }

  @Post('login')
  @HttpCode(200)
  login(@Body() body: unknown) {
    const { email, password } = parseBody(loginSchema, body);
    return this.auth.login(email, password);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() body: unknown) {
    const { refreshToken } = parseBody(refreshSchema, body);
    return this.auth.refresh(refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser('userId') userId: string) {
    return this.auth.me(userId);
  }
}
