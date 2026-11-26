import type { Laboratorio } from '../types';
import { normalizeActividad, normalizeComponente, normalizeEstado, normalizeMatriz } from '../lib/normalize';

// Dataset «Laboratorios ambientales acreditados por el IDEAM» de datos.gov.co.
// Sirve CORS abierto (Access-Control-Allow-Origin: *): no hacen falta proxies.
const DATASET_ID = '2waz-acaa';
const BASE_URL = `https://www.datos.gov.co/resource/${DATASET_ID}.json`;

export const PAGE_SIZE = 5000;

// Tope por página. Sin él, si datos.gov.co no contesta, fetch espera para
// siempre: el spinner no para y el botón de Reintentar no llega a salir.
export const REQUEST_TIMEOUT_MS = 60_000;

// La clave va versionada. readCache solo comprueba que lo guardado sea un array;
// la forma de cada registro no la valida nada en runtime: si el esquema de
// Laboratorio cambia y la clave no, los navegadores con cache previo leen datos
// viejos como si fueran nuevos y la app sale vacía hasta que expire. **Al cambiar
// la forma de Laboratorio hay que subir CACHE_VERSION y añadir las claves
// anteriores a LEGACY_CACHE_KEYS.**
const CACHE_VERSION = 'v2';
const CACHE_KEY_DATA = `labs_cache_${CACHE_VERSION}_data`;
const CACHE_KEY_TIMESTAMP = `labs_cache_${CACHE_VERSION}_timestamp`;
const CACHE_DURATION = 24 * 60 * 60 * 1000;

// Claves de versiones anteriores. Hay que borrarlas activamente, no solo dejar de
// leerlas: ocupaban ~3 MB de los ~5 MB que el portal comparte por origen, así que
// abandonarlas haría fallar por cuota la escritura del cache nuevo.
// v1 (hasta 2026-07-15): esquema con nombre_laboratorio/parametro/estado 'VIGENTE'.
const LEGACY_CACHE_KEYS = ['labs_cache_data', 'labs_cache_timestamp'];

export function mapRecord(record: Record<string, string | undefined>): Laboratorio {
  return {
    codigo: record.c_digo_de_laboratorio ?? '',
    estado: normalizeEstado(record.estado_de_la_acreditaci_n ?? ''),
    matriz: normalizeMatriz(record.matriz ?? ''),
    componente: normalizeComponente(record.componente ?? ''),
    actividad: normalizeActividad(record.actividad ?? ''),
    grupo: (record.grupo ?? '').trim(),
    // 'variable' NO se normaliza: es nomenclatura técnica y el title-case
    // rompería pH -> Ph, DQO -> Dqo, n-Decano -> N-Decano. Sus grafías
    // divergentes se resuelven al cotejar (filters.ts), no al mapear.
    variable: (record.variable ?? '').trim(),
    tecnica: record.t_cnica ?? '',
    // Como 'variable', 'metodo' no se normaliza (es texto libre con códigos de
    // norma), pero sí se recorta: optionsFor ofrece el valor trimeado y
    // applyFilters compara por igualdad exacta.
    metodo: (record.m_todo ?? '').trim(),
    rango: record.rango_de_trabajo ?? '',
    nombreLaboratorio: record.nombre_del_laboratorio ?? '',
    nit: record.nit ?? '',
    contacto: record.contacto ?? '',
    ciudad: record.ciudad ?? '',
    departamento: record.departamento ?? '',
    direccion: record.direcci_n ?? '',
    telefono: record.tel_fono ?? '',
    correo: record.correo ?? '',
    actoAdministrativo: record.actos_administrativos_que ?? '',
    desde: record.desde ?? '',
    hasta: record.hasta ?? '',
  };
}

// Se llama antes de leer el cache, y también cuando el cache nuevo está fresco:
// si solo se purgara al descargar, quien ya tenga cache v2 arrastraría los ~3 MB
// de la v1 para siempre.
function purgeLegacyCache(): void {
  try {
    for (const key of LEGACY_CACHE_KEYS) localStorage.removeItem(key);
  } catch {
    // localStorage no disponible; nada que purgar.
  }
}

// Fresco solo si la edad es un número finito dentro de [0, 24 h). Comparar solo
// `edad >= CACHE_DURATION` dejaba fresco para siempre un timestamp corrupto
// (NaN >= x es false) o uno en el futuro por un reloj mal puesto (edad negativa).
// Number y no parseInt: parseInt('123abc') da 123 y daría por bueno un valor roto.
function esFresco(ts: string): boolean {
  const edad = Date.now() - Number(ts);
  return Number.isFinite(edad) && edad >= 0 && edad < CACHE_DURATION;
}

