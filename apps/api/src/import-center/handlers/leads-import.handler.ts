import {
  BadRequestException,
  ConflictException,
  Injectable,
  OnModuleInit,
} from '@nestjs/common';
import { LeadSource, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LeadsService } from '../../leads/leads.service';
import { LeadAssignmentsService } from '../../leads/assignments/lead-assignments.service';
import { CountriesService } from '../../countries/countries.service';
import { ImportTypeRegistryService } from '../import-type-registry.service';
import { ReferenceDataRegistryService } from '../reference-data/reference-data-registry.service';
import {
  PhoneNumberService,
  phoneErrorMessage,
} from '../../common/phone/phone-number.service';
import {
  importScope,
  type ImportActor,
  type ImportAudience,
  type ImportFieldDef,
  type ImportRowOptions,
  type ImportRowResult,
  type ImportTypeHandler,
} from '../import-type.interface';
import { ImportCatalogService } from '../sales-import/import-catalog.service';
import { ImportOwnerService } from '../sales-import/import-owner.service';
import {
  importRowHash,
  leadImportRowKey,
} from '../sales-import/import-row-key';

const FIELDS: ImportFieldDef[] = [
  {
    key: 'externalOrderId',
    labelKey: 'importCenter.fields.externalOrderId',
    label: 'External Lead ID',
    labelAr: 'المعرّف الخارجي',
    required: false,
    type: 'string',
    example: 'FB-LEAD-4821',
    uniqueWithinFile: true,
  },
  {
    key: 'customerName',
    labelKey: 'importCenter.fields.name',
    label: 'Customer Name',
    labelAr: 'اسم العميل',
    required: true,
    type: 'string',
    example: 'Mohammed Al-Otaibi',
  },
  {
    key: 'mobileNumber',
    labelKey: 'importCenter.fields.mobileNumber',
    label: 'Phone',
    labelAr: 'الجوال',
    required: true,
    type: 'string',
    example: '0501234567',
  },
  {
    key: 'countryName',
    labelKey: 'importCenter.fields.countryName',
    label: 'Country',
    labelAr: 'الدولة',
    required: true,
    type: 'string',
    example: 'السعودية (SA)',
    referenceType: 'COUNTRY',
    referenceDisplayWithCode: true,
  },
  {
    key: 'city',
    labelKey: 'importCenter.fields.city',
    label: 'City',
    labelAr: 'المدينة',
    required: false,
    type: 'string',
    example: 'الرياض',
  },
  {
    key: 'address',
    labelKey: 'importCenter.fields.address',
    label: 'Detailed Address',
    labelAr: 'العنوان التفصيلي',
    required: false,
    type: 'string',
  },
  {
    key: 'productSku',
    labelKey: 'importCenter.fields.productSku',
    label: 'Product (SKU)',
    labelAr: 'المنتج (الرمز أو الاسم)',
    required: false,
    type: 'string',
    referenceType: 'PRODUCT',
  },
  {
    key: 'notes',
    labelKey: 'importCenter.fields.notes',
    label: 'Notes',
    labelAr: 'ملاحظات',
    required: false,
    type: 'string',
  },
  {
    key: 'agentEmail',
    labelKey: 'importCenter.fields.agentEmail',
    label: 'Employee',
    labelAr: 'الموظف المسؤول (البريد)',
    required: false,
    type: 'string',
    referenceType: 'EMPLOYEE',
    referenceMatchField: 'code',
  },
];

const SALES_FIELDS = [
  'customerName',
  'mobileNumber',
  'countryName',
  'city',
  'address',
  'productSku',
  'externalOrderId',
  'notes',
  'agentEmail',
];

