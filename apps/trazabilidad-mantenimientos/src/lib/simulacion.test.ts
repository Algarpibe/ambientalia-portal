import { describe, it, expect } from 'vitest';
import { claveCliente, esEmailInterno, estadoCalibracion, planAvisos, type ContactoCliente, type ContactoEquipo, type EquipoVista, type SeguimientoGuardado } from '../dominio';
import { enServicio, mensajeAviso } from './vistas';
import { correoAviso, etiquetaOrigen, fechaRelevante, resumenSimulacion, revisarEmails, saludoAviso, textoParaCopiar } from './simulacion';

// La simulación del aviso automático: qué se enseñaría y con qué texto. Aquí
// no hay red ni envío: sólo se cuenta, se redacta y se revisa lo tecleado.

const HOY = '2026-10-06';
const EN_90 = '2025-12-25'; // vence 2026-12-25 (quedan 80 d)
const EN_60 = '2025-12-02'; // vence 2026-12-02 (quedan 57 d)
const EN_30 = '2025-10-17'; // vence 2026-10-17 (quedan 11 d)

let n = 0;
function eq(cliente: string, ultimaCalibracion: string | null, contacto: ContactoEquipo | null = null, seg: Partial<SeguimientoGuardado> | null = null): EquipoVista {
  const serial = `18A${String(++n).padStart(5, '0')}`;
  return {
    clave: serial,
    serial,
    cliente,
    marca: 'Grimm',
    modelo: 'EDM 180C',
    fechaFactura: null,
    hojaVida: null,
    ultimaEntrada: null,
    ultimaCalibracion,
    entradasSt: null,
    calibracionesPeriodo: null,
    correctivosPeriodo: null,
    ...estadoCalibracion(ultimaCalibracion, HOY),
    serialRepetido: false,
    seguimiento: seg ? { enAmbientalia: false, avisoEnviado: null, servicioProgramado: null, nota: '', actualizadoPor: 'x', actualizadoEn: '', ...seg } : null,
    ticket: null,
    contacto,
  };
}
const desk = (email: string, nombre = '', ticket = 950): ContactoEquipo => ({ nombre, email, origen: 'desk', ticket });
const manual = (cliente: string, emails: string[], nombre = ''): ContactoCliente => ({
  clave: claveCliente(cliente),
  cliente,
  nombre,
  emails,
  internos: emails.filter(esEmailInterno),
  actualizadoPor: 'alguien@example.com',
  actualizadoEn: '2026-10-01',
});
const unCorreo = (equipos: EquipoVista[], manuales: ContactoCliente[] = []) => {
  const p = planAvisos(equipos, HOY, manuales);
  return [...p.correos, ...p.sinDestinatario][0];
};

describe('enServicio sigue siendo una sola regla', () => {
  it('la de la app es la misma función que usa el plan', () => {
    const e = eq('Cliente Uno', EN_30);
    expect(enServicio(e)).toBe(false);
    expect(enServicio({ ...e, ticket: { numero: 962, estado: 'En diagnóstico', sinConfirmar: true } })).toBe(true);
    expect(planAvisos([{ ...e, ticket: { numero: 962, estado: 'En diagnóstico', sinConfirmar: false } }], HOY).enServicio).toHaveLength(1);
  });
});

describe('saludo', () => {
  const d = (email: string, nombre = '') => ({ email, nombre, origen: 'desk' as const, interno: false, ticket: 1 });

  it('con exactamente un destinatario con nombre, se le saluda por su nombre', () => {
    expect(saludoAviso('Cliente Uno', [d('compras@cliente-uno.example', 'Ana Pérez')])).toBe('Estimado/a Ana Pérez:');
    expect(saludoAviso('Cliente Uno', [d('compras@cliente-uno.example', 'Ana Pérez'), d('copia@example.com')])).toBe('Estimado/a Ana Pérez:');
  });

  it('sin nombre, con varios nombres o sin destinatarios, el saludo genérico de siempre', () => {
    const generico = 'Estimado cliente Cliente Uno:';
    expect(saludoAviso('Cliente Uno', [d('compras@cliente-uno.example')])).toBe(generico);
    expect(saludoAviso('Cliente Uno', [d('a@example.com', 'Ana Pérez'), d('b@example.com', 'Luis Gómez')])).toBe(generico);
    expect(saludoAviso('Cliente Uno', [])).toBe(generico);
    expect(saludoAviso('Cliente Uno', [d('a@example.com', '   ')])).toBe(generico);
  });
});

