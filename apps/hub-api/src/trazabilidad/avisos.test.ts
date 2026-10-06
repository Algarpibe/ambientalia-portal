import { describe, it, expect } from 'vitest';
import {
  CONTACTO_MAX_EMAILS,
  DOMINIOS_INTERNOS,
  TRAMOS_AVISO,
  claveCliente,
  contactoDeTickets,
  contactoEfectivo,
  enServicio,
  entradaTramo,
  esEmail,
  esEmailInterno,
  estadoCalibracion,
  evaluarAviso,
  nombreContacto,
  normalizarEmail,
  planAvisos,
  tramoDeEstado,
  type ContactoCliente,
  type ContactoEquipo,
  type EquipoAviso,
} from './dominio.js';

// El plan del aviso automático y los contactos, que viven en el dominio puro
// (dominio.ts) porque los usan el servidor y la app. Es una SIMULACIÓN: aquí
// sólo se calcula qué se enviaría; nada de esto envía nada.

const HOY = '2026-10-06';
// Última calibración → vence un año después. A fecha HOY:
const EN_90 = '2025-12-25'; // vence 2026-12-25, quedan 80 d → VENCE_90, entra el 2026-09-26
const EN_60 = '2025-12-02'; // vence 2026-12-02, quedan 57 d → VENCE_60, entra el 2026-10-03
const EN_30 = '2025-10-17'; // vence 2026-10-17, quedan 11 d → VENCE_30, entra el 2026-09-17
const VENCIDA = '2025-09-03'; // venció el 2026-09-03
const FUERA = '2024-03-26';
const AL_DIA = '2026-08-01';

let n = 0;
type Extra = { aviso?: string | null; enAmbientalia?: boolean; ticket?: boolean; contacto?: ContactoEquipo | null };
function eq(cliente: string, ultimaCalibracion: string | null, x: Extra = {}): EquipoAviso {
  const serial = `18A${String(++n).padStart(5, '0')}`;
  return {
    clave: serial,
    serial,
    cliente,
    modelo: 'EDM 180C',
    ultimaCalibracion,
    seguimiento: x.aviso !== undefined || x.enAmbientalia !== undefined ? { enAmbientalia: x.enAmbientalia ?? false, avisoEnviado: x.aviso ?? null } : null,
    ticket: x.ticket ? { numero: 962 } : null,
    contacto: x.contacto === undefined ? null : x.contacto,
  };
}
const desk = (email: string, nombre = '', ticket = 900): ContactoEquipo => ({ nombre, email, origen: 'desk', ticket });
const manual = (cliente: string, emails: string[], nombre = ''): ContactoCliente => ({
  clave: claveCliente(cliente),
  cliente,
  nombre,
  emails,
  internos: emails.filter(esEmailInterno),
  actualizadoPor: 'alguien@example.com',
  actualizadoEn: '2026-10-01',
});

