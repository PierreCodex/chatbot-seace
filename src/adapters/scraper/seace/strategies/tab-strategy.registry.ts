import { Injectable } from '@nestjs/common';
import type { TabName } from '../../../../ports/persistence/types';
import { ProcedimientosStrategy } from './procedimientos.strategy';
import type { TabStrategy } from './tab.strategy';

@Injectable()
export class TabStrategyRegistry {
  private readonly strategies: Map<TabName, TabStrategy>;

  constructor(procedimientos: ProcedimientosStrategy) {
    this.strategies = new Map<TabName, TabStrategy>([['procedimientos', procedimientos]]);
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
