import { ColumnMapping } from '../types';
import { safeString } from '../utils/normalize';

function normalizeForMatching(text: string): string {
  return safeString(text)
    .toLowerCase()
    .replace(/[º°ª#\-_\.\(\)]/g, '')  // Also remove parentheses
    .replace(/\s+/g, ' ')
    .trim();
}

export function inferColumns(headers: string[], mapping: ColumnMapping): Record<string, string> {
  const normalizedHeaders = headers.map((h) => ({ original: h, normalized: normalizeForMatching(h) }));
  const resolved: Record<string, string> = {};

  const findMatch = (candidates: string[]) => {
    const normalized = candidates.map((c) => normalizeForMatching(c));
    
    // First try: exact substring match (either direction)
    let match = normalizedHeaders.find((h) => 
      normalized.some((n) => h.normalized.includes(n) || n.includes(h.normalized))
    );
    
    // Second try: word-based matching
    if (!match) {
      match = normalizedHeaders.find((h) => {
        const headerWords = h.normalized.split(/\s+/);
        return normalized.some((n) => {
          const syncWords = n.split(/\s+/);
          // Check if any key synonym word appears in header
          return syncWords.some((sw) => headerWords.includes(sw));
        });
      });
    }
    
    return match?.original;
  };

  for (const [key, synonyms] of Object.entries(mapping.required)) {
    const match = findMatch(synonyms);
    if (!match) {
      throw new Error(`Falta la columna requerida: ${key}. Headers encontrados: ${headers.join(', ')}`);
    }
    resolved[key] = match;
  }

  if (mapping.optional) {
    for (const [key, synonyms] of Object.entries(mapping.optional)) {
      const match = findMatch(synonyms);
      if (match) resolved[key] = match;
    }
  }

  return resolved;
}