describe('correos: forma y dominio interno', () => {
  it('normaliza: sin espacios y en minúsculas', () => {
    expect(normalizarEmail('  Compras@Cliente-Uno.Example ')).toBe('compras@cliente-uno.example');
    expect(normalizarEmail(null)).toBe('');
    expect(normalizarEmail(7)).toBe('');
  });

  it.each(['compras@cliente-uno.example', 'a.b+c@example.com', "o'neil@sub.example.com", 'x_1@example.co'])('%s es un correo', (e) => {
    expect(esEmail(e)).toBe(true);
  });

  it.each(['', 'sin-arroba', 'a@b', 'a@@example.com', 'a b@example.com', '@example.com', 'a@.com', 'a@example..com', 'a@example.c', '.a@example.com', 'a..b@example.com', 'a@-example.com', 'Nombre <a@example.com>', `${'x'.repeat(250)}@example.com`])(
    '%j no es un correo',
    (e) => {
      expect(esEmail(e)).toBe(false);
    },
  );

  it('interno = dominio de la lista (o un subdominio suyo), sin distinguir mayúsculas', () => {
    expect(DOMINIOS_INTERNOS).toContain('ambientalia.com.co');
    expect(esEmailInterno('alguien@ambientalia.com.co')).toBe(true);
    expect(esEmailInterno(' Alguien@AMBIENTALIA.com.co ')).toBe(true);
    expect(esEmailInterno('alguien@correo.ambientalia.com.co')).toBe(true);
    expect(esEmailInterno('alguien@noambientalia.com.co')).toBe(false);
    expect(esEmailInterno('alguien@ambientalia.com.co.example')).toBe(false);
    expect(esEmailInterno('compras@cliente-uno.example')).toBe(false);
    expect(esEmailInterno('')).toBe(false);
  });

  it('la clave de un cliente es la misma normalización que la de los tipos de servicio', () => {
    expect(claveCliente('  Cliente  Único S.A.S. ')).toBe('cliente unico s.a.s.');
    expect(claveCliente('CLIENTE UNO')).toBe(claveCliente('cliente uno'));
    expect(claveCliente(null)).toBe('');
  });

  it('el nombre del contacto: nombre y apellido, sin espacios de más (puede quedar vacío)', () => {
    expect(nombreContacto(' Ana ', '  Pérez ')).toBe('Ana Pérez');
    expect(nombreContacto(null, 'Pérez')).toBe('Pérez');
    expect(nombreContacto(undefined, null)).toBe('');
  });
});

describe('contacto de un equipo', () => {
  it('de Desk: el ticket de número más alto con un correo que valga', () => {
    const c = contactoDeTickets([
      { numero: 900, email: 'viejo@cliente-uno.example', nombre: 'Ana', apellido: 'Pérez' },
      { numero: 950, email: ' Compras@Cliente-Uno.example ', nombre: 'Luis', apellido: 'Gómez' },
    ]);
    expect(c).toEqual({ nombre: 'Luis Gómez', email: 'compras@cliente-uno.example', origen: 'desk', ticket: 950 });
  });

  it('salta los correos internos, vacíos y mal formados y retrocede a un ticket más antiguo', () => {
    const c = contactoDeTickets([
      { numero: 990, email: 'alguien@ambientalia.com.co', nombre: 'Interno', apellido: '' },
      { numero: 980, email: 'no-es-un-correo' },
      { numero: 970, email: '   ' },
      { numero: 960, email: 'compras@cliente-uno.example' },
      { numero: 950, email: 'otro@cliente-uno.example' },
    ]);
    expect(c).toEqual({ nombre: '', email: 'compras@cliente-uno.example', origen: 'desk', ticket: 960 });
  });

  it('sin tickets, o sin ninguno que valga → null', () => {
    expect(contactoDeTickets([])).toBeNull();
    expect(contactoDeTickets([{ numero: 1, email: 'alguien@ambientalia.com.co' }, { numero: 2, email: null }])).toBeNull();
  });

  it('el contacto puesto a mano al cliente gana al de Desk; sin él, vale el de Desk', () => {
    const d = desk('compras@cliente-uno.example', 'Ana Pérez', 950);
    expect(contactoEfectivo(null, d)).toEqual(d);
    expect(contactoEfectivo(null, null)).toBeNull();
    expect(contactoEfectivo(manual('Cliente Uno', ['jefe@cliente-uno.example', 'copia@example.com'], 'Luis Gómez'), d)).toEqual({
      nombre: 'Luis Gómez',
      email: 'jefe@cliente-uno.example',
      origen: 'manual',
      ticket: null,
    });
  });
});