/**
 * Leads Import (TASK-061 follow-up, Part 6) — the minimal Lead sheet:
 * `customerName`/`mobileNumber`/`countryName` are the only required columns,
 * matching the same "Lead needs only name/phone/country" rule the manual
 * Lead create dialog enforces. Every row ends in `LeadsService.create()`
 * (preview: its own pre-write checks, `checkCreate`), so phone normalisation
 * (E.164 via the country, Arabic digits), product ownership and the
 * duplicate policy (exact duplicate rejected, near match flagged) apply
 * identically to an imported row and a manually created Lead.
 *
 * R15 (D15-16 / D15-17):
 * - One-time import (`options.actor`, company or agent user): the importer
 *   owns the lead unless the Employee column names someone they may assign
 *   (`ImportOwnerService`); agent rows belong to the importer's agent (from
 *   the token) and resolve products in that agent's catalogue only.
 * - Continuous sync (no actor): unchanged automation — a blank Employee
 *   means automatic distribution.
 * - Both paths stamp the same `Lead.importRowKey`, so a row is never ingested
 *   twice (a repeat is reported as skipped, naming the existing lead).
 */
@Injectable()
export class LeadsImportHandler implements ImportTypeHandler, OnModuleInit {
  readonly type = 'LEADS';
  readonly labelKey = 'importCenter.types.leads.label';
  readonly descriptionKey = 'importCenter.types.leads.description';
  readonly fields = FIELDS;
  readonly isAvailable = true;
  readonly salesTemplateFields = { COMPANY: SALES_FIELDS, AGENT: SALES_FIELDS };

  constructor(
    private readonly prisma: PrismaService,
    private readonly leadsService: LeadsService,
    private readonly assignments: LeadAssignmentsService,
    private readonly countriesService: CountriesService,
    private readonly registry: ImportTypeRegistryService,
    private readonly phoneNumberService: PhoneNumberService,
    private readonly referenceData: ReferenceDataRegistryService,
    private readonly catalog: ImportCatalogService,
    private readonly owners: ImportOwnerService,
  ) {}

  onModuleInit() {
    this.registry.register(this);
  }

  requiredPermission(audience: ImportAudience): string {
    return audience === 'AGENT' ? 'agent.leads.import' : 'crm.leads.import';
  }

