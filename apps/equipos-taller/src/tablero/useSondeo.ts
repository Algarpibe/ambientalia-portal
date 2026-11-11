// Sondeo del tablero: una cadena de setTimeout (no setInterval) con AbortController. Conserva la
// última foto buena; «obsoleto» cuenta desde el último acierto, no desde la edad de la foto.
import { useEffect, useRef, useState } from 'react';

export const CADA_MS = 60_000;
export const TIEMPO_MAX_MS = 20_000;
export const OBSOLETO_MS = 300_000;

export type Fallo = 'red' | 'acceso' | null;
export interface Sondeo<T> {
  datos: T | null;
  /** Instante (ms) del último acierto. */
  okEn: number | null;
  fallo: Fallo;
  /** Han pasado más de 5 minutos desde el último acierto. */
  obsoleto: boolean;
  /** Instante (ms) del último ciclo: los días y los temas se recalculan con él. */
  ahora: number;
}

interface Interno<T> { datos: T | null; okEn: number | null; fallo: Fallo; ahora: number }

export function useSondeo<T>(pedir: (senal: AbortSignal) => Promise<T>, opciones: { cadaMs?: number; tiempoMaxMs?: number; obsoletoMs?: number } = {}): Sondeo<T> {
  const { cadaMs = CADA_MS, tiempoMaxMs = TIEMPO_MAX_MS, obsoletoMs = OBSOLETO_MS } = opciones;
  const [s, setS] = useState<Interno<T>>(() => ({ datos: null, okEn: null, fallo: null, ahora: Date.now() }));
  const pedirRef = useRef(pedir);
  pedirRef.current = pedir;

  useEffect(() => {
    let vivo = true;
    let siguiente: ReturnType<typeof setTimeout> | undefined;
    let corte: ReturnType<typeof setTimeout> | undefined;
    let control: AbortController | undefined;

    const ciclo = async () => {
      const c = (control = new AbortController());
      corte = setTimeout(() => c.abort(), tiempoMaxMs);
      try {
        const datos = await pedirRef.current(c.signal);
        if (vivo) setS({ datos, okEn: Date.now(), fallo: null, ahora: Date.now() });
      } catch (e) {
        if (vivo) setS((p) => ({ ...p, fallo: (e as { status?: number }).status === 401 ? 'acceso' : 'red', ahora: Date.now() }));
      }
      clearTimeout(corte);
      if (vivo) siguiente = setTimeout(() => void ciclo(), cadaMs);
    };
    void ciclo();

    return () => {
      vivo = false;
      clearTimeout(siguiente);
      clearTimeout(corte);
      control?.abort();
    };
  }, [cadaMs, tiempoMaxMs]);

  return { ...s, obsoleto: s.okEn !== null && s.ahora - s.okEn > obsoletoMs };
}
