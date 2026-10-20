// Caché TTL en memoria (DATA-002). Los endpoints re-agregan tablas completas en
// cada request; el dato subyacente solo cambia cada ~3 min (sync del worker),
// así que una caché corta reduce muchísimo la carga de DB y la latencia.
// Un solo proceso → Map en memoria es suficiente (sin Redis).

type Entry = { data: unknown; expires: number };

const store = new Map<string, Entry>();
const TTL_MS = Number(process.env.CACHE_TTL_MS) || 120_000; // 2 min por defecto

/**
 * Tope de entradas (DATA-333). Hoy las claves fijas son una decena; las
 * variables, una por año de Contabilidad y una por rango de conciliación. El
 * tope no está para el uso normal sino para que ninguna clave —venga de donde
 * venga— pueda hacer crecer la memoria sin límite.
 */
export const CACHE_MAX_ENTRADAS = 100;

/**
 * Devuelve el valor cacheado si sigue fresco; si no, ejecuta `fn`, cachea y
 * devuelve. Los errores NO se cachean (si `fn` lanza, se propaga sin guardar).
 */
export async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expires > now) {
    // Al final del Map: el orden de inserción hace de orden de uso, y la
    // primera clave es siempre la usada hace más tiempo (LRU).
    store.delete(key);
    store.set(key, hit);
    return hit.data as T;
  }
  const data = await fn();
  store.delete(key);
  store.set(key, { data, expires: now + TTL_MS });
  // DATA-333 — antes no se soltaba nada: una entrada caducada solo se pisaba si
  // se repetía su clave. No hace falta barrer las caducadas aparte: una entrada
  // solo pasa al final si se lee fresca, así que las caducadas quedan siempre
  // delante y son las primeras en salir.
  while (store.size > CACHE_MAX_ENTRADAS) {
    store.delete(store.keys().next().value as string);
  }
  return data;
}

/** Vacía la caché (p. ej. para tests o un hook de invalidación futuro). */
export function clearCache(): void {
  store.clear();
}

/**
 * Invalida una sola clave, sin tocar el resto de la caché. Se usa tras una
 * escritura para refrescar solo el dato afectado (no evictar el de otras apps).
 */
export function clearCacheKey(key: string): void {
  store.delete(key);
}