  async importRow(
    row: Record<string, string>,
    userId?: string,
    options?: ImportRowOptions,
  ): Promise<ImportRowResult> {
    const actor = options?.actor;
    const countryId = await this.referenceData.resolveRequired(
      'COUNTRY',
      'name',
      row.countryName,
      'Country',
    );
    // Validated here too (not only inside LeadsService) so the row key is
    // built from the normalised E.164 number.
    const country = await this.countriesService.findOne(countryId);
    const phoneCheck = this.phoneNumberService.parse(
      row.mobileNumber,
      country.code,
    );
    if (!phoneCheck.isValid || !phoneCheck.e164) {
      throw new BadRequestException(phoneErrorMessage(phoneCheck.errorReason));
    }
    const productId = actor
      ? row.productSku?.trim()
        ? (await this.catalog.resolveProduct(actor, row.productSku)).id
        : undefined
      : await this.referenceData.resolveOptional(
          'PRODUCT',
          'code',
          row.productSku,
          'Product',
        );

    const scope = actor ? importScope(actor) : 'company';
    const importRowKey = leadImportRowKey(
      scope,
      importRowHash(scope, {
        phone: phoneCheck.e164,
        name: row.customerName,
        lines: productId ? [{ productId, quantity: 1, amount: null }] : [],
        externalId: row.externalOrderId,
      }),
    );
    const imported = await this.findImported(
      importRowKey,
      row.externalOrderId,
      actor,
    );
    if (imported) return imported;

    const salesEmployeeId = actor
      ? await this.owners.resolve(row.agentEmail, actor, 'LEAD')
      : await this.referenceData.resolveOptional(
          'EMPLOYEE',
          'code',
          row.agentEmail,
          'Employee',
        );
    // A company lead's owner must be able to receive leads — checked before
    // anything is written (an agent lead's owner is checked by affiliation).
    if (actor && !actor.agent && salesEmployeeId) {
      await this.assignments.assertEligibleEmployee(salesEmployeeId);
    }

    const isGoogleSheets = options?.context?.source === 'GOOGLE_SHEETS';
    const dto = {
      recordType: 'LEAD' as const,
      customerName: row.customerName,
      mobileNumber: row.mobileNumber,
      countryId,
      city: row.city || undefined,
      address: row.address || undefined,
      productId,
      source: isGoogleSheets ? LeadSource.GOOGLE_SHEETS : LeadSource.EXCEL,
      salesEmployeeId,
      externalOrderId: row.externalOrderId?.trim() || undefined,
      importBatch: `${isGoogleSheets ? 'google-sheets' : 'import-center'}-${new Date().toISOString().slice(0, 10)}`,
    };
    const createOptions = { agentId: actor?.agent?.agentId, importRowKey };
    const actingUserId = actor?.userId ?? userId;

    try {
      if (options?.dryRun) {
        const { possibleDuplicate } = await this.leadsService.checkCreate(
          dto,
          actingUserId,
          createOptions,
        );
        return {
          id: 'dry-run',
          ...(possibleDuplicate ? { warnings: [NEAR_DUPLICATE_WARNING] } : {}),
        };
      }
      const lead = await this.leadsService.create(dto, actingUserId, {
        ...createOptions,
        skipFullRefetch: true,
      });
      if (row.notes) {
        await this.leadsService.recordImportedOrderDetails(lead.id, {
          notes: row.notes,
        });
      }
      return lead.possibleDuplicate
        ? { id: lead.id, notice: NEAR_DUPLICATE_WARNING }
        : { id: lead.id };
    } catch (error) {
      // The same row committed concurrently (unique row key): skipped.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const concurrent = await this.findImported(importRowKey, null, actor);
        if (concurrent) return concurrent;
      }
      if (
        error instanceof ConflictException &&
        error.message === 'Duplicate Lead'
      ) {
        throw new ConflictException({
          code: 'DUPLICATE_LEAD',
          message:
            'عميل محتمل مكرر — يوجد عميل محتمل بنفس الاسم والجوال والمنتج — Duplicate lead: a lead with the same name, phone and product already exists.',
        });
      }
      throw error;
    }
  }

  /** Already in OMS: same row key, or the same external lead id (named when the caller may see it). */
  private async findImported(
    importRowKey: string,
    externalOrderId: string | null | undefined,
    actor: ImportActor | undefined,
  ): Promise<ImportRowResult | null> {
    const byKey = await this.prisma.lead.findUnique({
      where: { importRowKey },
      select: { id: true, leadNumber: true },
    });
    if (byKey) {
      return {
        id: byKey.id,
        skipped: `سبق استيراد هذا الصف كعميل محتمل ${byKey.leadNumber} — Already imported as lead ${byKey.leadNumber}.`,
      };
    }
    const externalId = externalOrderId?.trim();
    if (!externalId) return null;
    const existing = await this.leadsService.findByExternalOrderId(externalId);
    if (!existing) return null;
    const sameScope =
      (existing.agentId ?? null) === (actor?.agent?.agentId ?? null);
    return {
      id: existing.id,
      skipped: sameScope
        ? `المعرّف الخارجي «${externalId}» موجود في العميل المحتمل ${existing.leadNumber} — External id "${externalId}" already exists (lead ${existing.leadNumber}).`
        : `المعرّف الخارجي «${externalId}» مستخدم مسبقًا — External id "${externalId}" already exists.`,
    };
  }
}

const NEAR_DUPLICATE_WARNING =
  'تشابه مع عميل محتمل سابق (نفس الاسم والجوال ومنتج مختلف) — سيُعلَّم «احتمال تكرار» — Near match: a lead with the same name and phone (another product) exists; it is flagged as a possible duplicate.';
