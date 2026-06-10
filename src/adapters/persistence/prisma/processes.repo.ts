import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  ProcessesRepoPort,
  StoredProcess,
  UpsertResult,
} from '../../../ports/persistence/processes.repo.port';
import type {
  Duration,
  ProcessRow,
  SearchFilters,
  TabName,
} from '../../../ports/persistence/types';
import { PrismaService } from './prisma.service';

@Injectable()
export class PrismaProcessesRepo implements ProcessesRepoPort {
  constructor(private readonly prisma: PrismaService) {}

  async findByFilters(
    tab: TabName,
    f: SearchFilters,
    opts?: { maxAge?: Duration; limit?: number },
  ): Promise<StoredProcess[]> {
    const maxAgeAt = opts?.maxAge ? new Date(Date.now() - opts.maxAge.ms) : undefined;
    return this.prisma.process.findMany({
      where: {
        tab,
        ...(f.entityRuc && { entityRuc: f.entityRuc }),
        ...(f.objeto && { objeto: f.objeto }),
        ...(f.keyword && { descripcion: { contains: f.keyword, mode: 'insensitive' } }),
        ...(maxAgeAt && { scrapedAt: { gte: maxAgeAt } }),
      },
      orderBy: { fechaPublicacion: 'desc' },
      take: opts?.limit ?? 50,
    });
  }

  async upsertMany(rows: ProcessRow[]): Promise<UpsertResult> {
    // Sin $transaction envolvente: el pooler de Supabase (transaction-mode
    // pgbouncer) cierra transacciones largas y nuestro upsert es idempotente
    // por design — si un row falla, el próximo scrape lo recompleta.
    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    const ids: string[] = [];

    for (const r of rows) {
      if (!r.nomenclatura || r.versionSeace == null) {
        // Filas sin nomenclatura (ACF): la identidad es el contentHash. Dedup
        // por (tab, content_hash) — el índice único parcial lo garantiza en BD.
        const existing = await this.prisma.process.findFirst({
          where: { tab: r.tab, contentHash: r.contentHash },
          select: { id: true },
        });
        if (existing) {
          await this.prisma.process.update({
            where: { id: existing.id },
            data: { scrapedAt: new Date() },
          });
          ids.push(existing.id);
          unchanged++;
        } else {
          const created = await this.prisma.process.create({
            data: this.toCreate(r),
            select: { id: true },
          });
          ids.push(created.id);
          inserted++;
        }
        continue;
      }

      const existing = await this.prisma.process.findUnique({
        where: {
          tab_nomenclatura_versionSeace: {
            tab: r.tab,
            nomenclatura: r.nomenclatura,
            versionSeace: r.versionSeace,
          },
        },
        select: { id: true, contentHash: true },
      });

      if (!existing) {
        const created = await this.prisma.process.create({
          data: this.toCreate(r),
          select: { id: true },
        });
        ids.push(created.id);
        inserted++;
      } else if (existing.contentHash !== r.contentHash) {
        await this.prisma.process.update({
          where: { id: existing.id },
          data: { ...this.toUpdate(r), lastChangedAt: new Date(), scrapedAt: new Date() },
        });
        ids.push(existing.id);
        updated++;
      } else {
        await this.prisma.process.update({
          where: { id: existing.id },
          data: { scrapedAt: new Date() },
        });
        ids.push(existing.id);
        unchanged++;
      }
    }

    return { inserted, updated, unchanged, ids };
  }

  findById(id: string): Promise<StoredProcess | null> {
    return this.prisma.process.findUnique({ where: { id } });
  }

  async findManyByIds(ids: string[]): Promise<StoredProcess[]> {
    if (ids.length === 0) return [];
    const found = await this.prisma.process.findMany({ where: { id: { in: ids } } });
    const byId = new Map(found.map((p) => [p.id, p]));
    return ids.map((id) => byId.get(id)).filter((p): p is StoredProcess => p != null);
  }

  private toCreate(r: ProcessRow): Prisma.ProcessCreateInput {
    return {
      tab: r.tab,
      nomenclatura: r.nomenclatura,
      ...(r.entityRuc
        ? { entity: { connectOrCreate: this.entityConnectOrCreate(r) } }
        : { entityRuc: null }),
      entityNombre: r.entityNombre,
      fechaPublicacion: r.fechaPublicacion ?? undefined,
      tipoSeleccion: r.tipoSeleccion,
      tipoSeleccionId: r.tipoSeleccionId,
      objeto: r.objeto ?? undefined,
      descripcion: r.descripcion,
      alcance: r.alcance,
      cantidad: r.cantidad,
      plazoDias: r.plazoDias,
      fechaAproxConv: r.fechaAproxConv ?? undefined,
      codigoSnip: r.codigoSnip,
      codigoCui: r.codigoCui,
      valorReferencial: r.valorReferencial,
      moneda: r.moneda,
      versionSeace: r.versionSeace,
      nidProceso: r.nidProceso,
      nidConvocatoria: r.nidConvocatoria,
      urlRepositorio: r.urlRepositorio,
      contentHash: r.contentHash,
      raw: (r.raw ?? null) as Prisma.InputJsonValue,
    };
  }

  private toUpdate(r: ProcessRow): Prisma.ProcessUpdateInput {
    const data = this.toCreate(r);
    // En update no debemos tocar firstSeenAt; al usar lastChangedAt afuera.
    return data;
  }

  private entityConnectOrCreate(
    r: ProcessRow,
  ): NonNullable<Prisma.EntityCreateNestedOneWithoutProcessesInput['connectOrCreate']> {
    return {
      where: { ruc: r.entityRuc! },
      create: { ruc: r.entityRuc!, nombre: r.entityNombre },
    };
  }
}
