/**
 * Incidentes de «Equipos en taller» (§5.2 del diseño): decisión PURA, sin base ni
 * red. Recibe cómo terminó la corrida y el incidente abierto (si lo hay) y dice qué
 * hacer; repo.ts lo escribe y servicio.ts envía la alerta.
 *
 *   · Abrir: la primera corrida fallida después de una buena.
 *   · Contar: solo las corridas PROGRAMADAS suman a `fallosProgramados`.
 *   · Avisar: al llegar a 2 sin alerta enviada. Si el envío falla, la siguiente
 *     programada fallida del mismo incidente lo vuelve a intentar.
 *   · Cerrar: una corrida buena. Si después vuelve a fallar, es un incidente nuevo.
 */
import type { Incidente, OrigenCorrida } from './contrato.js';

/** Corridas programadas fallidas seguidas que disparan la alerta (D6). */
export const FALLOS_PARA_AVISAR = 2;

export interface DecisionIncidente {
  accion: 'nada' | 'abrir' | 'contar' | 'cerrar';
  /** Lo que queda en `fallos_programados` (al abrir o contar). */
  fallosProgramados: number;
  enviarAlerta: boolean;
}

export function decidirIncidente(
  corrida: { origen: OrigenCorrida; ok: boolean },
  abierto: Pick<Incidente, 'fallosProgramados' | 'alertaEnviadaEn'> | null,
): DecisionIncidente {
  if (corrida.ok) {
    return abierto
      ? { accion: 'cerrar', fallosProgramados: abierto.fallosProgramados, enviarAlerta: false }
      : { accion: 'nada', fallosProgramados: 0, enviarAlerta: false };
  }
  const programada = corrida.origen === 'programada';
  const fallos = (abierto?.fallosProgramados ?? 0) + (programada ? 1 : 0);
  return {
    accion: abierto ? 'contar' : 'abrir',
    fallosProgramados: fallos,
    enviarAlerta: programada && fallos >= FALLOS_PARA_AVISAR && !abierto?.alertaEnviadaEn,
  };
}
