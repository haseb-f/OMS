import { BadRequestException, Injectable } from '@nestjs/common';
import { Country, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import {
  MasterDataCrudService,
  MasterDataDelegate,
} from '../master-data/master-data-crud.service';
import { MasterDataQueryDto } from '../master-data/dto/master-data-query.dto';
import { CreateCountryDto } from './dto/create-country.dto';
import { UpdateCountryDto } from './dto/update-country.dto';
import {
  INVALID_COUNTRY_CODE_MESSAGE,
  INVALID_COUNTRY_ISO3_MESSAGE,
  isValidCountryCode,
  isValidCountryIso3,
  normalizeIsoCode,
} from './country-code.util';

type CountryInput = Partial<CreateCountryDto>;

@Injectable()
export class CountriesService extends MasterDataCrudService<Country> {
  protected readonly entityType = 'COUNTRY';
  protected readonly entityLabel = 'Country';
  /** Arabic name, English name, ISO2/ISO3 and calling code ("+966") — so "Saudi", "السعودية", "SA", "SAU" and "+966" all find Saudi Arabia. */
  protected readonly searchFields = [
    'code',
    'name',
    'nameEn',
    'iso3',
    'callingCode',
  ];
  protected readonly normalizedSearch = {
    table: 'countries',
    columns: ['name'],
  };

  constructor(
    prisma: PrismaService,
    activityLog: MasterDataActivityLogService,
  ) {
    super(prisma, activityLog);
  }

  protected get delegate(): MasterDataDelegate<Country> {
    return this.prisma.country as unknown as MasterDataDelegate<Country>;
  }

  /** "966" and "+966" both match the stored "+966" calling code. */
  findAll(query: MasterDataQueryDto) {
    const search = query.search?.trim();
    return super.findAll({
      ...query,
      search: search && /^\+\d+$/.test(search) ? search.slice(1) : search,
    });
  }

  async create(dto: CreateCountryDto, userId?: string): Promise<Country> {
    const data = this.normalizeInput(dto);
    await this.assertNoDuplicate(data);
    return super.create(data, userId);
  }

  async update(
    id: string,
    dto: UpdateCountryDto,
    userId?: string,
  ): Promise<Country> {
    const data = this.normalizeInput(dto);
    await this.assertNoDuplicate(data, id);
    return super.update(id, data, userId);
  }

  /**
   * Same rule as Chart of Accounts' "Safe Account Deletion": a Country that
   * any record references (Leads, Partners/addresses, Sales Orders, Cities)
   * cannot be archived — archiving it would hide it from every selector
   * while those records still point at it (how Saudi Arabia went missing).
   */
  async archive(id: string, userId?: string): Promise<Country> {
    const country = await this.findOne(id);
    const usage = await this.countUsageReferences(id);
    if (usage.length > 0) {
      const details = usage.map((u) => `${u.label} (${u.count})`).join('، ');
      throw new BadRequestException({
        code: 'DEPENDENCY_ERROR',
        message: `لا يمكن أرشفة الدولة "${country.name}" لأنها مستخدمة في: ${details}.`,
      });
    }
    return super.archive(id, userId);
  }

  /** A row whose code is not a valid ISO alpha-2 (e.g. "ٍِSA") stays archived — restore the canonical ISO row instead. */
  async restore(id: string, userId?: string): Promise<Country> {
    const existing = await this.prisma.country.findUnique({ where: { id } });
    if (existing && !isValidCountryCode(existing.code)) {
      throw this.invalidField('code', INVALID_COUNTRY_CODE_MESSAGE);
    }
    return super.restore(id, userId);
  }

  private async countUsageReferences(
    countryId: string,
  ): Promise<{ label: string; count: number }[]> {
    const [leads, partners, salesOrders, cities] = await Promise.all([
      this.prisma.lead.count({ where: { countryId } }),
      this.prisma.partner.count({ where: { countryId } }),
      this.prisma.salesOrder.count({ where: { countryId } }),
      this.prisma.city.count({ where: { countryId, deletedAt: null } }),
    ]);
    return [
      { label: 'العملاء المحتملون', count: leads },
      { label: 'الشركاء/العناوين', count: partners },
      { label: 'أوامر البيع', count: salesOrders },
      { label: 'المدن', count: cities },
    ].filter((u) => u.count > 0);
  }

  /** Trims every text field; ISO codes are upper-cased and must be pure Latin A–Z (ISO 3166-1). */
  private normalizeInput(dto: CountryInput): CountryInput {
    const data: CountryInput = { ...dto };
    if (dto.code !== undefined) {
      data.code = normalizeIsoCode(dto.code);
      if (!isValidCountryCode(data.code)) {
        throw this.invalidField('code', INVALID_COUNTRY_CODE_MESSAGE);
      }
    }
    if (dto.iso3 !== undefined && dto.iso3 !== null) {
      const iso3 = normalizeIsoCode(dto.iso3);
      if (iso3 && !isValidCountryIso3(iso3)) {
        throw this.invalidField('iso3', INVALID_COUNTRY_ISO3_MESSAGE);
      }
      data.iso3 = iso3 || undefined;
    }
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.nameEn !== undefined) data.nameEn = dto.nameEn?.trim() || undefined;
    return data;
  }

  /**
   * Duplicates are checked against EVERY row, archived included — a new
   * row must never shadow an archived canonical country (e.g. a hand-typed
   * "SA" next to the archived ISO one). The user is told to restore instead.
   */
  private async assertNoDuplicate(
    data: CountryInput,
    excludeId?: string,
  ): Promise<void> {
    const or: Prisma.CountryWhereInput[] = [];
    if (data.code)
      or.push({ code: { equals: data.code, mode: 'insensitive' } });
    if (data.iso3)
      or.push({ iso3: { equals: data.iso3, mode: 'insensitive' } });
    if (data.name)
      or.push({ name: { equals: data.name, mode: 'insensitive' } });
    if (data.nameEn) {
      or.push({ nameEn: { equals: data.nameEn, mode: 'insensitive' } });
    }
    if (!or.length) return;

    const existing = await this.prisma.country.findFirst({
      where: { OR: or, ...(excludeId ? { id: { not: excludeId } } : {}) },
    });
    if (!existing) return;

    const field =
      data.code && existing.code.toUpperCase() === data.code
        ? 'code'
        : data.iso3 && existing.iso3?.toUpperCase() === data.iso3
          ? 'iso3'
          : 'name';
    const label = `${existing.code} — ${existing.name}`;
    throw new BadRequestException({
      code: 'DUPLICATE',
      message: existing.deletedAt
        ? `الدولة "${label}" موجودة مسبقًا لكنها مؤرشفة. اعرض المؤرشف واستعدها بدلًا من إنشاء دولة جديدة.`
        : `الدولة "${label}" موجودة مسبقًا.`,
      fields: [{ field, constraints: ['unique'] }],
      details: { existingId: existing.id, archived: !!existing.deletedAt },
    });
  }

  private invalidField(field: string, message: string) {
    return new BadRequestException({
      code: 'VALIDATION_ERROR',
      message,
      fields: [{ field, constraints: [message] }],
    });
  }
}
