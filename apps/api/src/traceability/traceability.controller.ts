import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';
import { TraceabilityService } from './traceability.service';
import { TraceKindPipe } from './trace-kind.pipe';
import type { TraceKind } from './traceability.types';

/**
 * Related records for any traceable document. Authenticated only — every
 * linked record is filtered by the viewer's own view permission inside the
 * service (hidden groups come back as UNAUTHORIZED, never silently empty).
 */
@Controller('traceability')
@UseGuards(JwtAuthGuard)
export class TraceabilityController {
  constructor(private readonly traceability: TraceabilityService) {}

  @Get(':kind/:id')
  trace(
    @Param('kind', TraceKindPipe) kind: TraceKind,
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.traceability.trace(kind, id, user.sub);
  }
}
