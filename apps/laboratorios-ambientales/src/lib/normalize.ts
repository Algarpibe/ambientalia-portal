// Los valores canónicos salen del dataset real (2waz-acaa): estado solo toma
// 'Activa' (18 689 registros) o 'Suspendida' (367). Cualquier otra cosa es ruido.
export type EstadoAcreditacion = 'Activa' | 'Suspendida' | '';

export function normalizeEstado(value: string): EstadoAcreditacion {
  if (!value) return '';
  const v = value.toLowerCase().trim();
  if (v === 'activa') return 'Activa';
  if (v === 'suspendida') return 'Suspendida';
  return '';
}

// Title-case Unicode-aware. Es la política por defecto de las facetas de texto
// libre: unifica las grafías que el dataset trae divergentes ('Olores ofensivos'
// vs 'Olores Ofensivos'), que si no serían dos opciones de filtro para lo mismo.
export function toTitleCase(value: string): string {
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

// Regla explícita solo para lo que los datos exigen. Nada de colapsar por
// subcadena «por si acaso»: 'Agua de Poro' existe como componente real, así que
// un includes('agua') destruiría esa faceta si mañana llega como matriz.
export function normalizeMatriz(value: string): string {
  if (!value) return '';
  const v = value.toLowerCase().trim();
  // Sin esta regla el title-case rompería el acrónimo en '(Respel)'. Une además
  // las dos grafías reales: 'Residuos Peligrosos (RESPEL)' y 'ReSIduos ...'.
  if (v.includes('residuos peligrosos')) return 'Residuos Peligrosos (RESPEL)';
  return toTitleCase(value);
}

export function normalizeComponente(value: string): string {
  if (!value) return '';
  const v = value.toLowerCase().trim();
  // Mismo motivo que en normalizeMatriz, y además así la categoría sale con la
  // misma grafía en los dos filtros (matriz y componente).
  if (v.includes('residuos peligrosos')) return 'Residuos Peligrosos (RESPEL)';
  // El dataset trae 'Calidad del Aire' (1302) y 'Calidad de aire' (15): la misma
  // faceta con distinta preposición. Canónica la mayoritaria, que además es el
  // español correcto. La Task 7 filtra el Análisis de Marcas por este literal.
  if (v.includes('calidad de aire') || v.includes('calidad del aire')) return 'Calidad del Aire';
  return toTitleCase(value);
}

// 'actividad' es texto libre sin colapsos propios: title-case y ya.
export const normalizeActividad = toTitleCase;
