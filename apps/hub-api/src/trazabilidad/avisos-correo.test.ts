import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ETIQUETA_TRAMO, correoAviso, fechaDia, marcaAviso, mensajeAviso, saludoAviso, todosGrimm } from './avisos-correo.js';
import { estadoCalibracion, planAvisos, type ContactoEquipo } from './dominio.js';

// El texto del aviso a clientes: el que sale de verdad al pulsar «Enviar correo»
// (lo redacta el servidor) y el que enseña la app. Aquí se fija letra a letra.
// Más casos, con la `EquipoVista` de la app, en
// apps/trazabilidad-mantenimientos/src/lib/simulacion.test.ts y vistas.test.ts.

const HOY = '2026-10-06';
const EN_30 = '2025-10-17'; // vence 2026-10-17 (quedan 11 d) → tramo 30

let n = 0;
/** Un equipo como lo da GET /equipos (lo que necesitan el plan y el texto): GRIMM de 365 días salvo que se diga otra marca. */
function eq(cliente: string, ultimaCalibracion: string, contacto: ContactoEquipo | null = null, marca = 'Grimm', modelo = 'EDM 180C') {
  const serial = `18A${String(++n).padStart(5, '0')}`;
  const { vence, vigenciaDias } = estadoCalibracion(ultimaCalibracion, HOY, 365);
  return { clave: serial, serial, cliente, marca, modelo, ultimaCalibracion, vigenciaMarca: 365, vence, vigenciaDias, seguimiento: null, ticket: null, contacto };
}
const desk = (email: string, nombre = ''): ContactoEquipo => ({ nombre, email, origen: 'desk', ticket: 950 });
/** La tarjeta (con o sin destinatario) de esos equipos. */
const tarjeta = (equipos: ReturnType<typeof eq>[]) => {
  const p = planAvisos(equipos, HOY);
  return [...p.correos, ...p.sinDestinatario][0];
};

describe('el texto del aviso (movido de la app sin cambiar una letra)', () => {
  it('fechas como en la app: DD/MM/AAAA, y «—» sin fecha', () => {
    expect(fechaDia('2026-09-03')).toBe('03/09/2026');
    expect([fechaDia(null), fechaDia(undefined), fechaDia('')]).toEqual(['—', '—', '—']);
  });

  it('marca: «GRIMM» para los GRIMM y la suya para los demás', () => {
    expect([marcaAviso({ marca: 'Grimm' }), marcaAviso({ marca: ' Horiba ' })]).toEqual(['GRIMM', 'Horiba']);
    expect([todosGrimm([{ marca: 'GRIMM' }, { marca: 'grimm' }]), todosGrimm([{ marca: 'Grimm' }, { marca: 'Horiba' }])]).toEqual([true, false]);
  });

  it('el de 30 días, entero: asunto, saludo por su nombre, entrada, línea del equipo, propuesta y firma', () => {
    const e = eq('Cliente Uno', EN_30, desk('compras@cliente-uno.example', 'Ana Pérez'));
    const c = correoAviso(tarjeta([e]));
    expect(c.para).toBe('compras@cliente-uno.example');
    expect(c.asunto).toBe('Último aviso: la calibración de su monitor GRIMM vence en los próximos 30 días · Cliente Uno');
    expect(c.cuerpo).toBe(
      [
        'Estimado/a Ana Pérez:',
        '',
        'Desde el Servicio Técnico de Ambientalia le recordamos, como último aviso, que la calibración del siguiente monitor de partículas GRIMM vence en los próximos 30 días:',
        '',
        `• GRIMM EDM 180C, serial ${e.serial}: última calibración 17/10/2025, vence el 17/10/2026.`,
        '',
        'Para mantener la validez de sus mediciones y evitar paradas no previstas, le proponemos programar desde ahora el servicio de calibración y mantenimiento. Indíquenos la fecha en que podría enviarnos los equipos o, si lo prefiere, coordinamos la recogida.',
        '',
        'Quedamos atentos.',
        '',
        'Ambientalia S.A.S. · Servicio Técnico',
      ].join('\n'),
    );
  });

  it('sin tramo, el texto genérico; sin nombre, el saludo genérico', () => {
    expect(mensajeAviso('Cliente Uno', [eq('Cliente Uno', EN_30)])).toMatch(
      /^Estimado cliente Cliente Uno:\n\nDesde el Servicio Técnico de Ambientalia le recordamos que el siguiente monitor de partículas GRIMM tiene la calibración vencida o próxima a vencer:/,
    );
    expect(saludoAviso('Cliente Uno', [])).toBe('Estimado cliente Cliente Uno:');
  });
});

