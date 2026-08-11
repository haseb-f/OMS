import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import type { ErrorCode, ErrorResponseBody } from './error-response.types';

/**
 * The one place a thrown error becomes an HTTP response. Every technical
 * detail (Prisma error codes, class-validator constraint names, stack
 * traces) is logged here and never sent to the client — the client only
 * ever sees `{ code, message, fields? }`, which the frontend's error
 * translation layer turns into a friendly, localized message. A service
 * that already throws a structured `BadRequestException({ code, message,
 * fields })` (see `MasterDataCrudService.mapError`) passes through as-is;
 * everything else is normalized here so no call site has to think about it.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionsFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { statusCode, body } = this.resolve(exception);

    if (statusCode >= 500) {
      this.logger.error(
        `${request.method} ${request.url} -> ${statusCode} ${body.code}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(
        `${request.method} ${request.url} -> ${statusCode} ${body.code}: ${body.message}`,
      );
    }

    response.status(statusCode).json(body);
  }

  private resolve(exception: unknown): {
    statusCode: number;
    body: ErrorResponseBody;
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      if (
        typeof payload === 'object' &&
        payload !== null &&
        'code' in payload
      ) {
        // Already a structured ErrorResponseBody (from our ValidationPipe
        // exceptionFactory, or a service throwing one directly) — pass through.
        return { statusCode: status, body: payload as ErrorResponseBody };
      }
      const message = typeof payload === 'string' ? payload : exception.message;
      return {
        statusCode: status,
        body: { code: codeForStatus(status), message },
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.resolvePrismaError(exception);
    }

    return {
      statusCode: 500,
      body: { code: 'SERVER_ERROR', message: 'Internal server error.' },
    };
  }

  private resolvePrismaError(error: Prisma.PrismaClientKnownRequestError): {
    statusCode: number;
    body: ErrorResponseBody;
  } {
    switch (error.code) {
      case 'P2002': {
        const target = Array.isArray(error.meta?.target)
          ? (error.meta.target as string[])
          : [];
        const field = target[0] ?? 'value';
        return {
          statusCode: 400,
          body: {
            code: 'DUPLICATE',
            message: `A record with this ${field} already exists.`,
            fields: [{ field, constraints: ['unique'] }],
          },
        };
      }
      case 'P2003': {
        const field =
          typeof error.meta?.field_name === 'string'
            ? error.meta.field_name
            : undefined;
        return {
          statusCode: 400,
          body: {
            code: 'DEPENDENCY_ERROR',
            message: 'This action conflicts with related data.',
            fields: field
              ? [{ field, constraints: ['dependency'] }]
              : undefined,
          },
        };
      }
      case 'P2025':
        return {
          statusCode: 404,
          body: { code: 'NOT_FOUND', message: 'Record not found.' },
        };
      default:
        this.logger.error(
          `Unhandled Prisma error code ${error.code}`,
          error.message,
        );
        return {
          statusCode: 500,
          body: {
            code: 'DATABASE_ERROR',
            message: 'A database error occurred.',
          },
        };
    }
  }
}

function codeForStatus(status: number): ErrorCode {
  if (status === 401 || status === 403) return 'PERMISSION_ERROR';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'DUPLICATE';
  if (status >= 500) return 'SERVER_ERROR';
  return 'VALIDATION_ERROR';
}
