import {
  Controller,
  Get,
  Param,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { InvestorPortalService } from './investor-portal.service';
import { InvestorPortalAuthGuard } from './investor-portal-auth.guard';
import { CurrentPortalInvestor } from './current-portal-investor.decorator';
import { FindPortalPageQueryDto } from './dto/find-portal-page-query.dto';
import { FindPortalStatementQueryDto } from './dto/find-portal-statement-query.dto';

/**
 * Investor Engine Milestone 4, Part C-M — every route here is guarded by
 * `InvestorPortalAuthGuard` (never the internal `JwtAuthGuard`/
 * `PermissionsGuard`) and every handler resolves its Investor scope
 * exclusively from `@CurrentPortalInvestor()`, never from a route/query
 * param (mission Part 23/53).
 */
@Controller('investor-portal')
@UseGuards(InvestorPortalAuthGuard)
export class InvestorPortalController {
  constructor(private readonly portal: InvestorPortalService) {}

  @Get('me')
  me(@CurrentPortalInvestor() investorId: string) {
    return this.portal.getMe(investorId);
  }

  @Get('dashboard')
  dashboard(@CurrentPortalInvestor() investorId: string) {
    return this.portal.getDashboard(investorId);
  }

  @Get('investments')
  investments(
    @CurrentPortalInvestor() investorId: string,
    @Query() query: FindPortalPageQueryDto,
  ) {
    return this.portal.getInvestments(investorId, query);
  }

  @Get('investments/:id')
  investmentDetail(
    @CurrentPortalInvestor() investorId: string,
    @Param('id') id: string,
  ) {
    return this.portal.getInvestmentDetail(investorId, id);
  }

  @Get('profits')
  profits(
    @CurrentPortalInvestor() investorId: string,
    @Query() query: FindPortalPageQueryDto,
  ) {
    return this.portal.getProfits(investorId, query);
  }

  @Get('statement')
  statement(
    @CurrentPortalInvestor() investorId: string,
    @Query() query: FindPortalStatementQueryDto,
  ) {
    return this.portal.getStatement(investorId, query);
  }

  @Get('documents')
  documents(
    @CurrentPortalInvestor() investorId: string,
    @Query() query: FindPortalPageQueryDto,
  ) {
    return this.portal.getDocuments(investorId, query);
  }

  @Get('documents/:attachmentId/file')
  async documentFile(
    @CurrentPortalInvestor() investorId: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    const file = await this.portal.getDocumentFile(investorId, attachmentId);
    return new StreamableFile(file.body, {
      type: file.mimeType,
      disposition: `inline; filename="${encodeURIComponent(file.fileName)}"`,
    });
  }
}
