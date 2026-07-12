// Sufijos legales comunes a eliminar (Colombia, LATAM, España)
const legalSuffixes = [
  's.a.s.', 's.a.s', 'sas',
  's.a.', 'sa', 's. a.',
  'ltda.', 'ltda', 'limitada',
  's.r.l.', 's.r.l', 'srl',
  's.l.', 's.l', 'sl',
  's.c.', 'sc',
  'cia.', 'cia', 'compañia',
  'inc.', 'inc', 'incorporated',
  'corp.', 'corp', 'corporation',
  'llc', 'l.l.c.',
  'e.u.', 'eu',
  'y asociados', '& asociados', '& cia', 'y cia',
  'de colombia', 'colombia'
];

/**
 * Normaliza un nombre de cliente para matching
 * - Convierte a minúsculas
 * - Elimina acentos
 * - Elimina sufijos legales
 * - Elimina símbolos y puntuación
 * - Colapsa espacios múltiples
 */
export function normalizeClientName(name: string): string {
  let result = name.toLowerCase().trim();
  
  // Eliminar acentos
  result = result.normalize('NFD').replace(/\p{Diacritic}/gu, '');
  
  // Eliminar puntuación y símbolos (excepto espacios)
  result = result.replace(/[.,\-_()[\]{}'"!@#$%^&*+=|\\/<>:;]/g, ' ');
  
  // Eliminar sufijos legales (de más largo a más corto para evitar matches parciales)
  const sortedSuffixes = [...legalSuffixes].sort((a, b) => b.length - a.length);
  for (const suffix of sortedSuffixes) {
    const escapedSuffix = suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`\\b${escapedSuffix}\\b`, 'gi');
    result = result.replace(pattern, ' ');
  }
  
  // Colapsar espacios múltiples
  result = result.replace(/\s+/g, ' ').trim();
  
  return result;
}

/**
 * Genera una clave única para un cliente basada en su nombre normalizado
 */
export function generateClientKey(name: string): string {
  const norm = normalizeClientName(name);
  // Eliminar todos los espacios para la clave
  return norm.replace(/\s/g, '_').substring(0, 50);
}

export function safeString(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value === undefined || value === null) return '';
  return String(value).trim();
}