describe('texto del aviso', () => {
  it('sin opciones, mensajeAviso sigue redactando el texto manual de siempre', () => {
    const t = mensajeAviso('Cliente Uno', [eq('Cliente Uno', EN_30)]);
    expect(t).toMatch(/^Estimado cliente Cliente Uno:/);
    expect(t).toContain('le recordamos que el siguiente monitor de partículas GRIMM tiene la calibración vencida o próxima a vencer:');
  });

  it('cada tramo tiene su asunto y su entrada: primer aviso, recordatorio y último aviso', () => {
    const a90 = correoAviso(unCorreo([eq('Cliente Uno', EN_90, desk('compras@cliente-uno.example'))]));
    const a60 = correoAviso(unCorreo([eq('Cliente Uno', EN_60, desk('compras@cliente-uno.example'))]));
    const a30 = correoAviso(unCorreo([eq('Cliente Uno', EN_30, desk('compras@cliente-uno.example'))]));
    expect(a90.asunto).toBe('Calibración de su monitor GRIMM: vence en los próximos 90 días · Cliente Uno');
    expect(a60.asunto).toBe('Recordatorio: la calibración de su monitor GRIMM vence en los próximos 60 días · Cliente Uno');
    expect(a30.asunto).toBe('Último aviso: la calibración de su monitor GRIMM vence en los próximos 30 días · Cliente Uno');
    expect(a90.cuerpo).toContain('le informamos con antelación de que la calibración del siguiente monitor de partículas GRIMM vence en los próximos 90 días:');
    expect(a60.cuerpo).toContain('le recordamos que la calibración del siguiente monitor de partículas GRIMM vence en los próximos 60 días:');
    expect(a30.cuerpo).toContain('le recordamos, como último aviso, que la calibración del siguiente monitor de partículas GRIMM vence en los próximos 30 días:');
  });

  it('el cuerpo conserva las líneas por equipo, la propuesta y la firma del texto manual', () => {
    const e1 = eq('Cliente Uno', EN_30, desk('compras@cliente-uno.example', 'Ana Pérez'));
    const e2 = eq('Cliente Uno', '2025-10-20', desk('compras@cliente-uno.example', 'Ana Pérez'));
    const c = correoAviso(unCorreo([e1, e2]));
    expect(c.asunto).toBe('Último aviso: la calibración de sus monitores GRIMM vence en los próximos 30 días · Cliente Uno');
    expect(c.cuerpo.split('\n')[0]).toBe('Estimado/a Ana Pérez:');
    expect(c.cuerpo).toContain('la calibración de los siguientes monitores de partículas GRIMM vence en los próximos 30 días:');
    expect(c.cuerpo).toContain(`• GRIMM EDM 180C, serial ${e1.serial}: última calibración 17/10/2025, vence el 17/10/2026.`);
    expect(c.cuerpo).toContain(`• GRIMM EDM 180C, serial ${e2.serial}: última calibración 20/10/2025, vence el 20/10/2026.`);
    expect(c.cuerpo).toContain('le proponemos programar desde ahora el servicio de calibración y mantenimiento');
    expect(c.cuerpo.trimEnd().endsWith('Ambientalia S.A.S. · Servicio Técnico')).toBe(true);
  });

  it('«para» lleva los destinatarios en orden; vacío si el grupo no tiene a quién', () => {
    const con = correoAviso(unCorreo([eq('Cliente Uno', EN_30)], [manual('Cliente Uno', ['jefe@cliente-uno.example', 'copia@example.com'], 'Luis Gómez')]));
    expect(con.para).toBe('jefe@cliente-uno.example, copia@example.com');
    expect(con.cuerpo.split('\n')[0]).toBe('Estimado/a Luis Gómez:');
    const sin = correoAviso(unCorreo([eq('Cliente Dos', EN_30)]));
    expect(sin.para).toBe('');
    expect(sin.cuerpo.split('\n')[0]).toBe('Estimado cliente Cliente Dos:');
  });

  it('el texto para copiar junta destinatarios, asunto y cuerpo', () => {
    const c = correoAviso(unCorreo([eq('Cliente Uno', EN_60, desk('compras@cliente-uno.example'))]));
    expect(textoParaCopiar(c)).toBe(`Para: compras@cliente-uno.example\nAsunto: ${c.asunto}\n\n${c.cuerpo}`);
    expect(textoParaCopiar({ ...c, para: '' }).startsWith('Para: (sin destinatario)\n')).toBe(true);
  });
});

