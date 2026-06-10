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
    // pg_trgm % operator usa los índices GIN trigram que armamos en la migración.
    return this.prisma.$queryRaw<StoredEntity[]>(
      Prisma.sql`
        SELECT *
          FROM entities
         WHERE nombre % ${term}
            OR sigla  % ${term}
         ORDER BY GREATEST(similarity(nombre, ${term}), similarity(coalesce(sigla,''), ${term})) DESC
         LIMIT ${limit}
      `,
    );
  }

  findByRuc(ruc: string): Promise<StoredEntity | null> {
    return this.prisma.entity.findUnique({ where: { ruc } });
  }

  async upsertManyByRuc(rows: EntityUpsertInput[]): Promise<{ inserted: number; updated: number }> {
    // Upserts independientes e idempotentes — no necesitan transacción.
    // Paralelizamos contra el pool para evitar el timeout default de 5s de
    // $transaction cuando hay 30+ filas a través de pooler remoto.
    const results = await Promise.all(
      rows.map((r) =>
        this.prisma.entity.upsert({
          where: { ruc: r.ruc },
          create: { ruc: r.ruc, nombre: r.nombre, sigla: r.sigla, tipoDoc: r.tipoDoc },
          update: {
            nombre: r.nombre,
            sigla: r.sigla,
            tipoDoc: r.tipoDoc,
            ultimoVisto: new Date(),
          },
        }),
      ),
    );
    let inserted = 0;
    let updated = 0;
    for (const result of results) {
      // Heurística: createdAt == updatedAt (truncado a ms) ⇒ insertado.
      if (result.createdAt.getTime() === result.updatedAt.getTime()) inserted++;
      else updated++;
    }
    return { inserted, updated };
  }
}
