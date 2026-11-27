import type { Vista } from './tipos';

/**
 * ¿Guardar `cualidades` para `votadoId` completa los brindis que faltaban para responder? Repite la cuenta de
 * hub-api: compañeros distintos con al menos una cualidad. Solo suma uno si aún no se había brindado por él.
 * Precondición: `votadoId` es un compañero invitado distinto de quien vota; el muro solo ofrece esos, y así los
 * cuenta hub-api en `brindis.dados`.
 */
export function completaLosBrindis(
  vista: Pick<Vista, 'brindis' | 'misVotos'>,
  votadoId: string,
  cualidades: readonly string[],
): boolean {
  const { dados, minimo } = vista.brindis;
  const esNuevo = (vista.misVotos[votadoId]?.length ?? 0) === 0;
  return cualidades.length > 0 && esNuevo && dados < minimo && dados + 1 >= minimo;
}
