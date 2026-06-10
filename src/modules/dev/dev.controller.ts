import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProcesoTab } from '@prisma/client';
import type { Env } from '../../config/env.schema';
import { JOB_NAMES } from '../../jobs/job-types';
import type { SearchJobData } from '../../jobs/search.job';
import { QUEUE_PORT, type QueuePort } from '../../ports/queue.port';
import type { ObjetoContratacion, SearchFilters, TabName } from '../../ports/persistence/types';
import { EntitySearchService } from '../search/entity-search.service';
import { SearchFacade } from '../search/search.facade';

interface ScrapeRequestBody {
  tab?: string;
  filters?: SearchFilters;
}

interface SearchRequestBody extends ScrapeRequestBody {
  phoneNumber?: string;
  phoneNumberId?: string;
}

@Controller('dev')
export class DevController {
  private readonly enabled: boolean;
  private readonly allowedTabs = Object.values(ProcesoTab) as TabName[];

  constructor(
    config: ConfigService<Env, true>,
    @Inject(QUEUE_PORT) private readonly queue: QueuePort,
    private readonly entitySearch: EntitySearchService,
    private readonly facade: SearchFacade,
  ) {
    this.enabled = config.get('NODE_ENV', { infer: true }) !== 'production';
  }

  @Post('scrape')
  async scrape(@Body() body: ScrapeRequestBody): Promise<{ jobId: string; tab: TabName }> {
    this.assertEnabled();
    const tab = this.parseTab(body.tab);
    const filters = this.parseFilters(body.filters);

    const data: SearchJobData = {
      userId: null,
      tab,
      filters,
      trace: { requestId: randomUUID(), enqueuedAt: Date.now() },
    };
    const job = await this.queue.add(JOB_NAMES.SEARCH_ON_DEMAND, data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
    });
    return { jobId: job.id, tab };
  }

  @Get('jobs/:id')
  async jobStatus(@Param('id') id: string) {
    this.assertEnabled();
    const job = await this.queue.getJob(id);
    if (!job) throw new NotFoundException(`Job ${id} no existe`);
    return job;
  }

  @Post('entity-search')
  async entitySearchEndpoint(@Body() body: { q?: string }) {
    this.assertEnabled();
    const q = (body.q ?? '').toString();
    if (!q.trim()) throw new BadRequestException('q es requerido');
    const matches = await this.entitySearch.search(q);
    return { query: q, count: matches.length, matches };
  }

  @Post('search')
  async searchEndpoint(@Body() body: SearchRequestBody) {
    this.assertEnabled();
    const tab = this.parseTab(body.tab);
    const filters = this.parseFilters(body.filters);
    const outcome = await this.facade.search({
      userId: null,
      phoneNumber: body.phoneNumber,
      phoneNumberId: body.phoneNumberId,
      tab,
      filters,
    });
    return { tab, filters, outcome };
  }

  private assertEnabled(): void {
    if (!this.enabled) {
      throw new ForbiddenException('DevController deshabilitado en producción');
    }
  }

  private parseTab(input: string | undefined): TabName {
    const tab = (input ?? 'procedimientos') as TabName;
    if (!this.allowedTabs.includes(tab)) {
      throw new BadRequestException(
        `tab inválido: ${input}. Permitidos: ${this.allowedTabs.join(', ')}`,
      );
    }
    return tab;
  }

  private parseFilters(input: SearchFilters | undefined): SearchFilters {
    const f = input ?? {};
    const out: SearchFilters = {};
    if (f.entityRuc) out.entityRuc = String(f.entityRuc);
    if (f.objeto) out.objeto = f.objeto as ObjetoContratacion;
    if (f.anioConvocatoria) out.anioConvocatoria = Number(f.anioConvocatoria);
    if (f.keyword) out.keyword = String(f.keyword);
    if (f.departamento) out.departamento = String(f.departamento);
    return out;
  }
}
