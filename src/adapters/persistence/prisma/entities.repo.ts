import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  EntitiesRepoPort,
  EntityUpsertInput,
  StoredEntity,
} from '../../../ports/persistence/entities.repo.port';
import { PrismaService } from './prisma.service';

@Injectable()
export class PrismaEntitiesRepo implements EntitiesRepoPort {
  constructor(private readonly prisma: PrismaService) {}

  async searchByText(q: string, limit = 10): Promise<StoredEntity[]> {
    const term = q.trim();
    if (!term) return [];
    // Match estilo "buscador de la web": **contiene** (ILIKE) cada palabra. Así
    // "piura" matchea "GOBIERNO REGIONAL DE PIURA" y "muni sullana" matchea
    // "MUNICIPALIDAD DISTRITAL DE SULLANA" (cada palabra como substring). El
    // trigram `%` queda como respaldo para typos. ILIKE con gin_trgm_ops usa el
    // mismo índice GIN. Orden por similitud y luego nombre más corto (más
    // específico primero).
    const words = term.split(/\s+/).filter(Boolean);
    const allWordsMatch = Prisma.join(
      words.map(
        (w) =>
          Prisma.sql`(nombre ILIKE ${'%' + w + '%'} OR coalesce(sigla,'') ILIKE ${'%' + w + '%'})`,
      ),
      ' AND ',
    );
    return this.prisma.$queryRaw<StoredEntity[]>(
      Prisma.sql`
        SELECT *
          FROM entities
         WHERE (${allWordsMatch})
            OR nombre % ${term}
            OR coalesce(sigla,'') % ${term}
         ORDER BY GREATEST(similarity(nombre, ${term}), similarity(coalesce(sigla,''), ${term})) DESC,
                  length(nombre) ASC
         LIMIT ${limit}
      `,
    );
  }

  findByRuc(ruc: string): Promise<StoredEntity | null> {
    return this.prisma.entity.findUnique({ where: { ruc } });
  }

  async upsertManyByRuc(rows: EntityUpsertInput[]): Promise<{ inserted: number; updated: number }> {
    if (rows.length === 0) return { inserted: 0, updated: 0 };

    // Dedup por RUC dentro del lote: un VALUES con el mismo RUC dos veces rompe
    // el ON CONFLICT ("cannot affect row a second time").
    const byRuc = new Map<string, EntityUpsertInput>();
    for (const r of rows) byRuc.set(r.ruc, r);

    // UN solo INSERT masivo con ON CONFLICT por lote. El pooler de Supabase
    // corre con connection_limit=1, así que N upserts en paralelo (o incluso en
    // sub-lotes) agotan el pool y revientan su timeout de 10s. Un bulk insert es
    // una sola query/conexión y además mucho más rápido. `id` lo genera la BD
    // (gen_random_uuid, pgcrypto) porque el raw SQL no pasa por el default de
    // Prisma. `xmax = 0` en el RETURNING distingue inserted (true) de updated.
    const values = [...byRuc.values()].map(
      (r) =>
        Prisma.sql`(gen_random_uuid(), ${r.ruc}, ${r.nombre}, ${r.sigla ?? null}, ${r.tipoDoc ?? null}, now(), now(), now())`,
    );
    const result = await this.prisma.$queryRaw<{ inserted: boolean }[]>(
      Prisma.sql`
        INSERT INTO entities (id, ruc, nombre, sigla, tipo_doc, ultimo_visto, created_at, updated_at)
        VALUES ${Prisma.join(values)}
        ON CONFLICT (ruc) DO UPDATE SET
          nombre       = EXCLUDED.nombre,
          sigla        = EXCLUDED.sigla,
          tipo_doc     = EXCLUDED.tipo_doc,
          ultimo_visto = now(),
          updated_at   = now()
        RETURNING (xmax = 0) AS inserted
      `,
    );

    let inserted = 0;
    let updated = 0;
    for (const row of result) {
      if (row.inserted) inserted++;
      else updated++;
    }
    return { inserted, updated };
  }
}
