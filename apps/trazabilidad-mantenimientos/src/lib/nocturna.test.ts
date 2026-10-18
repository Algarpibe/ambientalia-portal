import { describe, it, expect } from 'vitest';
import type { PasadaNocturna } from '../dominio';
import { lineaNocturna } from './nocturna';

// La línea «Pasada nocturna: …» de las tarjetas del maestro y de las calibraciones (lote 10). Datos ficticios; las
// horas son instantes en UTC y se enseñan en hora de Colombia (UTC−5), sin depender de la zona de la máquina.
const pasada = (p: Partial<PasadaNocturna> = {}): PasadaNocturna => ({ fecha: '2026-10-19', resultado: 'aplicada', motivos: [], empezo: '2026-10-19 07:00:00+00', termino: '2026-10-19 07:00:04+00', ...p });

describe('la línea de la pasada nocturna', () => {
  it('sin ninguna todavía: cuándo sale', () => {
    expect(lineaNocturna(null)).toEqual({ texto: 'Pasada nocturna: todavía ninguna (sale sola cada noche a las 02:00, hora de Colombia)', tono: 'gris', motivos: [] });
  });

  it.each([
    ['aplicada', 'Pasada nocturna del 19/10/2026: aplicada', 'gris'],
    ['sin_cambios', 'Pasada nocturna del 19/10/2026: sin cambios', 'gris'],
    ['no_disponible', 'Pasada nocturna del 19/10/2026: Desk 2.0 no contestó (no se aplicó nada)', 'gris'],
    ['error', 'Pasada nocturna del 19/10/2026: error (no se aplicó nada; el detalle está en el registro del servidor)', 'rojo'],
  ] as const)('%s', (resultado, texto, tono) => {
    expect(lineaNocturna(pasada({ resultado }))).toEqual({ texto, tono, motivos: [] });
  });

  it('retenida: «retenida: revisar», en ámbar, con la lista de motivos', () => {
    const motivos = ['Equipos nuevos que se darían de alta (GRIMM EDM 180): 1', 'Cambios de serial (GRIMM EDM 180): 2'];
    expect(lineaNocturna(pasada({ resultado: 'retenida', motivos }))).toEqual({ texto: 'Pasada nocturna del 19/10/2026: retenida: revisar', tono: 'ambar', motivos });
  });

  it('en curso: desde cuándo, en hora de Colombia', () => {
    expect(lineaNocturna(pasada({ resultado: 'en_curso', termino: null }))).toEqual({ texto: 'Pasada nocturna: en curso (empezó el 19/10/2026 02:00)', tono: 'gris', motivos: [] });
  });

  it('los motivos sólo se enseñan cuando se retuvo (el resto los lleva para el registro)', () => {
    expect(lineaNocturna(pasada({ resultado: 'no_disponible', motivos: ['Desk 2.0 no contesta.'] })).motivos).toEqual([]);
  });
});
