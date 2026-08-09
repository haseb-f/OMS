import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * TASK-060 Part 2 — Job Titles are a closed, seed-managed label list ("Create
 * only these default Job Titles... DO NOT grant permissions"). Read-only
 * here by design: no create/edit/delete endpoint, since the task scopes this
 * to exactly the 8 seeded titles, not an open reference-data module.
 */
@Injectable()
export class JobTitlesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.jobTitle.findMany({ orderBy: { name: 'asc' } });
  }
}
