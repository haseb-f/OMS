import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import {
  AgentShared,
  AllowPendingPasswordChange,
} from './decorators/agent-access.decorator';
import { PartnerShared } from './decorators/partner-access.decorator';
import { ChangePasswordDto } from './dto/change-password.dto';
import type { JwtPayload } from './guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Headers('user-agent') userAgent?: string) {
    return this.authService.login(dto, userAgent);
  }

  @Post('forgot-password')
  @HttpCode(200)
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @Post('reset-password')
  @HttpCode(200)
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Post('logout')
  @HttpCode(200)
  @AgentShared()
  @PartnerShared()
  @AllowPendingPasswordChange()
  @UseGuards(JwtAuthGuard)
  logout(@CurrentUser() user: JwtPayload) {
    // R14 — revokes this token's server-side session; the token is refused
    // from the next request on, even if a copy of it survives somewhere.
    return this.authService.logout(user.sid);
  }

  @Get('me')
  @AgentShared()
  @PartnerShared()
  @AllowPendingPasswordChange()
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: JwtPayload) {
    return this.authService.getCurrentUser(user.sub);
  }

  /** Own password change (internal, agent and partner users); clears `mustChangePassword`. */
  @Post('change-password')
  @HttpCode(200)
  @AgentShared()
  @PartnerShared()
  @AllowPendingPasswordChange()
  @UseGuards(JwtAuthGuard)
  changePassword(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(user.sub, dto, user.sid);
  }
}
