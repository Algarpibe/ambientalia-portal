import { describe, expect, it } from 'vitest';
import { ajusteValido, avisoFoto, CAUSA_SYNC_ATRASADA, claveValida, type Corrida } from './contrato.js';

const corrida = (c: Partial<Corrida>): Corrida => ({ id: 1, origen: 'programada', inicio: '2026-11-10T11:30:00.000Z', fin: '2026-11-10T11:35:00.000Z', enCurso: false, ok: true, causa: null, avisos: [], conteos: null, ...c });
const fecha = (iso: string) => 'F(' + iso.slice(0, 10) + ')';

describe('claves y tipos de ajuste', () => {
  it('acepta las tres formas de clave y rechaza el resto', () => {
    expect(['1BA90417|2026-11-01', '*1BA90417', 'pdf:Abcdefghij_-12'].every(claveValida)).toBe(true);
    expect(["x' OR 1=1", '1ba90417|2026-11-01', 'pdf:corto', '*AB'].some(claveValida)).toBe(false);
  });
  it('rechaza fechas imposibles y acepta el 29 de febrero bisiesto', () => {
    expect(['1BA90417|2026-13-45', '1BA90417|2026-02-30', '1BA90417|2026-00-10', '1BA90417|2026-04-31'].some(claveValida)).toBe(false);
    expect(claveValida('1BA90417|2028-02-29')).toBe(true);
    expect(claveValida('1BA90417|2026-02-29')).toBe(false);
  });
  it('«pdf» solo con una clave «pdf:», y al revés', () => {
    expect(ajusteValido('pdf:Abcdefghij_-12', 'pdf')).toBe(true);
    expect(ajusteValido('pdf:Abcdefghij_-12', 'out')).toBe(false);
    expect(ajusteValido('1BA90417|2026-11-01', 'pdf')).toBe(false);
    expect(ajusteValido('1BA90417|2026-11-01', 'in')).toBe(true);
    expect(ajusteValido('1BA90417|2026-11-01', 'borrar')).toBe(false);
  });
});

describe('avisoFoto (§5.3)', () => {
  const base = { configurado: true, ultima: corrida({}), ultimaBuena: corrida({}), incidente: null };
  it('sin nada que avisar, null', () => expect(avisoFoto(base, fecha)).toBeNull());
  it('módulo sin configurar: falta la primera sincronización con n8n', () =>
    expect(avisoFoto({ ...base, configurado: false }, fecha)).toEqual({ texto: 'Falta la primera sincronización con n8n', destacado: false }));
  it('falló Desk 2.0: lo dice con la fecha de la foto buena', () =>
    expect(avisoFoto({ ...base, ultima: corrida({ id: 2, ok: false, causa: 'desk2: sin conexión' }), ultimaBuena: corrida({ fin: '2026-11-08T11:35:00.000Z' }) }, fecha))
      .toEqual({ texto: 'No se pudo leer Desk 2.0; datos del F(2026-11-08)', destacado: false }));
  it('falló Drive', () => expect(avisoFoto({ ...base, ultima: corrida({ ok: false, causa: 'drive: HTTP 403' }) }, fecha)?.texto).toMatch(/^No se pudo leer Google Drive; datos del /));
  it('la copia de n8n atrasada lo dice así, no como un fallo de Drive', () =>
    expect(avisoFoto({ ...base, ultima: corrida({ ok: false, causa: CAUSA_SYNC_ATRASADA }), ultimaBuena: corrida({ fin: '2026-11-08T11:35:00.000Z' }) }, fecha)?.texto)
      .toBe('La copia de Google Drive (n8n) está atrasada; datos del F(2026-11-08)'));
  it('la causa de la copia atrasada es la que escribe el servicio', () => expect(CAUSA_SYNC_ATRASADA).toBe('drive: sincronización de n8n atrasada'));
  it('sin foto buena todavía', () => expect(avisoFoto({ ...base, ultima: corrida({ ok: false, causa: 'drive: HTTP 403' }), ultimaBuena: null }, fecha)?.texto).toBe('No se pudo leer Google Drive; todavía no hay datos'));
  it('con 2 o más corridas programadas fallidas, destacado', () =>
    expect(avisoFoto({ ...base, ultima: corrida({ ok: false, causa: 'desk2: tiempo agotado' }), incidente: { id: 1, abiertoEn: '', fallosProgramados: 2, alertaEnviadaEn: null, alertaUltimoError: null } }, fecha)?.destacado).toBe(true));
});
