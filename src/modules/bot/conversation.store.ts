import { Injectable } from '@nestjs/common';
import { CACHE_PORT, type CachePort } from '../../ports/cache.port';
import { Inject } from '@nestjs/common';
import type { ConversationState } from './types';

const CONVERSATION_PREFIX = 'conv:';
const TTL_SECONDS = 30 * 60; // 30 minutos

@Injectable()
export class ConversationStore {
  constructor(@Inject(CACHE_PORT) private readonly cache: CachePort) {}

  private key(phoneNumber: string): string {
    return `${CONVERSATION_PREFIX}${phoneNumber}`;
  }

  async get(phoneNumber: string): Promise<ConversationState | null> {
    return this.cache.get<ConversationState>(this.key(phoneNumber));
  }

  async set(state: ConversationState): Promise<void> {
    await this.cache.set(this.key(state.phoneNumber), state, TTL_SECONDS);
  }

  async del(phoneNumber: string): Promise<void> {
    await this.cache.del(this.key(phoneNumber));
  }
}
