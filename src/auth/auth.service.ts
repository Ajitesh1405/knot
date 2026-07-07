import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  hashPassword,
  signJwt,
  verifyJwt,
  verifyPassword,
} from './crypto.util';

// TTLs (seconds). Access tokens are short-lived; refresh tokens long.
const ACCESS_TTL = Number(process.env.JWT_ACCESS_TTL ?? 60 * 60); // 1h
const REFRESH_TTL = Number(process.env.JWT_REFRESH_TTL ?? 60 * 60 * 24 * 30); // 30d

// The rest of the system keys off a string `userId`. Mobile accounts
// live in the `usr-` namespace (Telegram users are `tg-`).
export const USER_PREFIX = 'usr-';
export const toUserId = (id: string) => `${USER_PREFIX}${id}`;
export const fromUserId = (userId: string) =>
  userId.startsWith(USER_PREFIX) ? userId.slice(USER_PREFIX.length) : userId;

export interface AuthUser {
  userId: string;
  email: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly db: PrismaService) {}

  private get secret(): string {
    const s = process.env.JWT_SECRET;
    if (!s || s.length < 16) {
      throw new Error(
        'JWT_SECRET is missing or too short — set a long random value in .env',
      );
    }
    return s;
  }

  // ─── Registration ──────────────────────────────────────────────
  async register(email: string, password: string, name?: string) {
    const normalized = email.trim().toLowerCase();
    const existing = await this.db.user.findUnique({
      where: { email: normalized },
    });
    if (existing) throw new ConflictException('Email already registered');

    const user = await this.db.user.create({
      data: {
        email: normalized,
        name: name ?? null,
        passwordHash: hashPassword(password),
      },
    });
    this.logger.log(`Registered user ${toUserId(user.id)} (${normalized})`);
    return this.issueTokens(user);
  }

  // ─── Login ─────────────────────────────────────────────────────
  async login(email: string, password: string) {
    const normalized = email.trim().toLowerCase();
    const user = await this.db.user.findUnique({
      where: { email: normalized },
    });
    // Same error for "no such user" and "bad password" (no enumeration).
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return this.issueTokens(user);
  }

  // ─── Refresh ───────────────────────────────────────────────────
  async refresh(refreshToken: string) {
    let payload;
    try {
      payload = verifyJwt(refreshToken, this.secret);
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    if (payload.typ !== 'refresh') {
      throw new UnauthorizedException('Not a refresh token');
    }
    const user = await this.db.user.findUnique({
      where: { id: fromUserId(payload.sub) },
    });
    if (!user) throw new UnauthorizedException('User no longer exists');
    return this.issueTokens(user);
  }

  // ─── Verify an access token (used by the guard) ────────────────
  verifyAccess(token: string): AuthUser {
    const payload = verifyJwt(token, this.secret);
    if (payload.typ !== 'access') throw new Error('Not an access token');
    return { userId: payload.sub, email: payload.email };
  }

  // ─── Current user profile ──────────────────────────────────────
  async me(userId: string) {
    const user = await this.db.user.findUnique({
      where: { id: fromUserId(userId) },
    });
    if (!user) throw new UnauthorizedException('User no longer exists');
    return this.publicUser(user);
  }

  // ─── Helpers ───────────────────────────────────────────────────
  private issueTokens(user: {
    id: string;
    email: string;
    name: string | null;
    createdAt: Date;
  }) {
    const sub = toUserId(user.id);
    return {
      accessToken: signJwt(
        { sub, email: user.email, typ: 'access' },
        this.secret,
        ACCESS_TTL,
      ),
      refreshToken: signJwt(
        { sub, email: user.email, typ: 'refresh' },
        this.secret,
        REFRESH_TTL,
      ),
      tokenType: 'Bearer',
      expiresIn: ACCESS_TTL,
      user: this.publicUser(user),
    };
  }

  private publicUser(user: {
    id: string;
    email: string;
    name: string | null;
    createdAt: Date;
  }) {
    return {
      id: toUserId(user.id),
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
    };
  }
}
