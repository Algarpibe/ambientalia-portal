/**
 * La línea «Pasada nocturna: …» de las tarjetas «Maestro de equipos · Desk 2.0»
 * y «Calibraciones · Desk 2.0» (lote 10): cómo acabó la última pasada que salió
 * sola a las 02:00 de Colombia. Puro, sin reloj ni red. Lo que decide si una
 * pasada se aplica o se retiene es del servidor (`pasadas-nocturnas.ts`).
 */
import type { PasadaNocturna } from '../dominio';
import { fmtFecha, fmtFechaHora } from './vistas';

export interface LineaNocturna { texto: string; tono: 'gris' | 'ambar' | 'rojo'; motivos: string[] }

const QUE_PASO: Record<Exclude<PasadaNocturna['resultado'], 'en_curso'>, string> = {
  aplicada: 'aplicada',
  sin_cambios: 'sin cambios',
  no_disponible: 'Desk 2.0 no contestó (no se aplicó nada)',
  error: 'error (no se aplicó nada; el detalle está en el registro del servidor)',
  retenida: 'retenida: revisar',
};

/** El texto, su tono y, sólo si se retuvo, por qué. */
export function lineaNocturna(n: PasadaNocturna | null): LineaNocturna {
  if (!n) return { texto: 'Pasada nocturna: todavía ninguna (sale sola cada noche a las 02:00, hora de Colombia)', tono: 'gris', motivos: [] };
  if (n.resultado === 'en_curso') return { texto: `Pasada nocturna: en curso (empezó el ${fmtFechaHora(n.empezo)})`, tono: 'gris', motivos: [] };
  const tono = n.resultado === 'retenida' ? 'ambar' : n.resultado === 'error' ? 'rojo' : 'gris';
  return { texto: `Pasada nocturna del ${fmtFecha(n.fecha)}: ${QUE_PASO[n.resultado]}`, tono, motivos: n.resultado === 'retenida' ? n.motivos : [] };
}
