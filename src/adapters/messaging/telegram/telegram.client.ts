import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Api } from 'grammy';
import type { Env } from '../../../config/env.schema';

/**
 * Envoltorio fino del `Api` de grammY (usado como cliente standalone, sin el
 * framework `Bot`/dispatch). El timeout de red lo provee grammY vía
 * `timeoutSeconds`; no hace falta envolverlo en `seaceFetch`. Solo se instancia
 * cuando MESSAGING_CHANNEL=telegram (el composition root lo carga condicionalmente),
 * por eso es seguro exigir el token acá.
 */
@Injectable()
export class TelegramClient {
  readonly api: Api;

  constructor(config: ConfigService<Env, true>) {
    const token = config.get('TELEGRAM_BOT_TOKEN', { infer: true }) ?? '';
    if (!token) {
      throw new Error('TELEGRAM_BOT_TOKEN is required but not configured');
    }
    this.api = new Api(token, { timeoutSeconds: 12 });
  }
}
