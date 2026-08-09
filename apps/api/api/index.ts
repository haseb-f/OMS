import 'dotenv/config';
import type { IncomingMessage, ServerResponse } from 'http';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import express, { type Express } from 'express';
import { AppModule } from '../src/app.module';

/**
 * TASK-062 — Vercel Functions entry point. Mirrors `src/main.ts` exactly
 * (same ValidationPipe, same CORS config) but never calls `app.listen()` —
 * Vercel owns the HTTP server; this only needs to hand back a
 * `(req, res)` handler. No business logic/module/route changes — every
 * existing controller/service is unchanged.
 *
 * Cached across invocations on the same warm instance (Fluid Compute
 * reuses instances), so `NestFactory.create()` — and its Prisma
 * `$connect()` — runs once per instance, not once per request.
 */
async function bootstrap(): Promise<Express> {
  const server = express();
  const app = await NestFactory.create(AppModule, new ExpressAdapter(server));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({
    origin: process.env.WEB_APP_URL ?? 'http://localhost:3001',
    credentials: true,
  });
  await app.init();
  return server;
}

// Cache the in-flight promise (not just the resolved server) so two
// requests racing a cold start don't each bootstrap their own Nest app.
let bootstrapPromise: Promise<Express> | undefined;

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
) {
  if (!bootstrapPromise) {
    bootstrapPromise = bootstrap();
  }
  const server = await bootstrapPromise;
  // Vercel routes https://oms.haseb.org/api/* here (see root vercel.json) so
  // it never collides with apps/web's own page routes under the same
  // domain. Every controller below is still defined exactly as before
  // (e.g. `@Controller('leads')`, not `@Controller('api/leads')`) — strip
  // the "/api" prefix here, at the infra boundary, rather than renaming any
  // existing route.
  if (req.url) {
    req.url = req.url.replace(/^\/api(?=\/|$)/, '') || '/';
  }
  server(req, res);
}
