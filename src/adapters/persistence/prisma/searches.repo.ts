import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  SearchesRepoPort,
  SearchRecordInput,
  StoredSearch,
} from '../../../ports/persistence/searches.repo.port';
import type { Duration, TabName } from '../../../ports/persistence/types';
import { PrismaService } from './prisma.service';

@Injectable()
export class PrismaSearchesRepo implements SearchesRepoPort {
  constructor(private readonly prisma: PrismaService) {}

  create(data: SearchRecordInput): Promise<StoredSearch> {
    // filters_hash es columna GENERATED ALWAYS — NO pasarla.
    return this.prisma.search.create({
      data: {
        ...(data.userId ? { user: { connect: { id: data.userId } } } : {}),
        tab: data.tab,
        filters: data.filters as unknown as Prisma.InputJsonValue,
        resultIds: data.resultIds,
        resultCount: data.resultCount,
        source: data.source,
        durationMs: data.durationMs,
        error: data.error ?? null,
      },
    });
  }

  async findRecentByFilters(
    tab: TabName,
    filters: Prisma.InputJsonValue,
    maxAge: Duration,
  ): Promise<StoredSearch | null> {
    const since = new Date(Date.now() - maxAge.ms);
    // JSONB equality: Postgres compara semánticamente (orden de claves
    // irrelevante). Más simple y robusto que replicar el hash del lado JS.
    return this.prisma.search.findFirst({
      where: {
        tab,
        source: 'live',
        createdAt: { gte: since },
        filters: { equals: filters },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
