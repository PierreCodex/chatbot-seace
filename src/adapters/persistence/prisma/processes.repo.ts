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

  // Incluye los detalles 1:1 (CTI) en cada lectura.
  private static readonly DETAILS = { acf: true, procedimiento: true } as const;

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
        // ACF no trae RUC en sus filas → se filtra por nombre exacto (ambos
        // nombres provienen de SEACE, así que coinciden).
        ...(f.entityNombre && { entityNombre: { equals: f.entityNombre, mode: 'insensitive' } }),
        ...(f.objeto && { objeto: f.objeto }),
        ...(f.keyword && { descripcion: { contains: f.keyword, mode: 'insensitive' } }),
        ...(maxAgeAt && { scrapedAt: { gte: maxAgeAt } }),
      },
      include: PrismaProcessesRepo.DETAILS,
      orderBy: { fechaPublicacion: 'desc' },
      take: opts?.limit ?? 50,
    });
  }

  async upsertMany(rows: ProcessRow[]): Promise<UpsertResult> {
    // Sin $transaction envolvente: el pooler de Supabase (transaction-mode
    // pgbouncer) cierra transacciones largas y nuestro upsert es idempotente
    // por design — si un row falla, el próximo scrape lo recompleta. Cada fila
    // escribe base + detalle vía nested-write (transacción corta de Prisma).
    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    const ids: string[] = [];

    for (const r of rows) {
      const dedupeKey = dedupeKeyOf(r);
      const existing = await this.prisma.process.findUnique({
        where: { tab_dedupeKey: { tab: r.tab, dedupeKey } },
        select: { id: true, contentHash: true },
      });

      if (!existing) {
        const created = await this.prisma.process.create({
          data: this.toCreate(r, dedupeKey),
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
    return this.prisma.process.findUnique({
      where: { id },
      include: PrismaProcessesRepo.DETAILS,
    });
  }

  async findManyByIds(ids: string[]): Promise<StoredProcess[]> {
    if (ids.length === 0) return [];
    const found = await this.prisma.process.findMany({
      where: { id: { in: ids } },
      include: PrismaProcessesRepo.DETAILS,
    });
    const byId = new Map(found.map((p) => [p.id, p]));
    return ids.map((id) => byId.get(id)).filter((p): p is StoredProcess => p != null);
  }

  private toCreate(r: ProcessRow, dedupeKey: string): Prisma.ProcessCreateInput {
    return {
      tab: r.tab,
      ...(r.entityRuc
        ? { entity: { connectOrCreate: this.entityConnectOrCreate(r) } }
        : { entityRuc: null }),
      entityNombre: r.entityNombre,
      fechaPublicacion: r.fechaPublicacion ?? undefined,
      objeto: r.objeto ?? undefined,
      descripcion: r.descripcion,
      dedupeKey,
      contentHash: r.contentHash,
      raw: (r.raw ?? null) as Prisma.InputJsonValue,
      // Solo el detalle de su pestaña (CTI): un anuncio no lleva fila de
      // procedimiento ni viceversa.
      ...(r.tab === 'anuncios_futuros'
        ? { acf: { create: acfDetail(r) } }
        : r.tab === 'procedimientos'
          ? { procedimiento: { create: procedimientoDetail(r) } }
          : {}),
    };
  }

  private toUpdate(r: ProcessRow): Prisma.ProcessUpdateInput {
    return {
      ...(r.entityRuc
        ? { entity: { connectOrCreate: this.entityConnectOrCreate(r) } }
        : { entityRuc: null }),
      entityNombre: r.entityNombre,
      fechaPublicacion: r.fechaPublicacion ?? null,
      objeto: r.objeto ?? null,
      descripcion: r.descripcion,
      contentHash: r.contentHash,
      raw: (r.raw ?? null) as Prisma.InputJsonValue,
      ...(r.tab === 'anuncios_futuros'
        ? { acf: { upsert: { create: acfDetail(r), update: acfDetail(r) } } }
        : r.tab === 'procedimientos'
          ? {
              procedimiento: {
                upsert: { create: procedimientoDetail(r), update: procedimientoDetail(r) },
              },
            }
          : {}),
    };
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

/**
 * Identidad por pestaña: Procedimientos tiene id estable (nomenclatura+versión);
 * ACF (y cualquier pestaña sin id) usa el contentHash como identidad.
 */
function dedupeKeyOf(r: ProcessRow): string {
  if (r.nomenclatura && r.versionSeace != null) {
    return `${r.nomenclatura}|${r.versionSeace}`;
  }
  return r.contentHash;
}

function acfDetail(r: ProcessRow): Prisma.ProcessAcfCreateWithoutProcessInput {
  return {
    tipoSeleccion: r.tipoSeleccion,
    alcance: r.alcance,
    cantidad: r.cantidad,
    plazoDias: r.plazoDias,
    fechaAproxConv: r.fechaAproxConv ?? undefined,
  };
}

function procedimientoDetail(r: ProcessRow): Prisma.ProcessProcedimientoCreateWithoutProcessInput {
  return {
    nomenclatura: r.nomenclatura,
    tipoSeleccionId: r.tipoSeleccionId,
    codigoSnip: r.codigoSnip,
    codigoCui: r.codigoCui,
    valorReferencial: r.valorReferencial,
    moneda: r.moneda,
    versionSeace: r.versionSeace,
    nidProceso: r.nidProceso,
    nidConvocatoria: r.nidConvocatoria,
    urlRepositorio: r.urlRepositorio,
  };
}
