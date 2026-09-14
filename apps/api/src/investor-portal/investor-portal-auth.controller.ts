import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { InvestorPortalAuthService } from './investor-portal-auth.service';
import { PortalLoginDto } from './dto/portal-login.dto';
import { PortalActivateDto } from './dto/portal-activate.dto';
import { PortalForgotPasswordDto } from './dto/portal-forgot-password.dto';

/** Public (unauthenticated) Investor Portal auth routes — no guard, mirrors `AuthController`'s shape for the internal side. */
@Controller('investor-portal/auth')
export class InvestorPortalAuthController {
  constructor(private readonly portalAuth: InvestorPortalAuthService) {}

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: PortalLoginDto) {
    return this.portalAuth.login(dto);
  }

  @Post('activate')
  @HttpCode(200)
  activate(@Body() dto: PortalActivateDto) {
    return this.portalAuth.activate(dto);
  }

  @Post('forgot-password')
  @HttpCode(200)
  forgotPassword(@Body() dto: PortalForgotPasswordDto) {
    return this.portalAuth.forgotPassword(dto);
  }
}