// null es «no hay nada que enseñar». Un cache caducado no es null: sus datos
// valen como rancios mientras llega la descarga nueva.
function readCache(): { datos: Laboratorio[]; fresco: boolean } | null {
  try {
    const data = localStorage.getItem(CACHE_KEY_DATA);
    const ts = localStorage.getItem(CACHE_KEY_TIMESTAMP);
    if (!data || !ts) return null;
    // Lo único que se comprueba es que sea un array: App hace `data.map` y un
    // objeto lo reventaría. La forma de cada registro la protege CACHE_VERSION.
    const parsed: unknown = JSON.parse(data);
    if (!Array.isArray(parsed)) return null;
    return { datos: parsed as Laboratorio[], fresco: esFresco(ts) };
  } catch {
    return null;
  }
}

function writeCache(data: Laboratorio[]): void {
  try {
    localStorage.setItem(CACHE_KEY_DATA, JSON.stringify(data));
    localStorage.setItem(CACHE_KEY_TIMESTAMP, Date.now().toString());
  } catch {
    // El dataset ronda los 3 MB y el portal comparte los ~5 MB del origen: si no
    // cabe, dejamos el cache limpio en vez de una entrada a medias. Los datos ya
    // están en memoria, así que la sesión sigue funcionando.
    try {
      localStorage.removeItem(CACHE_KEY_DATA);
      localStorage.removeItem(CACHE_KEY_TIMESTAMP);
    } catch {
      // localStorage no disponible; nada que limpiar.
    }
  }
}

// Una página con su propio tope de tiempo. El temporizador se apaga en el
// finally, es decir, después de `await response.json()` y no al resolver fetch:
// las cabeceras pueden llegar y el cuerpo quedarse colgado, y abortar la señal
// también corta la lectura del cuerpo.
async function fetchPage(url: string): Promise<Record<string, string>[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Error de red al consultar datos.gov.co: ${response.status}`);
    return (await response.json()) as Record<string, string>[];
  } catch (error) {
    // Se mira la señal y no el tipo de error: según el navegador, el aborto
    // llega como AbortError o como el motivo de la señal, y ninguno de los dos
    // le dice nada al usuario.
    if (controller.signal.aborted) throw new Error(`datos.gov.co no respondió en ${REQUEST_TIMEOUT_MS / 1000} s`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// Descarga el dataset entero y deja el cache escrito.
async function download(onProgress?: (cargados: number) => void): Promise<Laboratorio[]> {
  const all: Laboratorio[] = [];
  let offset = 0;

  for (;;) {
    // $order=:id es lo que hace estable la paginación en SODA: sin un orden
    // explícito el servidor puede repetir u omitir filas entre páginas.
    const url = `${BASE_URL}?$limit=${PAGE_SIZE}&$offset=${offset}&$order=:id`;
    const records = await fetchPage(url);
    all.push(...records.map(mapRecord));
    onProgress?.(all.length);

    if (records.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  writeCache(all);
  return all;
}

// Tres casos según el cache:
// - fresco: se devuelve sin tocar la red;
// - caducado: se devuelve lo rancio al momento y se descarga en segundo plano;
//   al terminar, onRefresh recibe los datos nuevos;
// - sin cache: se descarga en primer plano con avance, y si falla, lanza.
export async function fetchLaboratorios(
  onProgress?: (cargados: number) => void,
  onRefresh?: (frescos: Laboratorio[]) => void,
): Promise<Laboratorio[]> {
  purgeLegacyCache();

  const cache = readCache();
  if (cache?.fresco) return cache.datos;

  if (cache) {
    // Sin onProgress: el usuario ya está viendo datos y el spinner no vuelve.
    // El fallo se calla, porque lo rancio sigue en pantalla y en el cache, y se
    // calla en el segundo argumento de then y no en un catch final: así solo se
    // silencia la descarga, y un error de onRefresh, que sería un bug, se ve.
    void download().then(
      (frescos) => onRefresh?.(frescos),
      () => {
        // Se sigue con lo rancio; la próxima carga lo vuelve a intentar.
      },
    );
    return cache.datos;
  }

  // Aquí no hay nada rancio que servir si la descarga falla: readCache ya dijo
  // que no hay cache, así que el error sube y App enseña Reintentar.
  return download(onProgress);
}
