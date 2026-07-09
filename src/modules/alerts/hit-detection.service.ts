import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  PROCESSES_REPO,
  type ProcessesRepoPort,
} from '../../ports/persistence/processes.repo.port';
import {
  SUBSCRIPTION_HITS_REPO,
  type SubscriptionHitsRepoPort,
} from '../../ports/persistence/subscription-hits.repo.port';
import {
  SUBSCRIPTIONS_REPO,
  type StoredSubscription,
  type SubscriptionsRepoPort,
} from '../../ports/persistence/subscriptions.repo.port';

/** Suscripciones que recibieron hits nuevos en esta corrida (para entrega inmediata). */
export type DetectedHits = Map<string, { sub: StoredSubscription; processIds: string[] }>;

/**
 * Matcher (docs/09 §2.1): cruza los anuncios ACF **recién insertados** por el crawl
 * contra las suscripciones activas y crea `subscription_hits` (dedup por unique).
 * Devuelve las suscripciones con hits nuevos para que el notifier entregue.
 */
@Injectable()
export class HitDetectionService {
  private readonly logger = new Logger(HitDetectionService.name);

  constructor(
    @Inject(PROCESSES_REPO) private readonly processes: ProcessesRepoPort,
    @Inject(SUBSCRIPTIONS_REPO) private readonly subs: SubscriptionsRepoPort,
    @Inject(SUBSCRIPTION_HITS_REPO) private readonly hits: SubscriptionHitsRepoPort,
  ) {}

  async detect(insertedProcessIds: string[]): Promise<DetectedHits> {
    const grouped: DetectedHits = new Map();
    if (insertedProcessIds.length === 0) return grouped;

    const procs = (await this.processes.findManyByIds(insertedProcessIds)).filter(
      (p) => p.tab === 'anuncios_futuros' && p.objeto,
    );
    let created = 0;
    for (const p of procs) {
      // Candidatas por objeto+entidad (SQL) y filtro por TEMA (F2, docs/22):
      // la alerta con keyword_terms exige que la descripción contenga alguno.
      // Determinista — los términos se congelaron al crear la alerta; el LLM
      // jamás participa en el momento del crawl.
      const matches = (
        await this.subs.findActiveMatching(p.objeto!, p.entityNombre ?? null)
      ).filter((sub) => matchesTheme(sub.keywordTerms, p.descripcion));
      for (const sub of matches) {
        if (await this.hits.createIfNew(sub.id, p.id)) {
          created++;
          const g = grouped.get(sub.id) ?? { sub, processIds: [] };
          g.processIds.push(p.id);
          grouped.set(sub.id, g);
        }
      }
    }
    if (created > 0) {
      this.logger.log(`matcher: ${created} hits nuevos en ${grouped.size} alertas`);
    }
    return grouped;
  }
}

/**
 * ¿El anuncio corresponde al tema de la alerta? Sin términos → alerta clásica
 * (pasa siempre). Con términos → la descripción debe contener ALGUNO, comparando
 * normalizado (minúsculas, sin tildes) para tolerar la acentuación inconsistente
 * de SEACE. Exportada para poder testearla directo.
 */
export function matchesTheme(
  terms: string[] | null | undefined,
  descripcion: string | null,
): boolean {
  if (!terms?.length) return true;
  if (!descripcion) return false;
  const desc = normalize(descripcion);
  return terms.some((t) => {
    const term = normalize(t);
    return term.length > 0 && desc.includes(term);
  });
}

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}