describe('el texto del grupo «vencida» (aprobado el 2026-11-08)', () => {
  it('el del diseño, letra a letra: un GRIMM, sin nombre de contacto', () => {
    const e = { ...eq('Cliente Ejemplo S.A.S.', '2025-09-15', desk('compras@cliente-ejemplo.example'), 'Grimm', 'EDM 180'), clave: '18A00001', serial: '18A00001' };
    const c = correoAviso(tarjeta([e]));
    expect(c.asunto).toBe('La calibración de su monitor GRIMM está vencida · Cliente Ejemplo S.A.S.');
    expect(c.cuerpo).toBe(
      [
        'Estimado cliente Cliente Ejemplo S.A.S.:',
        '',
        'Desde el Servicio Técnico de Ambientalia le informamos de que la calibración del siguiente monitor de partículas GRIMM está vencida:',
        '',
        '• GRIMM EDM 180, serial 18A00001: última calibración 15/09/2025, vencida desde el 15/09/2026.',
        '',
        'Mientras la calibración esté vencida, las mediciones del equipo pueden perder su validez. Le proponemos programar cuanto antes el servicio de calibración y mantenimiento. Indíquenos la fecha en que podría enviarnos el equipo o, si lo prefiere, coordinamos la recogida.',
        '',
        'Quedamos atentos.',
        '',
        'Ambientalia S.A.S. · Servicio Técnico',
      ].join('\n'),
    );
  });

  it('con varios, «sus monitores GRIMM», «los siguientes…», «de los equipos» y «enviarnos los equipos»; con otra marca, «su equipo»', () => {
    const d = desk('compras@cliente-uno.example');
    const c = correoAviso(tarjeta([eq('Cliente Uno', '2025-09-03', d), eq('Cliente Uno', '2025-08-20', d)]));
    expect(c.asunto).toBe('La calibración de sus monitores GRIMM está vencida · Cliente Uno');
    expect(c.cuerpo).toContain('le informamos de que la calibración de los siguientes monitores de partículas GRIMM está vencida:');
    expect(c.cuerpo).toContain('Mientras la calibración esté vencida, las mediciones de los equipos pueden perder su validez.');
    expect(c.cuerpo).toContain('Indíquenos la fecha en que podría enviarnos los equipos o, si lo prefiere, coordinamos la recogida.');
    const h = correoAviso(tarjeta([eq('Cliente Dos', '2025-09-03', d, 'Horiba', 'APNA-370')]));
    expect(h.asunto).toBe('La calibración de su equipo está vencida · Cliente Dos');
    expect(h.cuerpo).toContain('la calibración del siguiente equipo está vencida:');
    expect(h.cuerpo).toContain('• Horiba APNA-370, serial ');
  });

  it('la etiqueta de cada tramo en la pantalla', () => {
    expect(ETIQUETA_TRAMO).toEqual({ 90: 'Primer aviso · 90 días', 60: 'Recordatorio · 60 días', 30: 'Último aviso · 30 días', vencida: 'Vencida' });
  });
});

describe('CANDADO: avisos-correo.ts es puro (lo carga también la app del portal)', () => {
  const src = readFileSync(fileURLToPath(new URL('./avisos-correo.ts', import.meta.url)), 'utf8');

  it('sólo importa el dominio', () => {
    expect([...src.matchAll(/^import\b[^;]*?from '([^']+)';/gms)].map((m) => m[1])).toEqual(['./dominio.js']);
  });

  it('ni reloj, ni entorno, ni red, ni temporizadores', () => {
    expect(src).not.toMatch(/Date\.now|new Date\(|process\.env|\bfetch\b|n8n|webhook|nodemailer|smtp|sendMail|outbox|setInterval|setTimeout/i);
  });
});
