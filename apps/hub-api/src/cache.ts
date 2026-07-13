// Caché TTL en memoria (DATA-002). Los endpoints re-agregan tablas completas en
// cada request; el dato subyacente solo cambia cada ~3 min (sync del worker),
// así que una caché corta reduce muchísimo la carga de DB y la latencia.
// Un solo proceso → Map en memoria es suficiente (sin Redis).

type Entry = { data: unknown; expires: number };

const store = new Map<string, Entry>();
const TTL_MS = Number(process.env.CACHE_TTL_MS) || 120_000; // 2 min por defecto

/**
 * Devuelve el valor cacheado si sigue fresco; si no, ejecuta `fn`, cachea y
 * devuelve. Los errores NO se cachean (si `fn` lanza, se propaga sin guardar).
 */
export async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expires > now) return hit.data as T;
  const data = await fn();
  store.set(key, { data, expires: now + TTL_MS });
  return data;
}

/** Vacía la caché (p. ej. para tests o un hook de invalidación futuro). */
export function clearCache(): void {
  store.clear();
}
