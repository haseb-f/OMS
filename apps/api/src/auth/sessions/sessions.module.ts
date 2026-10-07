import { Global, Module } from '@nestjs/common';
import { UserSessionsService } from './user-sessions.service';

/**
 * R14 W1 — global so `JwtAuthGuard` (instantiated in every feature module
 * that uses it) and `UsersService` (admin password reset) resolve the one
 * per-process session cache.
 */
@Global()
@Module({
  providers: [UserSessionsService],
  exports: [UserSessionsService],
})
export class SessionsModule {}
