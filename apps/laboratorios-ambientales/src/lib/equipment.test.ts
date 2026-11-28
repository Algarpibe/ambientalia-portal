import { describe, it, expect } from 'vitest';
import { EQUIPMENT_MAP, extractEquipment, listBrands, listModels, normalizarCodigosEpa } from './equipment';

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

  // Revisadas contra la lista de la EPA del 28 de julio de 2026.
  it('las entradas del prototipo que no cuadraban con la lista de la EPA, corregidas', () => {
    expect(EQUIPMENT_MAP['EQPM-0308-170']).toEqual({
      brand: 'Met One Instruments, Inc.',
      model: 'BAM-1020',
      pollutant: 'Partículas',
    });
    expect(EQUIPMENT_MAP['EQPM-0715-266']).toEqual({
      brand: 'Met One Instruments, Inc.',
      model: 'BAM-1020',
      pollutant: 'Partículas',
    });
    expect(EQUIPMENT_MAP['RFSA-0616-237']).toEqual({ brand: 'Sutron / Sabio', model: '6020 SO2 Analyzer', pollutant: 'SO₂' });
    expect(EQUIPMENT_MAP['EQPM-0923-262'].model).toBe('Vair-9009');
    expect(EQUIPMENT_MAP['EQPM-0798-122']).toEqual({
      brand: 'Met One Instruments, Inc.',
      model: 'BAM 1020 / BAM 1020-1',
      pollutant: 'Partículas',
    });
  });

  // Horiba APDA-371, Spirant y Sibata GBAM son marcas blancas del Met One BAM.
  it('ninguna entrada nombra como modelo las marcas blancas del BAM', () => {
    for (const [code, equipo] of Object.entries(EQUIPMENT_MAP)) {
      expect(equipo.model, `${code} nombra APDA-371`).not.toContain('APDA-371');
      expect(equipo.model, `${code} nombra Spirant`).not.toContain('Spirant');
      expect(equipo.model, `${code} nombra GBAM`).not.toContain('GBAM');
    }
  });

  // Entradas añadidas que dejaban fuera variantes de modelo que nombra la lista.
  it('las entradas añadidas con variantes de modelo que faltaban, completadas', () => {
    expect(EQUIPMENT_MAP['EQOA-0193-091'].model).toBe(
      'ML9810 / CM2010 / EC9810 / AE2010 / AE9810 (los cinco también en -11 y -12) / ML9810B / CM2010B / EC9810B / 1010',
    );
    expect(EQUIPMENT_MAP['EQSA-0193-092'].model).toBe(
      'ML9850 / CM2050 / EC9850 / EC9850T / AE9850 / AE2050 / ML9850B / CM2050B / EC9850B / 1040',
    );
    expect(EQUIPMENT_MAP['RFNA-0118-249'].model).toBe('AC32e / AC32e*');
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
    expect(eq?.model).toBe('BAM 1020 / BAM 1020-1');
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

  it('reconoce un código escrito con espacios en vez de guiones', () => {
    const eq = extractEquipment('Apéndice L. EQPM 0311-195');
    expect(eq?.code).toBe('EQPM-0311-195');
    expect(eq?.pollutant).toBe('Partículas');
  });

  // El dataset escribe «RFNA 0506-158» para el monitor de CO de Horiba: es una
  // errata de RFCA-0506-158.
  it('«RFNA 0506-158» se reconoce como el monitor de CO de Horiba', () => {
    const eq = extractEquipment('Método de Referencia Automatizado, Apéndice C. RFNA 0506-158');
    expect(eq?.code).toBe('RFCA-0506-158');
    expect(eq?.brand).toBe('Horiba');
    expect(eq?.model).toBe('APMA-370 / 380');
    expect(eq?.pollutant).toBe('CO');
  });
});

describe('normalizarCodigosEpa', () => {
  it('pasa a guiones los códigos con espacios', () => {
    expect(normalizarCodigosEpa('Apéndice L. EQPM 0311-195')).toBe('Apéndice L. EQPM-0311-195');
    expect(normalizarCodigosEpa('RFPS- 0202-141')).toBe('RFPS-0202-141');
  });

  it('deja intacto el texto que no es un código EPA', () => {
    for (const texto of ['Método 5 - 10 ppm', 'NTC 3362 C', 'SM 2320 B', 'Norma UNE-EN 16450', '']) {
      expect(normalizarCodigosEpa(texto), texto).toBe(texto);
    }
  });

  it('corrige la errata RFNA-0506-158 después de normalizar los espacios', () => {
    expect(normalizarCodigosEpa('RFNA 0506-158')).toBe('RFCA-0506-158');
    expect(normalizarCodigosEpa('RFNA-0506-158')).toBe('RFCA-0506-158');
  });

  it('no toca el código real RFNA-0506-157', () => {
    expect(normalizarCodigosEpa('RFNA 0506-157')).toBe('RFNA-0506-157');
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
    expect(listModels('Horiba')).toEqual(['APMA-370 / 380', 'APNA-370 / 380', 'APOA-370 / 380', 'APSA-370 / 380']);
  });

  it('devuelve lista vacía para una marca desconocida', () => {
    expect(listModels('No Existe')).toEqual([]);
  });

  it('cada fabricante es una opción: ninguna es un texto de co-fabricantes', () => {
    const brands = listBrands();
    expect(brands).toContain('Tisch Environmental');
    expect(brands).toContain('New Star Environmental');
    expect(brands).not.toContain('Tisch Environmental / New Star Environmental');
  });

  it('las empresas con nombre viejo y nuevo son una sola opción', () => {
    const brands = listBrands();
    expect(brands).toContain('Environnement S.A. / ENVEA');
    expect(brands).not.toContain('Environnement S.A.');
    expect(brands).not.toContain('ENVEA');
  });

  it('los modelos de un fabricante incluyen los de los textos de co-fabricantes', () => {
    const combinada = Object.values(EQUIPMENT_MAP).find(
      (e) => e.brand === 'Tisch Environmental / New Star Environmental',
    );
    expect(combinada).toBeDefined();
    expect(listModels('Tisch Environmental')).toContain(combinada?.model);
    expect(listModels('New Star Environmental')).toContain(combinada?.model);
  });

  it('Thermo Scientific es una sola opción y no quedan sus nombres anteriores', () => {
    const brands = listBrands();
    expect(brands.filter((b) => b === 'Thermo Scientific')).toHaveLength(1);
    for (const viejo of ['Thermo Environmental', 'Thermo Andersen', 'Rupprecht & Patashnick']) {
      expect(brands).not.toContain(viejo);
    }
  });

  it('los modelos de Thermo Scientific incluyen los de sus nombres anteriores', () => {
    const modelos = listModels('Thermo Scientific');
    expect(modelos).toContain('42i / 42iQ Series');
    expect(modelos).toContain('Partisol 2000-D / 2000i-D');
  });

  it('Advanced Pollution Instrumentation se une a Teledyne API; Teledyne Monitor Labs queda aparte', () => {
    const brands = listBrands();
    expect(brands).not.toContain('Advanced Pollution Instrumentation');
    expect(brands).toContain('Teledyne Monitor Labs');
    expect(listModels('Teledyne API')).toContain('100');
  });
});
