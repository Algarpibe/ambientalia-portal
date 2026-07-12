/**
 * Motor de Matching de Clientes
 * Normalización + Matching exacto + Fuzzy matching + Tabla manual
 */

import { CustomerMapRecord, MatchType, MatchingResult } from '../types';
import { normalizeClientName } from '../utils/normalize';

// =========================================================================
// FUZZY MATCHING (Levenshtein Distance)
// =========================================================================

/**
 * Calcula la distancia de Levenshtein entre dos strings
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // sustitución
          matrix[i][j - 1] + 1,     // inserción
          matrix[i - 1][j] + 1      // eliminación
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calcula similitud entre 0 y 1 basada en Levenshtein
 */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const distance = levenshteinDistance(a, b);
  return 1 - distance / maxLen;
}

/**
 * Similitud con bonus para prefijos comunes
 */
function enhancedSimilarity(a: string, b: string): number {
  const baseSim = similarity(a, b);
  
  // Bonus si comparten prefijo largo
  let prefixLen = 0;
  const minLen = Math.min(a.length, b.length);
  for (let i = 0; i < minLen; i++) {
    if (a[i] === b[i]) prefixLen++;
    else break;
  }
  const prefixBonus = (prefixLen / Math.max(a.length, b.length)) * 0.1;
  
  // Bonus si una contiene a la otra
  const containsBonus = (a.includes(b) || b.includes(a)) ? 0.1 : 0;
  
  return Math.min(1, baseSim + prefixBonus + containsBonus);
}

// =========================================================================
// MATCHING ENGINE
// =========================================================================

export interface MatchCandidate {
  customerId: string;
  customerName: string;
  customerNameNorm: string;
}

export interface MatchOptions {
  fuzzyThreshold: number;      // Umbral mínimo para fuzzy match (default 0.90)
  manualMappings?: Map<string, string>; // Mapeos manuales: rawName -> customerId
}

const DEFAULT_OPTIONS: MatchOptions = {
  fuzzyThreshold: 0.90
};

/**
 * Encuentra el mejor match para un nombre de cliente
 */
export function findBestMatch(
  rawName: string,
  candidates: MatchCandidate[],
  options: MatchOptions = DEFAULT_OPTIONS
): CustomerMapRecord {
  const normName = normalizeClientName(rawName);
  const now = new Date();

  // 1. Verificar mapeo manual primero
  if (options.manualMappings?.has(rawName)) {
    const customerId = options.manualMappings.get(rawName)!;
    const matched = candidates.find(c => c.customerId === customerId);
    return {
      customerNameRaw: rawName,
      customerNameNorm: normName,
      customerId,
      matchType: 'manual',
      matchScore: 1,
      matchedTo: matched?.customerName,
      updatedAt: now,
      verified: true
    };
  }

  // 2. Match exacto por nombre normalizado
  const exactMatch = candidates.find(c => c.customerNameNorm === normName);
  if (exactMatch) {
    return {
      customerNameRaw: rawName,
      customerNameNorm: normName,
      customerId: exactMatch.customerId,
      matchType: 'exact',
      matchScore: 1,
      matchedTo: exactMatch.customerName,
      updatedAt: now,
      verified: false
    };
  }

  // 3. Fuzzy matching
  let bestScore = 0;
  let bestCandidate: MatchCandidate | null = null;

  for (const candidate of candidates) {
    const score = enhancedSimilarity(normName, candidate.customerNameNorm);
    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }

  if (bestScore >= options.fuzzyThreshold && bestCandidate) {
    return {
      customerNameRaw: rawName,
      customerNameNorm: normName,
      customerId: bestCandidate.customerId,
      matchType: 'fuzzy',
      matchScore: bestScore,
      matchedTo: bestCandidate.customerName,
      updatedAt: now,
      verified: false
    };
  }

  // 4. Sin match
  return {
    customerNameRaw: rawName,
    customerNameNorm: normName,
    customerId: null,
    matchType: 'unmatched',
    matchScore: bestScore,
    matchedTo: bestCandidate?.customerName,
    updatedAt: now,
    verified: false
  };
}

/**
 * Procesa una lista de nombres y los matchea contra candidatos
 */
export function matchAllCustomers(
  rawNames: string[],
  candidates: MatchCandidate[],
  options: MatchOptions = DEFAULT_OPTIONS
): { records: CustomerMapRecord[]; summary: MatchingResult } {
  const records: CustomerMapRecord[] = [];
  const unmatchedNames: string[] = [];

  let exactMatches = 0;
  let fuzzyMatches = 0;
  let manualMatches = 0;
  let unmatched = 0;

  for (const rawName of rawNames) {
    const match = findBestMatch(rawName, candidates, options);
    records.push(match);

    switch (match.matchType) {
      case 'exact': exactMatches++; break;
      case 'fuzzy': fuzzyMatches++; break;
      case 'manual': manualMatches++; break;
      case 'unmatched':
        unmatched++;
        unmatchedNames.push(rawName);
        break;
    }
  }

  const totalRecords = rawNames.length;
  const matchRate = totalRecords > 0 
    ? (exactMatches + fuzzyMatches + manualMatches) / totalRecords 
    : 0;

  return {
    records,
    summary: {
      totalRecords,
      exactMatches,
      fuzzyMatches,
      manualMatches,
      unmatched,
      matchRate,
      unmatchedNames
    }
  };
}

/**
 * Construye candidatos desde datos de pagos/ventas existentes
 */
export function buildCandidatesFromKeys(
  clientKeys: string[],
  keyToName: Map<string, string>
): MatchCandidate[] {
  return clientKeys.map(key => ({
    customerId: key,
    customerName: keyToName.get(key) || key,
    customerNameNorm: normalizeClientName(keyToName.get(key) || key)
  }));
}

/**
 * Guarda/carga mapeos manuales (para persistencia)
 */
export function serializeManualMappings(mappings: Map<string, string>): string {
  return JSON.stringify(Array.from(mappings.entries()));
}

export function deserializeManualMappings(json: string): Map<string, string> {
  try {
    const entries: [string, string][] = JSON.parse(json);
    return new Map(entries);
  } catch {
    return new Map();
  }
}
