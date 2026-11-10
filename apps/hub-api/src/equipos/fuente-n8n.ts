/**
 * Las fuentes de Drive de la corrida, leídas de la copia que manda n8n
 * (`portal.equipos_drive_archivos`, migración 072) y NO de Google: la empresa no deja
 * compartir Drive con cuentas de servicio (revisión del 10/11/2026 del diseño). Tiene la
 * forma que el núcleo leía de Drive (`Fuentes`), así que el núcleo no cambia:
 *   · los listados son las filas vivas de cada carpeta, tal como las dejó la pasada
 *     COMPLETA con la que corre (repo-sync.ts `listarCarpeta`);
 *   · el texto de una salida escaneada (OCR) o de una remisión de entrada (Markdown) es
 *     el guardado. Si no hay texto, porque n8n guardó un fallo de ese archivo o porque
 *     todavía no llegó, lanza `FalloArchivo`: servicio.ts lo trata como el fallo de un
 *     archivo concreto (A9), no de la fuente.
 * Cualquier otro error (la base) sube tal cual y hace fallar la corrida.
 */
import type { Fuentes } from './nucleo/tipos.js';
import type { RepoSync } from './repo-sync.js';
import { ID_DRIVE, type Carpeta } from './sync.js';

/** Lo que el núcleo lee de Drive. */
export type FuenteDrive = Pick<Fuentes, 'entradas' | 'salidasGeneradas' | 'salidasEscaneadas' | 'textoPdf'> & {
  remisionEntrada(carpetaId: string): Promise<string>;
};

/**
 * El fallo de UN archivo: el código que guardó n8n, o null si su texto todavía no llegó.
 * El mensaje con código es el de antes («Drive HTTP 403»): es el que el núcleo pone en sus avisos.
 */
export class FalloArchivo extends Error {
  readonly status: number | null;
  constructor(status: number | null) {
    super(status === null ? 'n8n todavía no envió su texto' : 'Drive HTTP ' + status);
    this.name = 'FalloArchivo';
    this.status = status;
  }
}

export function fuenteN8n(repo: Pick<RepoSync, 'listarCarpeta' | 'leerTexto'>, pasada: string): FuenteDrive {
  const texto = async (carpeta: Carpeta, id: string): Promise<string> => {
    // Defensa en profundidad: el id viene del listado, pero va a una consulta.
    if (!ID_DRIVE.test(id)) throw new Error('id de Drive no válido');
    const t = await repo.leerTexto(carpeta, id);
    // Si hay texto, vale aunque luego se guardara un fallo (un reintento tras un cambio de nombre).
    if (t && t.texto !== null) return t.texto;
    throw new FalloArchivo(t?.errorStatus ?? null);
  };
  return {
    entradas: () => repo.listarCarpeta('entradas', pasada),
    salidasGeneradas: () => repo.listarCarpeta('salidas_n8n', pasada),
    salidasEscaneadas: () => repo.listarCarpeta('salidas_escaneadas', pasada),
    textoPdf: (id) => texto('salidas_escaneadas', id),
    remisionEntrada: (id) => texto('entradas', id),
  };
}
