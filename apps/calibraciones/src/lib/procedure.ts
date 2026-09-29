/**
 * Which internal procedure governs a verification (DECISIONS D-037):
 *   IN.5.5.3-YY — a 6103 Level 2 transfers traceability to another 6103 (Level 3);
 *   IN.5.5.3-XX — every other transfer (SRP → 6103, 6103 → Sabio 2010D, ...).
 * A 6103 is recognised by "6103" in its model or internal code.
 */
export interface ProcedureInfo {
  code: 'IN.5.5.3-XX' | 'IN.5.5.3-YY';
  title: string;
}

interface EquipmentLike {
  model: string;
  internalCode: string;
  type: string;
}

const is6103 = (e: EquipmentLike) => /6103/i.test(`${e.model} ${e.internalCode}`);

export function procedureFor(reference: EquipmentLike | null, candidate: EquipmentLike | null): ProcedureInfo {
  if (reference && candidate && reference.type !== 'SRP' && is6103(reference) && is6103(candidate)) {
    return { code: 'IN.5.5.3-YY', title: 'Transferencia de trazabilidad de O3: 6103 Nivel 2 a 6103 Nivel 3' };
  }
  return { code: 'IN.5.5.3-XX', title: 'Transferencia de trazabilidad de O3: 6103 y Sabio 2010D' };
}