describe('resumen de la simulación', () => {
  it('cuenta correos, clientes, equipos y grupos sin destinatario', () => {
    const p = planAvisos(
      [
        eq('Cliente Uno', EN_30, desk('compras@cliente-uno.example')),
        eq('Cliente Uno', EN_30, desk('compras@cliente-uno.example')),
        eq('Cliente Uno', EN_90, desk('compras@cliente-uno.example')),
        eq('Cliente Dos', EN_60, desk('taller@example.com')),
        eq('Cliente Tres', EN_60),
        eq('Cliente Tres', EN_30),
        eq('Cliente Uno', '2026-08-01'),
      ],
      HOY,
    );
    expect(resumenSimulacion(p)).toEqual({ correos: 3, clientes: 2, equipos: 4, sinDestinatario: 2, equiposSinDestinatario: 2 });
  });

  it('sin nada que avisar, todo a cero', () => {
    expect(resumenSimulacion(planAvisos([], HOY))).toEqual({ correos: 0, clientes: 0, equipos: 0, sinDestinatario: 0, equiposSinDestinatario: 0 });
  });
});

describe('correos tecleados en el editor de contacto', () => {
  it('separa por comas, punto y coma, espacios o saltos de línea; en minúsculas y sin repetir', () => {
    expect(revisarEmails(' Jefe@Cliente-Uno.example, copia@example.com;otra@example.com\n jefe@cliente-uno.example ')).toEqual({
      emails: ['jefe@cliente-uno.example', 'copia@example.com', 'otra@example.com'],
      invalidos: [],
      internos: [],
      error: null,
    });
  });

  it('vacío vale: significa quitar el contacto puesto a mano', () => {
    expect(revisarEmails('  ,  ')).toEqual({ emails: [], invalidos: [], internos: [], error: null });
  });

  it('señala los que no tienen forma de correo', () => {
    const r = revisarEmails('jefe@cliente-uno.example no-es-correo a@b');
    expect(r.invalidos).toEqual(['no-es-correo', 'a@b']);
    expect(r.error).toBe('No son correos válidos: no-es-correo, a@b');
  });

  it('más de cinco es demasiado', () => {
    const r = revisarEmails(Array.from({ length: 6 }, (_, i) => `c${i}@example.com`).join(' '));
    expect(r.emails).toHaveLength(6);
    expect(r.error).toBe('Como mucho 5 correos por cliente.');
  });

  it('un correo interno se admite, pero se señala', () => {
    const r = revisarEmails('alguien@ambientalia.com.co, jefe@cliente-uno.example');
    expect(r.error).toBeNull();
    expect(r.internos).toEqual(['alguien@ambientalia.com.co']);
  });
});

describe('textos de apoyo', () => {
  it('origen del destinatario', () => {
    expect(etiquetaOrigen('desk')).toBe('Desk');
    expect(etiquetaOrigen('manual')).toBe('manual');
  });

  it('la fecha que explica por qué un equipo no está en la simulación', () => {
    const p = planAvisos(
      [
        eq('Cliente Uno', EN_60, null, { avisoEnviado: '2026-10-04' }),
        eq('Cliente Uno', EN_30, null, { enAmbientalia: true }),
        eq('Cliente Uno', '2025-09-03'),
        eq('Cliente Uno', '2024-03-26'),
      ],
      HOY,
    );
    expect(fechaRelevante(p.yaAvisados[0])).toBe('avisado el 04/10/2026 · en el tramo desde el 03/10/2026');
    expect(fechaRelevante(p.enServicio[0])).toBe('vence el 17/10/2026');
    expect(fechaRelevante(p.vencidasSinAviso[0])).toBe('venció el 03/09/2026');
    expect(fechaRelevante(p.fueraCiclo[0])).toBe('venció el 26/03/2025');
  });
});