describe('tramos del aviso', () => {
  it('son 90, 60 y 30, y cada estado próximo a vencer tiene el suyo', () => {
    expect([...TRAMOS_AVISO]).toEqual([90, 60, 30]);
    expect(tramoDeEstado('VENCE_90')).toBe(90);
    expect(tramoDeEstado('VENCE_60')).toBe(60);
    expect(tramoDeEstado('VENCE_30')).toBe(30);
    for (const e of ['AL_DIA', 'SIN_FECHA', 'VENCIDA', 'FUERA_CICLO'] as const) expect(tramoDeEstado(e)).toBeNull();
  });

  it('se entra en un tramo el día «vence − tramo»', () => {
    expect(entradaTramo('2026-12-02', 60)).toBe('2026-10-03');
    expect(entradaTramo('2026-12-25', 90)).toBe('2026-09-26');
    expect(entradaTramo('2026-10-17', 30)).toBe('2026-09-17');
  });

  it('el día de entrada es el primero en que el equipo tiene ya el estado de ese tramo', () => {
    // vence 2026-12-02: el 2026-10-02 quedan 61 d (aún VENCE_90) y el 2026-10-03 quedan 60 (ya VENCE_60).
    expect(estadoCalibracion(EN_60, '2026-10-02').estado).toBe('VENCE_90');
    expect(estadoCalibracion(EN_60, '2026-10-03').estado).toBe('VENCE_60');
  });
});

describe('evaluarAviso: ¿tocaría avisar hoy?', () => {
  it('en un tramo y sin aviso → toca, con su tramo, su día de entrada y los días que quedan', () => {
    expect(evaluarAviso(eq('Cliente Uno', EN_90), HOY)).toMatchObject({ motivo: 'DEBIDO', tramo: 90, entradaTramo: '2026-09-26', diasParaVencer: 80, vence: '2026-12-25', estado: 'VENCE_90' });
    expect(evaluarAviso(eq('Cliente Uno', EN_60), HOY)).toMatchObject({ motivo: 'DEBIDO', tramo: 60, entradaTramo: '2026-10-03', diasParaVencer: 57 });
    expect(evaluarAviso(eq('Cliente Uno', EN_30), HOY)).toMatchObject({ motivo: 'DEBIDO', tramo: 30, entradaTramo: '2026-09-17', diasParaVencer: 11 });
  });

  it('una vez por tramo: un aviso anterior a la entrada no vale; el del día de entrada o posterior, sí', () => {
    // Tramo 60, se entró el 2026-10-03.
    expect(evaluarAviso(eq('Cliente Uno', EN_60, { aviso: '2026-10-02' }), HOY).motivo).toBe('DEBIDO'); // el aviso fue el del tramo 90
    expect(evaluarAviso(eq('Cliente Uno', EN_60, { aviso: '2026-10-03' }), HOY).motivo).toBe('YA_AVISADO');
    expect(evaluarAviso(eq('Cliente Uno', EN_60, { aviso: '2026-10-05' }), HOY).motivo).toBe('YA_AVISADO');
    expect(evaluarAviso(eq('Cliente Uno', EN_60, { aviso: null }), HOY).motivo).toBe('DEBIDO');
  });

  it('nunca para un equipo en servicio: ticket abierto en Desk o «en Ambientalia» a mano', () => {
    expect(evaluarAviso(eq('Cliente Uno', EN_30, { ticket: true }), HOY)).toMatchObject({ motivo: 'EN_SERVICIO', tramo: 30 });
    expect(evaluarAviso(eq('Cliente Uno', EN_30, { enAmbientalia: true }), HOY)).toMatchObject({ motivo: 'EN_SERVICIO', tramo: 30 });
    // En servicio manda sobre «ya avisado».
    expect(evaluarAviso(eq('Cliente Uno', EN_30, { enAmbientalia: true, aviso: '2026-10-01' }), HOY).motivo).toBe('EN_SERVICIO');
    expect(enServicio(eq('Cliente Uno', EN_30))).toBe(false);
    expect(enServicio(eq('Cliente Uno', EN_30, { enAmbientalia: false }))).toBe(false);
    expect(enServicio(eq('Cliente Uno', EN_30, { ticket: true }))).toBe(true);
  });

  it('al día y sin fecha no están en ningún tramo', () => {
    expect(evaluarAviso(eq('Cliente Uno', AL_DIA), HOY)).toMatchObject({ motivo: 'SIN_TRAMO', tramo: null, entradaTramo: null });
    expect(evaluarAviso(eq('Cliente Uno', null), HOY)).toMatchObject({ motivo: 'SIN_TRAMO', tramo: null, diasParaVencer: null });
  });

  it('vencida y fuera de ciclo quedan fuera de la regla automática, cada una con su motivo', () => {
    expect(evaluarAviso(eq('Cliente Uno', VENCIDA), HOY)).toMatchObject({ motivo: 'VENCIDA', tramo: null, diasParaVencer: -33 });
    expect(evaluarAviso(eq('Cliente Uno', FUERA), HOY)).toMatchObject({ motivo: 'FUERA_CICLO', tramo: null });
  });

  it('el estado se calcula a la fecha «hoy» que se pide', () => {
    expect(evaluarAviso(eq('Cliente Uno', EN_60), '2026-10-02')).toMatchObject({ motivo: 'DEBIDO', tramo: 90 });
    expect(evaluarAviso(eq('Cliente Uno', EN_60), '2026-11-10')).toMatchObject({ motivo: 'DEBIDO', tramo: 30, entradaTramo: '2026-11-02' });
  });
});

