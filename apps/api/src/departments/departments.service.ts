import { BadRequestException, Injectable } from '@nestjs/common';
import { Department } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import {
  MasterDataCrudService,
  MasterDataDelegate,
} from '../master-data/master-data-crud.service';
import { NumberingEngineService } from '../numbering/numbering-engine.service';
import { CreateDepartmentDto } from './dto/create-department.dto';

const DOCUMENT_TYPE = 'DEPARTMENT';

@Injectable()
export class DepartmentsService extends MasterDataCrudService<Department> {
  protected readonly entityType = 'DEPARTMENT';
  protected readonly entityLabel = 'Department';
  protected readonly searchFields = ['code', 'name', 'nameEn', 'description'];
  protected readonly defaultSortField = 'sortOrder';

  constructor(
    prisma: PrismaService,
    activityLog: MasterDataActivityLogService,
    private readonly numberingEngine: NumberingEngineService,
  ) {
    super(prisma, activityLog);
  }

  protected get delegate(): MasterDataDelegate<Department> {
    return this.prisma.department as unknown as MasterDataDelegate<Department>;
  }

  async create(dto: CreateDepartmentDto, userId?: string) {
    const code = await this.numberingEngine.generateNumber(DOCUMENT_TYPE);
    return super.create({ ...dto, code }, userId);
  }

  /**
   * Lookup including archived rows — existing User/Sales Team records may
   * still point at a Department that was later archived.
   */
  async findByIdIncludingArchived(id: string): Promise<Department> {
    const department = await this.prisma.department.findFirst({
      where: { id },
    });
    if (!department) {
      throw new BadRequestException(`Department ${id} not found.`);
    }
    return department;
  }

  /**
   * New assignment (User create / Sales Team create / User reassignment to a
   * different department) must target an active, non-archived Department.
   * Existing records may keep an archived Department (historical display).
   */
  async assertAssignable(id: string): Promise<Department> {
    const department = await this.findByIdIncludingArchived(id);
    if (department.deletedAt || department.isActive === false) {
      throw new BadRequestException(
        'Archived or inactive Departments cannot be assigned to new records.',
      );
    }
    return department;
  }
}
