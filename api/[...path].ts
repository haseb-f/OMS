import type { IncomingMessage, ServerResponse } from "http";
import { NestFactory } from "@nestjs/core";
import { ExpressAdapter } from "@nestjs/platform-express";
import { ValidationPipe } from "@nestjs/common";
import express, { type Express } from "express";
import { AppModule } from "../apps/api/src/app.module";

/**
 * TASK-062 — Vercel Functions entry point. Lives at the repo-root `/api`
 * convention (`[...path].ts` catch-all, so it handles every `/api/*`
 * request with zero extra routing config) — the only location Vercel's
 * zero-config Serverless Functions detection recognizes; a `functions`
 * config entry pointing anywhere else is rejected outright ("doesn't
 * match any Serverless Functions inside the api directory" — confirmed
 * empirically). Because pnpm links `apps/api`'s dependencies only into
 * `apps/api/node_modules` (never hoisted to the repo root by default),
 * every one of `apps/api`'s runtime dependencies is also declared in the
 * root `package.json` purely so pnpm links them into the root
 * `node_modules` too, where this file's `require`/`import` resolution
 * (which only walks upward from `/api/`, never sideways into a sibling
 * package) can actually find them — apps/api's own `package.json` stays
 * the source of truth for versions; nothing here changes what apps/api
 * itself resolves to when it isn't running through this entry point.
 * Mirrors `apps/api/src/main.ts` exactly (same ValidationPipe, same CORS
 * config) but never calls `app.listen()` — Vercel owns the HTTP server;
 * this only needs to hand back a `(req, res)` handler. No business
 * logic/module/route changes — every existing controller/service is
 * unchanged.
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
    origin: process.env.WEB_APP_URL ?? "http://localhost:3001",
    credentials: true,
  });
  await app.init();
  return server;
}

// Cache the in-flight promise (not just the resolved server) so two
// requests racing a cold start don't each bootstrap their own Nest app.
let bootstrapPromise: Promise<Express> | undefined;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (!bootstrapPromise) {
    bootstrapPromise = bootstrap();
  }
  const server = await bootstrapPromise;
  // Vercel routes https://oms.haseb.org/api/* here (the [...path] catch-all
  // convention) so it never collides with apps/web's own page routes under
  // the same domain. Every controller below is still defined exactly as
  // before (e.g. `@Controller('leads')`, not `@Controller('api/leads')`) —
  // strip the "/api" prefix here, at the infra boundary, rather than
  // renaming any existing route.
  if (req.url) {
    req.url = req.url.replace(/^\/api(?=\/|$)/, "") || "/";
  }
  server(req, res);
}
