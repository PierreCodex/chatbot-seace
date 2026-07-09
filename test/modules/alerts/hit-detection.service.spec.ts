import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HitDetectionService,
  matchesTheme,
} from '../../../src/modules/alerts/hit-detection.service';

const processes = { findManyByIds: vi.fn() };
const subs = { findActiveMatching: vi.fn() };
const hits = { createIfNew: vi.fn() };

function make(): HitDetectionService {
  return new HitDetectionService(processes as never, subs as never, hits as never);
}

const acfProc = (id: string, objeto = 'obra', entityNombre = 'GORE PIURA') => ({
  id,
  tab: 'anuncios_futuros',
  objeto,
  entityNombre,
});

describe('HitDetectionService.detect', () => {
  let svc: HitDetectionService;
  beforeEach(() => {
    vi.clearAllMocks();
    hits.createIfNew.mockResolvedValue(true);
    svc = make();
  });

  it('lista vacía → no consulta nada', async () => {
    const r = await svc.detect([]);
    expect(r.size).toBe(0);
    expect(processes.findManyByIds).not.toHaveBeenCalled();
  });

  it('un anuncio nuevo crea hits para las alertas que matchean (A1 + A2)', async () => {
    processes.findManyByIds.mockResolvedValue([acfProc('p1')]);
    subs.findActiveMatching.mockResolvedValue([
      { id: 's-a2', frequency: 'hourly' }, // objeto-solo
      { id: 's-a1', frequency: 'daily' }, // entidad+objeto
    ]);
    const r = await svc.detect(['p1']);
    expect(subs.findActiveMatching).toHaveBeenCalledWith('obra', 'GORE PIURA');
    expect(hits.createIfNew).toHaveBeenCalledTimes(2);
    expect([...r.keys()].sort()).toEqual(['s-a1', 's-a2']);
    expect(r.get('s-a2')!.processIds).toEqual(['p1']);
  });

  it('si el hit ya existía (dedup) no entra al grupo', async () => {
    processes.findManyByIds.mockResolvedValue([acfProc('p1')]);
    subs.findActiveMatching.mockResolvedValue([{ id: 's1', frequency: 'hourly' }]);
    hits.createIfNew.mockResolvedValue(false);
    const r = await svc.detect(['p1']);
    expect(r.size).toBe(0);
  });

  it('ignora procesos que no son ACF o sin objeto', async () => {
    processes.findManyByIds.mockResolvedValue([
      { id: 'p1', tab: 'procedimientos', objeto: 'obra' },
      { id: 'p2', tab: 'anuncios_futuros', objeto: null },
    ]);
    const r = await svc.detect(['p1', 'p2']);
    expect(subs.findActiveMatching).not.toHaveBeenCalled();
    expect(r.size).toBe(0);
  });

  it('F2: crea hits SOLO para alertas cuyo TEMA coincide (o sin tema)', async () => {
    processes.findManyByIds.mockResolvedValue([
      {
        id: 'p1',
        tab: 'anuncios_futuros',
        objeto: 'servicio',
        entityNombre: 'SUNASS',
        descripcion: 'Servicio de internet dedicado, telefonía fija e interconexión',
      },
    ]);
    subs.findActiveMatching.mockResolvedValue([
      { id: 's-fibra', keywordTerms: ['fibra óptica', 'internet'] }, // coincide
      { id: 's-carretera', keywordTerms: ['carretera', 'pavimentación'] }, // NO
      { id: 's-clasica', keywordTerms: [] }, // clásica: pasa siempre
    ]);
    const r = await svc.detect(['p1']);
    const hitSubIds = hits.createIfNew.mock.calls.map((c) => c[0]);
    expect(hitSubIds).toContain('s-fibra');
    expect(hitSubIds).toContain('s-clasica');
    expect(hitSubIds).not.toContain('s-carretera');
    expect([...r.keys()].sort()).toEqual(['s-clasica', 's-fibra']);
  });
});

describe('matchesTheme (filtro por tema, F2)', () => {
  it('alerta sin términos (clásica) matchea siempre', () => {
    expect(matchesTheme([], 'CUALQUIER DESCRIPCIÓN')).toBe(true);
    expect(matchesTheme(undefined, 'CUALQUIER DESCRIPCIÓN')).toBe(true);
    expect(matchesTheme(null, null)).toBe(true);
  });

  it('matchea si la descripción contiene ALGUNO de los términos', () => {
    const terms = ['fibra óptica', 'telecomunicaciones', 'internet'];
    expect(matchesTheme(terms, 'SERVICIO DE INTERNET DEDICADO PARA LAS SEDES')).toBe(true);
    expect(matchesTheme(terms, 'MEJORAMIENTO DE LA CARRETERA VECINAL')).toBe(false);
  });

  it('normaliza tildes y mayúsculas en ambos lados (SEACE es inconsistente)', () => {
    expect(matchesTheme(['fibra óptica'], 'TENDIDO DE FIBRA OPTICA EN ZONA RURAL')).toBe(true);
    expect(matchesTheme(['educacion'], 'SERVICIO DE EDUCACIÓN PRIMARIA')).toBe(true);
  });

  it('con términos pero sin descripción NO matchea (no adivina)', () => {
    expect(matchesTheme(['fibra'], null)).toBe(false);
  });

  it('ignora términos vacíos', () => {
    expect(matchesTheme(['', '  '], 'ALGO')).toBe(false);
  });
});
