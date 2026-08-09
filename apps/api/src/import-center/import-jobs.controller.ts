import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';
import { ImportJobsService } from './import-jobs.service';
import { ImportMappingTemplatesService } from './import-mapping-templates.service';
import { CreateImportJobDto } from './dto/create-import-job.dto';
import { SetMappingDto } from './dto/set-mapping.dto';
import { SaveMappingTemplateDto } from './dto/save-mapping-template.dto';
import { UploadGoogleSheetsDto } from './dto/upload-google-sheets.dto';

/** Business operations: Create Draft, Upload, Preview, Set Mapping, Run, Cancel, Errors Export. */
@Controller('import-center/jobs')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('import-center')
export class ImportJobsController {
  constructor(
    private readonly importJobs: ImportJobsService,
    private readonly mappingTemplates: ImportMappingTemplatesService,
  ) {}

  @Post()
  @PermissionAction('import')
  create(@Body() dto: CreateImportJobDto, @CurrentUser() user: JwtPayload) {
    return this.importJobs.create(dto, user.sub);
  }

  @Get()
  findAll(@Query('importType') importType?: string) {
    return this.importJobs.findAll(importType);
  }

  @Get('mapping-templates/:importType')
  listMappingTemplates(@Param('importType') importType: string) {
    return this.mappingTemplates.findAll(importType);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.importJobs.findOne(id);
  }

  @Post(':id/upload')
  @PermissionAction('import')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  upload(@Param('id') id: string, @UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded.');
    }
    // .xlsx is a binary (zip) format — base64, never utf-8, or the bytes get corrupted. .csv stays plain text.
    const isExcel = file.originalname.toLowerCase().endsWith('.xlsx');
    return this.importJobs.upload(
      id,
      file.originalname,
      isExcel ? file.buffer.toString('base64') : file.buffer.toString('utf-8'),
    );
  }

  @Post(':id/google-sheets')
  @HttpCode(200)
  @PermissionAction('import')
  uploadFromGoogleSheets(
    @Param('id') id: string,
    @Body() dto: UploadGoogleSheetsDto,
  ) {
    return this.importJobs.uploadFromGoogleSheets(id, dto.url);
  }

  /** "Manual Refresh" — re-fetches the same Google Sheet this job was created from. Scheduled refresh is architecture-only this phase (`ImportJob.scheduleConfig`). */
  @Post(':id/refresh')
  @HttpCode(200)
  @PermissionAction('import')
  refresh(@Param('id') id: string) {
    return this.importJobs.refresh(id);
  }

  @Get(':id/preview')
  preview(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.importJobs.preview(id, limit ? Number(limit) : undefined);
  }

  @Post(':id/mapping')
  @HttpCode(200)
  @PermissionAction('import')
  setMapping(@Param('id') id: string, @Body() dto: SetMappingDto) {
    return this.importJobs.setMapping(id, dto);
  }

  /** Pre-flight validation ("Nothing is imported until validation succeeds") — read-only, never changes the job's status. */
  @Post(':id/validate')
  @HttpCode(200)
  @PermissionAction('import')
  validate(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.importJobs.validate(id, user.sub);
  }

  @Post(':id/run')
  @HttpCode(200)
  @PermissionAction('import')
  run(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.importJobs.run(id, user.sub);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @PermissionAction('import')
  cancel(@Param('id') id: string) {
    return this.importJobs.cancel(id);
  }

  @Get(':id/errors/export')
  @PermissionAction('export')
  async exportErrors(@Param('id') id: string, @Res() res: Response) {
    const csv = await this.importJobs.exportErrorsCsv(id);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="import-errors-${id}.csv"`,
    );
    res.send(csv);
  }

  @Post('mapping-templates')
  @PermissionAction('import')
  saveMappingTemplate(
    @Body() dto: SaveMappingTemplateDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.mappingTemplates.save(dto, user.sub);
  }

  @Delete('mapping-templates/:id')
  @HttpCode(200)
  @PermissionAction('import')
  removeMappingTemplate(@Param('id') id: string) {
    return this.mappingTemplates.remove(id);
  }
}
