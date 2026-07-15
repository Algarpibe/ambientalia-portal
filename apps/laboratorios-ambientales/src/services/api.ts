import type { Laboratorio } from '../types';
import { normalizeActividad, normalizeComponente, normalizeEstado, normalizeMatriz } from '../lib/normalize';

// Dataset «Laboratorios ambientales acreditados por el IDEAM» de datos.gov.co.
// Sirve CORS abierto (Access-Control-Allow-Origin: *): no hacen falta proxies.
const DATASET_ID = '2waz-acaa';
const BASE_URL = `https://www.datos.gov.co/resource/${DATASET_ID}.json`;

export const PAGE_SIZE = 5000;

const CACHE_KEY_DATA = 'labs_cache_data';
const CACHE_KEY_TIMESTAMP = 'labs_cache_timestamp';
const CACHE_DURATION = 24 * 60 * 60 * 1000;

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

function readCache(ignoreAge = false): Laboratorio[] | null {
  try {
    const data = localStorage.getItem(CACHE_KEY_DATA);
    const ts = localStorage.getItem(CACHE_KEY_TIMESTAMP);
    if (!data || !ts) return null;
    if (!ignoreAge && Date.now() - parseInt(ts, 10) >= CACHE_DURATION) return null;
    return JSON.parse(data) as Laboratorio[];
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

export async function fetchLaboratorios(onProgress?: (cargados: number) => void): Promise<Laboratorio[]> {
  const cached = readCache();
  if (cached) return cached;

  try {
    const all: Laboratorio[] = [];
    let offset = 0;

    for (;;) {
      // $order=:id es lo que hace estable la paginación en SODA: sin un orden
      // explícito el servidor puede repetir u omitir filas entre páginas.
      const url = `${BASE_URL}?$limit=${PAGE_SIZE}&$offset=${offset}&$order=:id`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Error de red al consultar datos.gov.co: ${response.status}`);

      const records = (await response.json()) as Record<string, string>[];
      all.push(...records.map(mapRecord));
      onProgress?.(all.length);

      if (records.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    writeCache(all);
    return all;
  } catch (error) {
    const stale = readCache(true);
    if (stale) return stale;
    throw error;
  }
}
