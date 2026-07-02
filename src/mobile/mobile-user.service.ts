import { Injectable, Logger } from '@nestjs/common';
import { randomBytes, randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

const CODE_TTL_MS = 10 * 60 * 1000; // pairing codes live 10 minutes

@Injectable()
export class MobileUserService {
  private readonly logger = new Logger(MobileUserService.name);

  constructor(private readonly db: PrismaService) {}

  // ─── Issue a short-lived pairing code (called from Telegram /pair) ──
  async createPairCode(userId: string): Promise<{ code: string; expiresAt: Date }> {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = new Date(Date.now() + CODE_TTL_MS);
    // One active code per user: replace any prior one.
    await this.db.mobilePairCode.deleteMany({ where: { userId } });
    await this.db.mobilePairCode.create({ data: { code, userId, expiresAt } });
    this.logger.log(`[${userId}] issued pairing code (expires ${expiresAt.toISOString()})`);
    return { code, expiresAt };
  }

  // ─── Redeem a pairing code → a device bearer token ──────────────────
  async redeemPairCode(
    code: string,
    deviceName?: string,
  ): Promise<{ token: string; userId: string }> {
    const row = await this.db.mobilePairCode.findUnique({ where: { code } });
    if (!row) throw new Error('Invalid pairing code.');
    if (row.expiresAt.getTime() < Date.now()) {
      await this.db.mobilePairCode.delete({ where: { code } }).catch(() => {});
      throw new Error('Pairing code expired. Run /pair again.');
    }

    const token = randomBytes(32).toString('hex');
    await this.db.mobileDevice.create({
      data: { userId: row.userId, token, name: deviceName },
    });
    await this.db.mobilePairCode.delete({ where: { code } }).catch(() => {});
    this.logger.log(`[${row.userId}] device paired (${deviceName ?? 'unnamed'})`);
    return { token, userId: row.userId };
  }

  // ─── Resolve a bearer token → userId (used by the guard) ────────────
  async resolveToken(token: string): Promise<string | null> {
    if (!token) return null;
    const device = await this.db.mobileDevice.findUnique({ where: { token } });
    if (!device) return null;
    // Best-effort last-seen bump; never block the request on it.
    void this.db.mobileDevice
      .update({ where: { token }, data: { lastSeenAt: new Date() } })
      .catch(() => undefined);
    return device.userId;
  }

  // ─── Unpair a device (revoke its token) ─────────────────────────────
  async revoke(token: string): Promise<void> {
    await this.db.mobileDevice.deleteMany({ where: { token } });
  }
}
