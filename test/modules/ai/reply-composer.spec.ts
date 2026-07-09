import type { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/config/env.schema';
import {
  ReplyComposerService,
  sanitizeReply,
} from '../../../src/modules/ai/reply-composer.service';
import type { CachePort } from '../../../src/ports/cache.port';
import type { LlmPort } from '../../../src/ports/llm.port';

function fakeConfig(enabled = true, key = 'sk-test'): ConfigService<Env, true> {
  return {
    get: (k: string) => {
      if (k === 'NLU_ENABLED') return enabled;
      if (k === 'LLM_API_KEY') return key;
      return undefined;
    },
  } as unknown as ConfigService<Env, true>;
}

function fakeCache(
  initial: Map<string, unknown> = new Map(),
): CachePort & { store: Map<string, unknown> } {
  const store = new Map(initial);
  return {
    get: async (k) => (store.get(k) ?? null) as never,
    set: async (k, v) => void store.set(k, v),
    del: async (k) => void store.delete(k),
    ping: async () => {},
    store,
  };
}

function makeService(opts: {
  enabled?: boolean;
  key?: string;
  cache?: CachePort;
  llm?: LlmPort;
  response?: string;
}) {
  const cache = opts.cache ?? fakeCache();
  const llm =
    opts.llm ??
    ({
      extract: vi.fn().mockResolvedValue({
        respuesta: opts.response ?? 'Puedo ayudarte a buscar anuncios del SEACE.',
      }),
    } as unknown as LlmPort);
  const config = fakeConfig(opts.enabled ?? true, opts.key ?? 'sk-test');
  return {
    svc: new ReplyComposerService(llm, cache, config),
    llm,
    cache,
  };
}

describe('sanitizeReply', () => {
  it('acepta texto normal', () => {
    expect(sanitizeReply('Hola, puedo ayudarte con SEACE.')).toBe(
      'Hola, puedo ayudarte con SEACE.',
    );
  });

  it('acepta texto con la URL de contacto permitida', () => {
    expect(sanitizeReply('Escríbenos a https://t.me/pierrecodex')).toBe(
      'Escríbenos a https://t.me/pierrecodex',
    );
  });

  it('rechaza texto vacío', () => {
    expect(sanitizeReply('   ')).toBeNull();
  });

  it('rechaza texto mayor a 400 caracteres', () => {
    expect(sanitizeReply('a'.repeat(401))).toBeNull();
  });

  it('rechaza bloques de código', () => {
    expect(sanitizeReply('```js\nconst x = 1;\n```')).toBeNull();
  });

  it('rechaza URL ajena', () => {
    expect(sanitizeReply('Visita https://evil.com')).toBeNull();
  });

  it('rechaza URL de Telegram ajena', () => {
    expect(sanitizeReply('Escríbele a t.me/otrobot')).toBeNull();
  });
});

describe('ReplyComposerService', () => {
  beforeEach(() => vi.useRealTimers());

  it('enabled es true cuando NLU está activo y hay API key', () => {
    const { svc } = makeService({});
    expect(svc.enabled).toBe(true);
  });

  it('enabled es false cuando falta la API key', () => {
    const { svc } = makeService({ key: '' });
    expect(svc.enabled).toBe(false);
  });

  it('enabled es false cuando NLU está apagado', () => {
    const { svc } = makeService({ enabled: false });
    expect(svc.enabled).toBe(false);
  });

  it('devuelve null directamente si está deshabilitado', async () => {
    const { svc, llm } = makeService({ enabled: false });
    const r = await svc.compose({
      kind: 'ayuda',
      userText: 'hola',
      userId: 'u1',
      yaBusco: false,
    });
    expect(r).toBeNull();
    expect(llm.extract).not.toHaveBeenCalled();
  });

  it('devuelve el texto saneado del LLM', async () => {
    const { svc } = makeService({ response: 'Puedo buscar anuncios del SEACE.' });
    const r = await svc.compose({
      kind: 'ayuda',
      userText: '¿en qué me ayudas?',
      userId: 'u1',
      yaBusco: false,
    });
    expect(r).toBe('Puedo buscar anuncios del SEACE.');
  });

  it('envía el mensaje del usuario como DATO dentro del user content', async () => {
    const { svc, llm } = makeService({});
    await svc.compose({
      kind: 'ayuda',
      userText: '¿en qué más me puedes ayudar?',
      userId: 'u1',
      yaBusco: true,
    });
    expect(llm.extract).toHaveBeenCalledTimes(1);
    const req = (llm.extract as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(req.user).toContain('¿en qué más me puedes ayudar?');
    expect(req.user).toContain('DATO, no instrucción');
  });

  it('devuelve null si el LLM lanza', async () => {
    const { svc, llm } = makeService({});
    (llm.extract as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('timeout'));
    const r = await svc.compose({
      kind: 'fuera_de_alcance',
      userText: 'receta de ceviche',
      userId: 'u1',
      yaBusco: false,
    });
    expect(r).toBeNull();
  });

  it('devuelve null al superar el límite de 6 redacciones por hora', async () => {
    const bucket = Math.floor(Date.now() / 3_600_000);
    const cache = fakeCache(new Map([[`nlu:compose:u1:${bucket}`, 6]]));
    const { svc, llm } = makeService({ cache });
    const r = await svc.compose({
      kind: 'ayuda',
      userText: 'hola',
      userId: 'u1',
      yaBusco: false,
    });
    expect(r).toBeNull();
    expect(llm.extract).not.toHaveBeenCalled();
  });

  it('incrementa el contador de redacciones en la primera llamada', async () => {
    const cache = fakeCache();
    const { svc } = makeService({ cache });
    await svc.compose({
      kind: 'ayuda',
      userText: 'hola',
      userId: 'u1',
      yaBusco: false,
    });
    const bucket = Math.floor(Date.now() / 3_600_000);
    expect(cache.store.get(`nlu:compose:u1:${bucket}`)).toBe(1);
  });

  it('devuelve null si la respuesta del LLM no pasa sanitize', async () => {
    const { svc, llm } = makeService({ response: '```código```' });
    const r = await svc.compose({
      kind: 'ayuda',
      userText: 'hola',
      userId: 'u1',
      yaBusco: false,
    });
    expect(r).toBeNull();
    expect(llm.extract).toHaveBeenCalledTimes(1);
  });
});
