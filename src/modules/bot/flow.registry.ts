import { Injectable } from '@nestjs/common';
import type { Flow } from './types';

@Injectable()
export class FlowRegistry {
  private readonly flows = new Map<string, Flow>();

  register(flow: Flow): void {
    this.flows.set(flow.id, flow);
  }

  get(id: string): Flow | undefined {
    return this.flows.get(id);
  }
}
