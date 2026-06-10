import { Injectable } from '@nestjs/common';
import type { TabName } from '../../../../ports/persistence/types';
import { AnunciosFuturosStrategy } from './anuncios-futuros.strategy';
import { ProcedimientosStrategy } from './procedimientos.strategy';
import type { TabStrategy } from './tab.strategy';

@Injectable()
export class TabStrategyRegistry {
  private readonly strategies: Map<TabName, TabStrategy>;

  constructor(procedimientos: ProcedimientosStrategy, anunciosFuturos: AnunciosFuturosStrategy) {
    this.strategies = new Map<TabName, TabStrategy>([
      ['procedimientos', procedimientos],
      ['anuncios_futuros', anunciosFuturos],
    ]);
  }

  get(tab: TabName): TabStrategy {
    const s = this.strategies.get(tab);
    if (!s) {
      throw new Error(
        `Estrategia para "${tab}" no implementada todavía. Pestañas disponibles: ${[
          ...this.strategies.keys(),
        ].join(', ')}`,
      );
    }
    return s;
  }
}
