import { describe, it, expect } from 'vitest';
import { EQUIPMENT_MAP, extractEquipment, listBrands, listModels } from './equipment';

describe('EQUIPMENT_MAP', () => {
  it('conserva los 46 equipos del catálogo original', () => {
    expect(Object.keys(EQUIPMENT_MAP)).toHaveLength(46);
  });

  it('cada entrada trae marca, modelo y contaminante', () => {
    for (const [code, equipo] of Object.entries(EQUIPMENT_MAP)) {
      expect(equipo.brand, `${code} sin marca`).toBeTruthy();
      expect(equipo.model, `${code} sin modelo`).toBeTruthy();
      expect(equipo.pollutant, `${code} sin contaminante`).toBeTruthy();
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
