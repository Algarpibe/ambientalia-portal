import { describe, expect, it } from 'vitest';
import { decidirIncidente, FALLOS_PARA_AVISAR } from './incidente.js';

// Cuándo se abre, cuenta, avisa y cierra un incidente (§5.2). Puro: sin base ni red.
const abierto = (fallosProgramados: number, alertaEnviadaEn: string | null = null) => ({ fallosProgramados, alertaEnviadaEn });

describe('decidirIncidente', () => {
  it('avisa al llegar a 2 corridas programadas fallidas', () => expect(FALLOS_PARA_AVISAR).toBe(2));

  it('una corrida buena sin incidente no hace nada', () =>
    expect(decidirIncidente({ origen: 'programada', ok: true }, null)).toEqual({ accion: 'nada', fallosProgramados: 0, enviarAlerta: false }));

  it('1 fallo programado abre el incidente y no avisa', () =>
    expect(decidirIncidente({ origen: 'programada', ok: false }, null)).toEqual({ accion: 'abrir', fallosProgramados: 1, enviarAlerta: false }));

  it('el 2.º fallo programado seguido avisa', () =>
    expect(decidirIncidente({ origen: 'programada', ok: false }, abierto(1))).toEqual({ accion: 'contar', fallosProgramados: 2, enviarAlerta: true }));

  // «sincronizacion»: la que lanza cada «fin» de n8n (cada hora). «boton»: el botón ya retirado (quedan filas viejas).
  describe.each(['sincronizacion', 'boton'] as const)('corridas «%s»', (origen) => {
    it('no cuentan ni avisan, pero sí abren', () => {
      expect(decidirIncidente({ origen, ok: false }, null)).toEqual({ accion: 'abrir', fallosProgramados: 0, enviarAlerta: false });
      expect(decidirIncidente({ origen, ok: false }, abierto(1))).toEqual({ accion: 'contar', fallosProgramados: 1, enviarAlerta: false });
    });

    it('con el incidente en 2 fallos y sin alerta enviada, no avisan', () =>
      expect(decidirIncidente({ origen, ok: false }, abierto(2, null))).toEqual({ accion: 'contar', fallosProgramados: 2, enviarAlerta: false }));

    it('una buena cierra el incidente', () =>
      expect(decidirIncidente({ origen, ok: true }, abierto(3, '2026-11-10T11:30:00.000Z')).accion).toBe('cerrar'));
  });

  it('se avisa una sola vez por incidente', () =>
    expect(decidirIncidente({ origen: 'programada', ok: false }, abierto(2, '2026-11-10T11:30:00.000Z'))).toEqual({ accion: 'contar', fallosProgramados: 3, enviarAlerta: false }));

  it('si el webhook falló (sin alerta_enviada_en), la siguiente programada fallida lo reintenta', () =>
    expect(decidirIncidente({ origen: 'programada', ok: false }, abierto(2))).toEqual({ accion: 'contar', fallosProgramados: 3, enviarAlerta: true }));

  it('una corrida programada buena cierra el incidente', () =>
    expect(decidirIncidente({ origen: 'programada', ok: true }, abierto(1)).accion).toBe('cerrar'));

  it('tras cerrarse, un fallo nuevo abre otro incidente desde cero y puede volver a avisar', () => {
    expect(decidirIncidente({ origen: 'programada', ok: false }, null)).toEqual({ accion: 'abrir', fallosProgramados: 1, enviarAlerta: false });
    expect(decidirIncidente({ origen: 'programada', ok: false }, abierto(1)).enviarAlerta).toBe(true);
  });
});
