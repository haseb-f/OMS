import { Injectable, OnModuleInit } from '@nestjs/common';
import { ProjectsService } from '../../projects/projects.service';
import { ImportTypeRegistryService } from '../import-type-registry.service';
import type {
  ImportFieldDef,
  ImportRowOptions,
  ImportRowResult,
  ImportTypeHandler,
} from '../import-type.interface';

const FIELDS: ImportFieldDef[] = [
  {
    key: 'code',
    labelKey: 'importCenter.fields.code',
    label: 'Code',
    required: true,
    type: 'string',
    example: 'PRJ-2026-01',
    uniqueWithinFile: true,
  },
  {
    key: 'name',
    labelKey: 'importCenter.fields.name',
    label: 'Name',
    required: true,
    type: 'string',
    example: 'Riyadh Branch Fit-Out',
  },
  {
    key: 'description',
    labelKey: 'importCenter.fields.description',
    label: 'Description',
    required: false,
    type: 'string',
  },
];

/** Projects Import (Phase 2.5) — every row calls `ProjectsService.create()` unchanged. */
@Injectable()
export class ProjectsImportHandler implements ImportTypeHandler, OnModuleInit {
  readonly type = 'PROJECTS';
  readonly labelKey = 'importCenter.types.projects.label';
  readonly descriptionKey = 'importCenter.types.projects.description';
  readonly fields = FIELDS;
  readonly isAvailable = true;

  constructor(
    private readonly projectsService: ProjectsService,
    private readonly registry: ImportTypeRegistryService,
  ) {}

  onModuleInit() {
    this.registry.register(this);
  }

  async importRow(
    row: Record<string, string>,
    userId?: string,
    options?: ImportRowOptions,
  ): Promise<ImportRowResult> {
    if (options?.dryRun) return { id: 'dry-run' };
    const project = await this.projectsService.create(
      {
        code: row.code,
        name: row.name,
        description: row.description || undefined,
      },
      userId,
    );
    return { id: project.id };
  }
}
