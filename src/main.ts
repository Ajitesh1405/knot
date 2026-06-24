import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
const PORT = 3038;

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Allow the mobile app (and Expo web) to call the /api/mobile endpoints.
  // Native fetch ignores CORS, but this keeps the web build and browsers happy.
  app.enableCors();
  await app.listen(PORT);
  console.log(`→ http://localhost:${PORT}`);
}

bootstrap();
