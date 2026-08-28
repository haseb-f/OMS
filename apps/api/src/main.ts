import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';
import { formatValidationErrors } from './common/errors/format-validation-errors';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      exceptionFactory: (errors) =>
        new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed.',
          fields: formatValidationErrors(errors),
        }),
    }),
  );
  app.enableCors({
    origin: process.env.WEB_APP_URL ?? 'http://localhost:3001',
    credentials: true,
    // Every browser request from apps/web carries the same fixed header set
    // (Authorization/Content-Type/X-Company-Id/X-Branch-Id), so one
    // preflight per (method, headers) pair is enough — without this the
    // browser re-issues a full OPTIONS round trip before every single GET/
    // POST/PATCH, doubling real request count app-wide. 86400s = 24h, the
    // maximum Chrome/Firefox actually honor (larger values are clamped).
    maxAge: 86400,
  });
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
