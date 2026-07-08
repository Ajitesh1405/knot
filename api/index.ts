// Vercel serverless entrypoint for Knot.
//
// Vercel has no always-on process, so instead of main.ts's `app.listen()`,
// each request is handled by this function. We build the Nest app once per
// warm instance and cache the underlying Express handler across invocations.
//
// We import the ALREADY-COMPILED app from ../dist (produced by `nest build`)
// rather than ../src, because NestJS's dependency injection relies on
// emitted decorator metadata, which tsc produces but Vercel's esbuild does
// not. See vercel.json (buildCommand + includeFiles: dist/**).
import 'reflect-metadata';
import type { IncomingMessage, ServerResponse } from 'http';
import express, { type Express } from 'express';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — resolved at build time from the compiled output.
import { AppModule } from '../dist/app.module';

let cached: Express | null = null;

async function bootstrap(): Promise<Express> {
  if (cached) return cached;

  const expressApp = express();
  const app = await NestFactory.create(
    AppModule,
    new ExpressAdapter(expressApp),
  );

  // Mirror main.ts CORS: allowlist via CORS_ORIGINS, else allow all.
  const origins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: origins.length ? origins : true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // init(), NOT listen() — Vercel owns the socket.
  await app.init();
  cached = expressApp;
  return cached;
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const server = await bootstrap();
  server(req as never, res as never);
}