describe('planAvisos: un correo simulado por cliente y tramo', () => {
  it('agrupa por cliente y tramo; los más urgentes primero', () => {
    const a90 = eq('Cliente Uno', EN_90, { contacto: desk('compras@cliente-uno.example') });
    const a30 = eq('Cliente Uno', EN_30, { contacto: desk('compras@cliente-uno.example') });
    const a30b = eq('cliente  UNO', EN_30, { contacto: desk('compras@cliente-uno.example') });
    const b60 = eq('Cliente Dos', EN_60, { contacto: desk('taller@example.com') });
    const p = planAvisos([a90, a30, a30b, b60, eq('Cliente Dos', AL_DIA)], HOY);
    expect(p.correos.map((c) => [c.cliente, c.tramo, c.equipos.map((x) => x.equipo.serial)])).toEqual([
      ['Cliente Uno', 30, [a30.serial, a30b.serial]],
      ['Cliente Dos', 60, [b60.serial]],
      ['Cliente Uno', 90, [a90.serial]],
    ]);
    expect(p.sinDestinatario).toEqual([]);
    expect(p.hoy).toBe(HOY);
  });

  it('destinatarios de Desk: los correos distintos de los equipos del grupo, en minúsculas', () => {
    const p = planAvisos(
      [
        eq('Cliente Uno', EN_30, { contacto: desk('Compras@Cliente-Uno.example', 'Ana Pérez', 950) }),
        eq('Cliente Uno', EN_30, { contacto: desk('compras@cliente-uno.example', 'Ana Pérez', 951) }),
        eq('Cliente Uno', EN_30, { contacto: desk('taller@cliente-uno.example', '', 952) }),
        eq('Cliente Uno', EN_30),
      ],
      HOY,
    );
    expect(p.correos).toHaveLength(1);
    expect(p.correos[0].destinatarios).toEqual([
      { email: 'compras@cliente-uno.example', nombre: 'Ana Pérez', origen: 'desk', interno: false, ticket: 950 },
      { email: 'taller@cliente-uno.example', nombre: '', origen: 'desk', interno: false, ticket: 952 },
    ]);
    expect(p.correos[0].origen).toBe('desk');
  });

  it('un correo interno que venga de Desk nunca es destinatario', () => {
    const p = planAvisos([eq('Cliente Uno', EN_30, { contacto: desk('alguien@ambientalia.com.co') }), eq('Cliente Uno', EN_30, { contacto: desk('compras@cliente-uno.example') })], HOY);
    expect(p.correos[0].destinatarios.map((d) => d.email)).toEqual(['compras@cliente-uno.example']);
    const solo = planAvisos([eq('Cliente Dos', EN_30, { contacto: desk('alguien@ambientalia.com.co') })], HOY);
    expect(solo.correos).toEqual([]);
    expect(solo.sinDestinatario).toHaveLength(1);
  });

  it('el contacto puesto a mano al cliente gana a Desk en todos sus grupos, y sus internos se marcan', () => {
    const p = planAvisos(
      [eq('Cliente Uno', EN_30, { contacto: desk('compras@cliente-uno.example') }), eq('CLIENTE UNO', EN_60), eq('Cliente Dos', EN_30, { contacto: desk('taller@example.com') })],
      HOY,
      [manual(' cliente  uno ', ['jefe@cliente-uno.example', 'alguien@ambientalia.com.co'], 'Luis Gómez')],
    );
    const uno = p.correos.filter((c) => c.claveCliente === 'cliente uno');
    expect(uno.map((c) => c.tramo)).toEqual([30, 60]);
    for (const c of uno) {
      expect(c.origen).toBe('manual');
      expect(c.destinatarios).toEqual([
        { email: 'jefe@cliente-uno.example', nombre: 'Luis Gómez', origen: 'manual', interno: false, ticket: null },
        { email: 'alguien@ambientalia.com.co', nombre: '', origen: 'manual', interno: true, ticket: null },
      ]);
    }
    expect(p.correos.find((c) => c.cliente === 'Cliente Dos')!.destinatarios.map((d) => d.origen)).toEqual(['desk']);
  });

  it('un grupo sin ningún destinatario va aparte, «sin destinatario»', () => {
    const p = planAvisos([eq('Cliente Uno', EN_30), eq('Cliente Dos', EN_30, { contacto: desk('taller@example.com') })], HOY);
    expect(p.correos.map((c) => c.cliente)).toEqual(['Cliente Dos']);
    expect(p.sinDestinatario.map((c) => [c.cliente, c.tramo, c.destinatarios, c.origen])).toEqual([['Cliente Uno', 30, [], null]]);
  });

  it('lo que no entra queda en su grupo informativo, con su motivo', () => {
    const avisado = eq('Cliente Uno', EN_60, { aviso: '2026-10-04' });
    const enCasa = eq('Cliente Uno', EN_30, { ticket: true });
    const vencida = eq('Cliente Uno', VENCIDA);
    const vencidaAvisadaAntes = eq('Cliente Uno', VENCIDA, { aviso: '2026-08-20' }); // el aviso fue antes de vencer
    const vencidaAvisada = eq('Cliente Uno', VENCIDA, { aviso: '2026-09-03' }); // avisada el día en que venció
    const vencidaEnCasa = eq('Cliente Uno', VENCIDA, { enAmbientalia: true });
    const fuera = eq('Cliente Uno', FUERA);
    const p = planAvisos([avisado, enCasa, vencida, vencidaAvisadaAntes, vencidaAvisada, vencidaEnCasa, fuera, eq('Cliente Uno', AL_DIA), eq('Cliente Uno', null)], HOY);
    expect(p.correos).toEqual([]);
    expect(p.sinDestinatario).toEqual([]);
    expect(p.yaAvisados.map((x) => x.equipo.serial)).toEqual([avisado.serial]);
    expect(p.enServicio.map((x) => x.equipo.serial)).toEqual([enCasa.serial]);
    expect(p.vencidasSinAviso.map((x) => x.equipo.serial)).toEqual([vencida.serial, vencidaAvisadaAntes.serial]);
    expect(p.fueraCiclo.map((x) => x.equipo.serial)).toEqual([fuera.serial]);
    expect(p.vencidasSinAviso.every((x) => x.motivo === 'VENCIDA')).toBe(true);
  });

  it('las vencidas y las de fuera de ciclo no generan ningún correo simulado aunque tengan contacto', () => {
    const p = planAvisos([eq('Cliente Uno', VENCIDA, { contacto: desk('compras@cliente-uno.example') }), eq('Cliente Uno', FUERA, { contacto: desk('compras@cliente-uno.example') })], HOY);
    expect(p.correos).toEqual([]);
    expect(p.sinDestinatario).toEqual([]);
  });

  it('como mucho cinco destinatarios puestos a mano: es el tope del contacto', () => {
    expect(CONTACTO_MAX_EMAILS).toBe(5);
  });
});
