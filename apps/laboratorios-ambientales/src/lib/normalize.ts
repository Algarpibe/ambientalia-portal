// Los valores canónicos salen del dataset real (2waz-acaa): estado solo toma
// 'Activa' (18 689 registros) o 'Suspendida' (367). Cualquier otra cosa es ruido.
export type EstadoAcreditacion = 'Activa' | 'Suspendida' | '';

export function normalizeEstado(value: string): EstadoAcreditacion {
  const v = (value || '').toLowerCase().trim();
  if (v === 'activa') return 'Activa';
  if (v === 'suspendida') return 'Suspendida';
  return '';
}

export function normalizeMatriz(value: string): string {
  if (!value) return '';
  const v = value.toLowerCase().trim();
  // RESPEL va primero: su descripción puede contener «agua».
  if (v.includes('residuos peligrosos')) return 'Residuos Peligrosos (RESPEL)';
  if (v.includes('agua')) return 'Agua';
  if (v.includes('aire')) return 'Aire';
  if (v.includes('suelo')) return 'Suelo';
  // El dataset trae la misma matriz con distinta capitalización ('Aceite Dieléctrico'
  // vs 'Aceite dieléctrico'): sin unificar, cada grafía sería una opción de filtro.
  return normalizeActividad(value);
}

export function normalizeComponente(value: string): string {
  if (!value) return '';
  const v = value.toLowerCase().trim();
  // El dataset trae 'Calidad del Aire' (1302) y 'Calidad de aire' (15): la misma
  // faceta con distinta preposición. La Task 7 filtra por el literal canónico.
  if (v.includes('calidad de aire') || v.includes('calidad del aire')) return 'Calidad de aire';
  if (v.includes('fuentes fijas')) return 'Fuentes Fijas';
  // Regla explícita, igual que en normalizeMatriz: el title-case del fallthrough
  // convertiría el acrónimo en '(Respel)' y la misma categoría saldría con dos
  // grafías según el filtro (matriz vs componente).
  if (v.includes('residuos peligrosos')) return 'Residuos Peligrosos (RESPEL)';
  // Mismo motivo que en normalizeMatriz: 'Olores ofensivos' vs 'Olores Ofensivos',
  // 'Biota acuática marina' vs 'Biota Acuática Marina'... cada grafía sería un filtro.
  return normalizeActividad(value);
}

export function normalizeActividad(value: string): string {
  if (!value) return '';
  // \b\w es ASCII: en «análisis» la «á» abre un límite de palabra y saldría
  // «AnáLisis». \p{L} con lookbehind sí respeta las tildes del dataset.
  // El colapso de espacios va antes: el dataset trae 'Muestreo  Integrado en Cuerpo
  // Lótico' con espacio doble (7) junto al de espacio simple (831), y sin unificar
  // serían dos opciones distintas.
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/(?<![\p{L}\p{N}])\p{L}/gu, (l) => l.toUpperCase());
}
