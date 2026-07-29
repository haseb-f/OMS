import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  LeadActivityService,
  LeadActivityType,
} from '../activities/lead-activity.service';
import { CreateLeadNoteDto } from './dto/create-lead-note.dto';
import { UpdateLeadNoteDto } from './dto/update-lead-note.dto';

@Injectable()
export class LeadNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leadActivityService: LeadActivityService,
  ) {}

  create(leadId: string, dto: CreateLeadNoteDto) {
    return this.prisma.$transaction(async (tx) => {
      const note = await tx.leadNote.create({
        data: { leadId, userId: dto.userId, text: dto.text },
      });
      await this.leadActivityService.log(
        leadId,
        LeadActivityType.NOTE_ADDED,
        'Note added to lead',
        { noteId: note.id },
        tx,
      );
      return note;
    });
  }

  findAllForLead(leadId: string) {
    return this.prisma.leadNote.findMany({
      where: { leadId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findOne(leadId: string, id: string) {
    const note = await this.prisma.leadNote.findFirst({
      where: { id, leadId, deletedAt: null },
    });
    if (!note) {
      throw new NotFoundException(`Lead note ${id} not found`);
    }
    return note;
  }

  async update(leadId: string, id: string, dto: UpdateLeadNoteDto) {
    await this.findOne(leadId, id);
    return this.prisma.leadNote.update({ where: { id }, data: dto });
  }

  async remove(leadId: string, id: string) {
    await this.findOne(leadId, id);
    return this.prisma.leadNote.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
