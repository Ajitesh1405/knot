import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import type { Update } from 'node-telegram-bot-api';
import { TelegramService } from './telegram.service';

// HTTP surface for Telegram in webhook mode (serverless / Vercel).
//   POST /telegram/webhook  ← Telegram pushes updates here
//   POST /telegram/setup    ← one-time: registers this deployment's webhook
@Controller('telegram')
export class TelegramController {
  private readonly logger = new Logger(TelegramController.name);

  constructor(private readonly telegram: TelegramService) {}

  @Post('webhook')
  @HttpCode(200)
  webhook(
    @Body() update: Update,
    @Headers('x-telegram-bot-api-secret-token') secret?: string,
  ): { ok: true } {
    // If a secret is configured, Telegram echoes it in this header. Reject
    // anything that doesn't match so the public endpoint can't be spoofed.
    const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (expected && secret !== expected) {
      throw new UnauthorizedException('Bad webhook secret');
    }
    // Respond immediately; process the update out of band so Telegram never
    // waits on the LLM (and won't retry/duplicate on a slow response).
    this.telegram.handleUpdate(update);
    return { ok: true };
  }

  @Post('setup')
  @HttpCode(200)
  async setup(
    @Headers('x-telegram-bot-api-secret-token') secret?: string,
  ): Promise<{ ok: true; url: string }> {
    const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (expected && secret !== expected) {
      throw new UnauthorizedException('Bad webhook secret');
    }
    const url = await this.telegram.setWebhook();
    return { ok: true, url };
  }
}
