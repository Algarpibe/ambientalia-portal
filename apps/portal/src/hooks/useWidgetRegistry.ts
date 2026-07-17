import { useEffect, useState } from 'react';
import { useAuth } from './useAuth';
import { WIDGET_FACTORIES } from '../widgets/registry';
import { isValidWidgetDescriptor, type WidgetDescriptor } from '../widgets/types';

// Carga y agrega los widgets exportados por las apps ASIGNADAS al usuario
// (claim `apps` del JWT). Aísla fallos: un módulo que no carga o un descriptor
// inválido se omite sin tumbar el resto. Ver design.md, Propiedades 1–3.

const LOAD_TIMEOUT_MS = 10_000;

export type RegistryState =
  | { status: 'loading' }
  | { status: 'ready'; widgets: WidgetDescriptor[] }
  | { status: 'error'; message: string };

/** Rechaza tras `ms`; se usa en Promise.race contra la carga de módulos. */
function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('registry-timeout')), ms));
}

/** Agrega descriptores válidos de los módulos cargados, deduplicando por id. */
export function aggregateDescriptors(
  modules: Array<{ appId: string; descriptors: unknown }>,
): WidgetDescriptor[] {
  const out: WidgetDescriptor[] = [];
  const seen = new Set<string>();
  for (const { appId, descriptors } of modules) {
    if (!Array.isArray(descriptors)) {
      console.error(`[widgets] La app "${appId}" no exportó un array de widgets; se omite.`);
      continue;
    }
    for (const raw of descriptors) {
      if (!isValidWidgetDescriptor(raw)) {
        const id = (raw as { id?: unknown })?.id;
        console.error(`[widgets] Descriptor inválido en "${appId}" (id=${String(id)}); se omite.`);
        continue;
      }
      // El appId efectivo es el del registro, no el declarado, para no confiar
      // en que la app se auto-etiquete correctamente.
      const descriptor: WidgetDescriptor = { ...raw, appId };
      if (seen.has(descriptor.id)) {
        console.warn(`[widgets] id de widget duplicado "${descriptor.id}" en "${appId}"; se descarta.`);
        continue;
      }
      seen.add(descriptor.id);
      out.push(descriptor);
    }
  }
  return out;
}

/**
 * Carga los módulos de widgets de las apps permitidas. Devuelve los descriptores
 * agregados. Lanza si se supera el timeout global.
 */
async function loadWidgets(allowedApps: string[]): Promise<WidgetDescriptor[]> {
  const entries = allowedApps
    .filter((appId) => appId in WIDGET_FACTORIES)
    .map((appId) => ({ appId, factory: WIDGET_FACTORIES[appId] }));

  if (entries.length === 0) return [];

  const load = Promise.allSettled(entries.map((e) => e.factory())).then((results) =>
    results.map((res, i) => ({
      appId: entries[i].appId,
      descriptors:
        res.status === 'fulfilled'
          ? (res.value as { default?: unknown })?.default
          : (console.error(`[widgets] Falló la carga de widgets de "${entries[i].appId}":`, res.reason), undefined),
    })),
  );

  const modules = await Promise.race([load, timeout(LOAD_TIMEOUT_MS)]);
  return aggregateDescriptors(modules);
}

/**
 * Hook: expone los widgets disponibles para el usuario actual. Se recalcula
 * cuando cambia el conjunto de apps asignadas.
 */
export function useWidgetRegistry(): RegistryState {
  const { apps } = useAuth();
  // Clave estable para el efecto: el orden no debe provocar recargas espurias.
  const appsKey = [...apps].sort().join(',');
  const [state, setState] = useState<RegistryState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });

    if (apps.length === 0) {
      setState({ status: 'ready', widgets: [] });
      return;
    }

    loadWidgets(apps)
      .then((widgets) => {
        if (!cancelled) setState({ status: 'ready', widgets });
      })
      .catch(() => {
        if (!cancelled) {
          setState({ status: 'error', message: 'No fue posible cargar los widgets. Intenta recargar la página.' });
        }
      });

    return () => {
      cancelled = true;
    };
    // appsKey resume el contenido de `apps`; evita recargar por cambios de referencia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appsKey]);

  return state;
}
