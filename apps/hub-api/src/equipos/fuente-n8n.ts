/**
 * Las fuentes de Drive de la corrida, leídas de la copia que manda n8n
 * (`portal.equipos_drive_archivos`, migración 072) y NO de Google: la empresa no deja
 * compartir Drive con cuentas de servicio (revisión del 10/11/2026 del diseño). Tiene la
 * forma que el núcleo leía de Drive (`Fuentes`), así que el núcleo no cambia:
 *   · los listados son las filas vivas de cada carpeta, tal como las dejó la pasada
 *     COMPLETA con la que corre. Los tres, y los textos de los PDF, salen de UNA lectura de
 *     la copia en una instantánea (repo-sync.ts `leerCopia`), hecha la primera vez que el
 *     núcleo pide algo de ella: una pasada que aplica listados mientras la corrida lee no
 *     puede dejar un archivo en dos carpetas, ni en ninguna;
 *   · el texto de una salida escaneada (OCR) o de una remisión de entrada (Markdown) es
 *     el guardado. Si no hay texto, porque n8n guardó un fallo de ese archivo o porque
 *     todavía no llegó, lanza `FalloArchivo`: servicio.ts lo trata como el fallo de un
 *     archivo concreto (A9), no de la fuente. Las remisiones de entrada se leen una a una
 *     (`leerTexto`) porque solo se piden las que no están en la caché `ent`.
 * Cualquier otro error (la base) sube tal cual y hace fallar la corrida.
 */
import type { Fuentes } from './nucleo/tipos.js';
import type { CopiaCorrida, RepoSync, TextoGuardado } from './repo-sync.js';
import { ID_DRIVE } from './sync.js';

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

export function fuenteN8n(repo: Pick<RepoSync, 'leerCopia' | 'leerTexto'>, pasada: string): FuenteDrive {
  // Una sola lectura por corrida (la fuente es nueva en cada una, index.ts). Si falla, falla
  // todo lo que sale de ella con el mismo error.
  let copia: Promise<CopiaCorrida> | null = null;
  const leer = () => (copia ??= repo.leerCopia(pasada));
  const texto = async (id: string, guardado: (id: string) => Promise<TextoGuardado | null | undefined>): Promise<string> => {
    // Defensa en profundidad: el id viene del listado, pero va a una consulta.
    if (!ID_DRIVE.test(id)) throw new Error('id de Drive no válido');
    const t = await guardado(id);
    // Si hay texto, vale aunque luego se guardara un fallo (un reintento tras un cambio de nombre).
    if (t && t.texto !== null) return t.texto;
    throw new FalloArchivo(t?.errorStatus ?? null);
  };
  return {
    entradas: async () => (await leer()).listados.entradas,
    salidasGeneradas: async () => (await leer()).listados.salidas_n8n,
    salidasEscaneadas: async () => (await leer()).listados.salidas_escaneadas,
    textoPdf: (id) => texto(id, async (x) => (await leer()).textosPdf.get(x)),
    remisionEntrada: (id) => texto(id, (x) => repo.leerTexto('entradas', x)),
  };
}
