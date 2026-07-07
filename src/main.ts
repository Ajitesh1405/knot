import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

const PORT = Number(process.env.PORT ?? 3038);

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Mobile apps and browser front-ends call this API cross-origin.
  // CORS_ORIGINS is a comma-separated allowlist; unset = allow all
  // (fine for native apps / dev, tighten for a web front-end in prod).
  const origins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: origins.length ? origins : true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  if (!process.env.JWT_SECRET) {
    new Logger('Bootstrap').warn(
      'JWT_SECRET is not set — /api/auth routes will fail until it is configured.',
    );
  }

  await app.listen(PORT);
  console.log(`→ http://localhost:${PORT}`);
}

bootstrap();
