import { describe, it, expect } from 'vitest';
import { EQUIPMENT_MAP, extractEquipment, listBrands, listModels } from './equipment';

describe('EQUIPMENT_MAP', () => {
  it('son 82 códigos: los 46 del catálogo original y 36 de la lista de la EPA', () => {
    expect(Object.keys(EQUIPMENT_MAP)).toHaveLength(82);
  });

  it('cada entrada trae marca, modelo y contaminante', () => {
    for (const [code, equipo] of Object.entries(EQUIPMENT_MAP)) {
      expect(equipo.brand, `${code} sin marca`).toBeTruthy();
      expect(equipo.model, `${code} sin modelo`).toBeTruthy();
      expect(equipo.pollutant, `${code} sin contaminante`).toBeTruthy();
    }
  });

  // Una errata al copiar un código nuevo lo dejaría sin reconocer en silencio.
  it('cada código EPA tiene la forma XXXX-0000-000', () => {
    for (const code of Object.keys(EQUIPMENT_MAP)) {
      if (code.startsWith('UNE')) continue;
      expect(code).toMatch(/^(RF|EQ)[A-Z]{2}-\d{4}-\d{3}$/);
    }
  });
});

describe('extractEquipment', () => {
  it('reconoce un código de equipo dentro del texto del método', () => {
    const eq = extractEquipment('Método de referencia EQPM-0798-122 según protocolo');
    expect(eq?.brand).toBe('Met One Instruments, Inc.');
    expect(eq?.model).toBe('BAM 1020');
    expect(eq?.pollutant).toBe('Partículas');
  });

  it('devuelve null si el método no contiene ningún código conocido', () => {
    expect(extractEquipment('SM 2320 B')).toBeNull();
  });

  it('devuelve null ante un método vacío', () => {
    expect(extractEquipment('')).toBeNull();
  });

  it('distingue las dos grafías de la norma UNE-EN que conviven en el catálogo', () => {
    expect(extractEquipment('Norma UNE-EN 16450')?.model).toBe('EDM180');
    expect(extractEquipment('Norma UNE EN 16450')?.model).toBe('EDM180');
  });

  it('ignora un método que no cita ningún código', () => {
    expect(extractEquipment('Método interno basado en la norma ASTM D1739')).toBeNull();
  });

  it('reconoce un muestreador de PM de la lista de la EPA', () => {
    expect(extractEquipment('Método de Referencia Manual RFPS-1014-219')).toEqual({
      code: 'RFPS-1014-219',
      brand: 'Tisch Environmental',
      model: 'TE-Wilbur2.5',
      pollutant: 'Partículas',
    });
  });

  // Los analizadores de olores (H₂S, TRS) se acreditan con su designación de SO₂.
  it('reconoce un analizador que se acredita para olores', () => {
    expect(extractEquipment('Método Equivalente Automatizado EQSA-0802-149')).toEqual({
      code: 'EQSA-0802-149',
      brand: 'Environnement S.A. / ENVEA',
      model: 'AF22M / AF22e',
      pollutant: 'SO₂',
    });
  });

  it('un código con dos fabricantes trae los dos en la marca', () => {
    const eq = extractEquipment('Método de Referencia Manual RFPS-0202-141');
    expect(eq?.brand).toBe('Tisch Environmental / New Star Environmental');
    expect(eq?.model).toBe('TE-6070 / NS-6070');
  });

  // El dataset lo escribe «RFNA-1289-0704»: no está en la lista de la EPA.
  it('RFNA-1289-070 no está en la lista de la EPA y no se reconoce', () => {
    expect(EQUIPMENT_MAP['RFNA-1289-070']).toBeUndefined();
    expect(extractEquipment('Método de Referencia Automatizado RFNA-1289-070')).toBeNull();
    expect(extractEquipment('Método de Referencia Automatizado RFNA-1289-0704')).toBeNull();
  });
});

describe('listBrands / listModels', () => {
  it('lista las marcas sin repetir y ordenadas', () => {
    const brands = listBrands();
    expect(brands).toEqual([...brands].sort((a, b) => a.localeCompare(b, 'es')));
    expect(new Set(brands).size).toBe(brands.length);
    expect(brands).toContain('Teledyne API');
  });

  it('lista los modelos de una marca', () => {
    expect(listModels('Horiba')).toEqual(['APMA-370', 'APNA-370', 'APOA-370', 'APSA-370']);
  });

  it('devuelve lista vacía para una marca desconocida', () => {
    expect(listModels('No Existe')).toEqual([]);
  });
});
