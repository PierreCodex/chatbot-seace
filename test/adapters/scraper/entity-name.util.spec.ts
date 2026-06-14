import { describe, expect, it } from 'vitest';
import {
  normalizeEntityName,
  sameEntityName,
} from '../../../src/adapters/scraper/seace/entity-name.util';

describe('entity-name util (filtro ACF por entidad)', () => {
  it('normaliza mayúsculas, tildes y espacios', () => {
    expect(normalizeEntityName('  Gobierno  Regional  de  San Martín ')).toBe(
      'GOBIERNO REGIONAL DE SAN MARTIN',
    );
    expect(normalizeEntityName('Universidad Nacional de Cañete')).toBe(
      'UNIVERSIDAD NACIONAL DE CANETE',
    );
    expect(normalizeEntityName(null)).toBe('');
  });

  it('matchea mismo nombre con distinta caja/tildes/espacios', () => {
    expect(
      sameEntityName(
        'GOBIERNO REGIONAL DE SAN MARTÍN - DIRECCION SUB REGIONAL DE SALUD',
        'gobierno regional de san martin - direccion sub regional de salud',
      ),
    ).toBe(true);
    expect(sameEntityName('MINISTERIO DE SALUD', 'MINISTERIO  DE  SALUD')).toBe(true);
  });

  it('no matchea entidades distintas ni cadenas vacías', () => {
    expect(
      sameEntityName(
        'MUNICIPALIDAD DISTRITAL DE SAN LUIS - LIMA',
        'MUNICIPALIDAD DISTRITAL DE SAN LUIS - CANETE',
      ),
    ).toBe(false);
    expect(sameEntityName('', 'MINISTERIO DE SALUD')).toBe(false);
    expect(sameEntityName(null, null)).toBe(false);
  });
});
