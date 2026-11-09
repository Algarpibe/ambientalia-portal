import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { correoAviso, fechaDia, marcaAviso, mensajeAviso, saludoAviso, todosGrimm } from './avisos-correo.js';
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

describe('CANDADO: avisos-correo.ts es puro (lo carga también la app del portal)', () => {
  const src = readFileSync(fileURLToPath(new URL('./avisos-correo.ts', import.meta.url)), 'utf8');

  it('sólo importa el dominio', () => {
    expect([...src.matchAll(/^import\b[^;]*?from '([^']+)';/gms)].map((m) => m[1])).toEqual(['./dominio.js']);
  });

  it('ni reloj, ni entorno, ni red, ni temporizadores', () => {
    expect(src).not.toMatch(/Date\.now|new Date\(|process\.env|\bfetch\b|n8n|webhook|nodemailer|smtp|sendMail|outbox|setInterval|setTimeout/i);
  });
});
