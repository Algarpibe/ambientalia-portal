import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fechaEfectiva, type FilaCalibracion } from './calibraciones.js';
import { claveCliente } from './dominio.js';
import type { Celda, FilaCongelada } from './fst022.js';
import { tablaHoja, type EquipoHoja } from './hoja.js';
import { EN_INVENTARIO, claveMarcaSql } from './inventario.js';
import { CLAVE_EDM180, claveMarca, etiquetaMarca, marcasEnSeguimiento, planAdopcion } from './marcas.js';

// Marcas en seguimiento (lote 9f, migración 061), sin base: la clave de una
// marca, la regla de qué entra en el inventario, la vista previa por marca y lo
// que hay que escribir al incluir una marca para que sus fechas no se muevan
// (`planAdopcion`). Clientes y seriales inventados (el repo es público).

const HOY = '2026-10-17';
const CABECERAS: Celda[][] = [['Cliente', 'Marca', 'Modelo', 'Serial', 'Última Calibración', 'Vigencia de Calibración (Dias)']];
let n = 5;
const fila = (cliente: string, marca: string, modelo: string, serial: string, ultima: string | null): FilaCongelada => ({
  fila: ++n, celdas: [cliente, marca, modelo, serial, ultima ? { v: ultima, t: 'fecha' } : null, 357], esEquipo: true, serialNorm: serial.toUpperCase(), claveEquipo: null,
});
const equipo = (clave: string, marca: string, extra: Partial<EquipoHoja> = {}): EquipoHoja => ({ clave, serial: clave, cliente: 'Cliente Ficticio H S.A.S.', marca, modelo: 'APNA-370', activo: true, ultimaCalibracion: null, enSeguimiento: false, ...extra });
let id = 100;
const cal = (clave: string | null, serial: string, fecha: string, extra: Partial<FilaCalibracion> = {}): FilaCalibracion => ({ id: ++id, clave, serial, deskEquipoId: null, fecha, origen: 'desk', ticket: 1000 + id, estado: 'vigente', corrigeTicket: null, corrigeFecha: null, anuladaAMano: false, ...extra });

/** Una hoja con varias marcas: GRIMM EDM 180 en seguimiento, Horiba enlazados fuera de seguimiento (con calibraciones sueltas por serial), un GRIMM de otro modelo y un Kunak. */
function escenario() {
  n = 5;
  const filas = [
    fila('Cliente Ficticio A', 'Grimm', 'EDM 180C', '18A00001', '2025-10-20'),
    fila('Cliente Ficticio H', 'HORIBA', 'APNA 370', 'HB-0001', '2025-01-10'), // vencida (≤ 1 año): con un ticket posterior sin clave
    fila('Cliente Ficticio H', 'Horiba', 'APSA-370', 'HB-0002', '2023-02-01'), // +1 año
    fila('Cliente Ficticio J', 'Horiba', 'APNA-370', 'HB-0003', null), // sin fecha en la hoja: una manual suelta por serial
    fila('Cliente Ficticio J', 'Horiba', 'APNA-370', 'HB-0004', '2026-12-01'), // fecha futura: en revisión
    fila('Cliente Ficticio K', 'Kunak', 'AIR Pro', 'KN-0001', '2025-12-20'), // por vencer, pero su marca no se enciende
    fila('Cliente Ficticio Z', 'Grimm', 'EDM 280', '28A00001', '2025-11-30'), // GRIMM de otro modelo
    fila('Cliente Ficticio R', 'Horiba', 'APNA-370', 'HB-0009', '2025-11-01'), // retirado a mano
  ];
  const equipos: EquipoHoja[] = [
    equipo('18A00001', 'GRIMM', { cliente: 'Cliente Ficticio A S.A.S.', modelo: 'EDM 180C', enSeguimiento: true, ultimaCalibracion: '2025-10-20' }),
    equipo('HB-0001', 'Horiba'),
    equipo('HB-0002', 'Horiba'),
    equipo('HB-0003', 'Horiba', { cliente: 'Cliente Ficticio J S.A.S.' }),
    equipo('HB-0004', 'Horiba', { cliente: 'Cliente Ficticio J S.A.S.' }),
    equipo('HB-0005', ' HORIBA ', { cliente: 'Cliente Ficticio Nuevo' }), // está en Desk 2.0 y no en la hoja: su calibración, por serial
    equipo('HB-0006', 'Horiba', { activo: false }), // inactivo en Desk 2.0: no entra
    equipo('HB-0009', 'Horiba', { activo: false, retirado: { por: 'director@example.com', en: '2026-10-01 10:00:00+00', motivo: 'Ya no se atiende.' } }),
    equipo('KN-0001', 'Kunak', { cliente: 'Cliente Ficticio K' }),
    equipo('28A00001', 'GRIMM', { cliente: 'Cliente Ficticio Z', modelo: 'EDM 280' }),
    equipo('SM-0001', '', { cliente: 'Cliente Ficticio S' }), // sin marca: no tiene interruptor
  ];
  const calibraciones = [
    cal('18A00001', '18A00001', '2025-10-20', { origen: 'fst022', ticket: null }),
    cal(null, 'HB-0001', '2025-09-15'), // ticket de Desk sin clave: la pestaña se la atribuye por serial
    cal(null, 'HB-0003', '2026-03-03', { origen: 'manual', ticket: null }), // manual guardada por serial (lote 9d-2b)
    cal(null, 'HB-0005', '2026-05-05'), // del que no está en la hoja
    cal(null, 'KN-0001', '2026-03-01'),
  ];
  return { filas, equipos, calibraciones };
}
const tabla = (e: ReturnType<typeof escenario>, equipos = e.equipos, calibraciones = e.calibraciones) => tablaHoja({ hoy: HOY, cabeceras: CABECERAS, filas: e.filas, equipos, calibraciones });
const sinClave = (cs: readonly FilaCalibracion[]) => new Set(cs.filter((c) => c.clave === null).map((c) => c.id));
const todas = (t: ReturnType<typeof tabla>) => [...t.filas, ...t.fueraDeHoja].filter((f) => f.clave !== null);

/** Lo que escribiría la base al incluir: la partida, con su clave; las sueltas, enlazadas. Ninguna fecha cambia. */
function aplicar(cs: readonly FilaCalibracion[], adopcion: ReturnType<typeof planAdopcion>): FilaCalibracion[] {
  const enlazar = new Map(adopcion.enlazar.map((x) => [x.id, x.clave]));
  return [...cs.map((c) => (enlazar.has(c.id) ? { ...c, clave: enlazar.get(c.id)! } : c)), ...adopcion.partidas.map((p) => cal(p.clave, p.serial, p.fecha, { origen: 'fst022', ticket: null, estado: p.estado }))];
}

describe('la clave de una marca', () => {
  it('es la de la pestaña: sin mayúsculas, tildes ni espacios de más («HORIBA» = « Horiba »)', () => {
    expect([claveMarca('HORIBA'), claveMarca(' Horiba '), claveMarca('Énvironics  Inc'), claveMarca('GRIMM')]).toEqual(['horiba', 'horiba', 'environics inc', 'grimm']);
    for (const m of ['HORIBA', 'Énvironics  Inc', 'Ñandú']) expect(claveMarca(m)).toBe(claveCliente(m));
  });

  it('GRIMM EDM 180 es la fila fija, con su clave propia; el interruptor «grimm» es el de los GRIMM de otros modelos', () => {
    expect(CLAVE_EDM180).toBe('grimm edm 180');
    expect([etiquetaMarca(CLAVE_EDM180, 'GRIMM'), etiquetaMarca('grimm', 'GRIMM'), etiquetaMarca('horiba', 'Horiba')]).toEqual(['GRIMM EDM 180', 'GRIMM (otros modelos)', 'Horiba']);
  });
});

describe('qué es el inventario (inventario.ts): un solo sitio, en SQL', () => {
  it('en seguimiento (los GRIMM EDM 180) O de una marca incluida; la marca, por su clave, en la misma consulta', () => {
    expect(EN_INVENTARIO).toBe(`(en_seguimiento OR ${claveMarcaSql('marca')} IN (SELECT m.clave FROM portal.tmc_marcas m WHERE m.incluida))`);
    expect(claveMarcaSql('marca')).toMatch(/^btrim\(regexp_replace\(lower\(translate\(marca, '[^']+', '[^']+'\)\), '\\s\+', ' ', 'g'\)\)$/);
  });

  it('inventario.ts no importa nada: lo leen repo.ts, calibraciones-repo.ts, hoja-repo.ts y el maestro sin ciclos', () => {
    expect(readFileSync(fileURLToPath(new URL('./inventario.ts', import.meta.url)), 'utf8')).not.toMatch(/^import /m);
  });
});

describe('la pestaña con una marca incluida (hoja.ts)', () => {
  it('un equipo de una marca incluida está «en el inventario»: su fecha es la de sus calibraciones por clave (la de Equipos), y su marca y su modelo se comparan sin ruido', () => {
    const e = escenario();
    const t = tabla(e, e.equipos.map((q) => (q.clave === 'HB-0001' ? { ...q, incluido: true } : q)), [cal('HB-0001', 'HB-0001', '2025-01-10', { origen: 'fst022', ticket: null })]);
    const f = t.filas.find((x) => x.clave === 'HB-0001')!;
    expect([f.situacion, f.ultimaCalibracion, f.enHoja]).toEqual(['inventario', '2025-01-10', { cliente: 'Cliente Ficticio H' }]);
    expect(t.filas.find((x) => x.clave === 'HB-0002')!.situacion).toBe('enlazado');
    expect(t.resumen.enInventario).toBe(2);
  });
});

describe('incluir una marca: la partida y las sueltas (planAdopcion)', () => {
  const objetivo = (e: ReturnType<typeof escenario>, marca: string) => new Set(e.equipos.filter((q) => q.enSeguimiento === false && claveMarca(q.marca) === marca).map((q) => q.clave));

  it('a cada equipo de la marca, su fecha de la hoja como fila de partida (con su estado: una futura, en revisión) y sus calibraciones sueltas enlazadas; nada de otras marcas', () => {
    const e = escenario();
    const a = planAdopcion(tabla(e), objetivo(e, 'horiba'), sinClave(e.calibraciones));
    expect(a.partidas).toEqual([
      { clave: 'HB-0001', serial: 'HB-0001', fecha: '2025-01-10', estado: 'vigente', fila: 7 },
      { clave: 'HB-0002', serial: 'HB-0002', fecha: '2023-02-01', estado: 'vigente', fila: 8 },
      { clave: 'HB-0004', serial: 'HB-0004', fecha: '2026-12-01', estado: 'en_revision', fila: 10 },
      { clave: 'HB-0009', serial: 'HB-0009', fecha: '2025-11-01', estado: 'vigente', fila: 13 },
    ]);
    expect(a.enlazar).toEqual([{ id: e.calibraciones[1].id, clave: 'HB-0001' }, { id: e.calibraciones[2].id, clave: 'HB-0003' }, { id: e.calibraciones[3].id, clave: 'HB-0005' }]);
  });

  it('INVARIANTE: tras incluir, la fecha de cada equipo de la marca —la de Equipos (`fechaEfectiva` por clave) y la de la pestaña— es la MISMA que daba la pestaña antes; al apagar, también', () => {
    const e = escenario();
    const antes = new Map(todas(tabla(e)).map((f) => [f.clave, [f.ultimaCalibracion, f.estado]]));
    const guardadas = aplicar(e.calibraciones, planAdopcion(tabla(e), objetivo(e, 'horiba'), sinClave(e.calibraciones)));
    const incluidos = e.equipos.map((q) => (claveMarca(q.marca) === 'horiba' ? { ...q, incluido: true } : q));
    const despues = tabla(e, incluidos, guardadas);
    for (const f of todas(despues)) {
      expect([f.ultimaCalibracion, f.estado], f.clave!).toEqual(antes.get(f.clave));
      if (claveMarca(e.equipos.find((q) => q.clave === f.clave)!.marca) !== 'horiba') continue;
      expect(f.situacion, f.clave!).toBe(e.equipos.find((q) => q.clave === f.clave)!.activo ? 'inventario' : 'inactivo');
      expect(fechaEfectiva(guardadas.filter((c) => c.clave === f.clave), null, HOY), f.clave!).toBe(f.ultimaCalibracion);
    }
    // Apagar no borra nada: con las filas ya enlazadas, la pestaña sigue dando las mismas fechas.
    expect(todas(tabla(e, e.equipos, guardadas)).map((f) => [f.clave, f.ultimaCalibracion, f.situacion])).toEqual(todas(tabla(e)).map((f) => [f.clave, f.ultimaCalibracion, f.situacion]));
  });

  it('idempotente: volver a encender (o encenderla dos veces) no trae ni una partida ni un enlace más', () => {
    const e = escenario();
    const guardadas = aplicar(e.calibraciones, planAdopcion(tabla(e), objetivo(e, 'horiba'), sinClave(e.calibraciones)));
    expect(planAdopcion(tabla(e, e.equipos, guardadas), objetivo(e, 'horiba'), sinClave(guardadas))).toEqual({ partidas: [], enlazar: [] });
  });

  it('la partida que una persona anuló (guardada sin clave, lote 9d-2b) se enlaza, no se vuelve a sacar de la hoja: sigue sin contar', () => {
    const e = escenario();
    const anulada = cal(null, 'HB-0002', '2023-02-01', { origen: 'fst022', ticket: null, estado: 'anulada', anuladaAMano: true });
    const cs = [...e.calibraciones, anulada];
    const a = planAdopcion(tabla(e, e.equipos, cs), objetivo(e, 'horiba'), sinClave(cs));
    expect(a.partidas.map((p) => p.clave)).not.toContain('HB-0002');
    expect(a.enlazar).toContainEqual({ id: anulada.id, clave: 'HB-0002' });
    expect(tabla(e, e.equipos, cs).filas.find((f) => f.clave === 'HB-0002')!.ultimaCalibracion).toBeNull();
  });
});

describe('la vista previa por marca (marcasEnSeguimiento)', () => {
  const vista = (guardadas: Parameters<typeof marcasEnSeguimiento>[0]['guardadas'] = []) => {
    const e = escenario();
    return marcasEnSeguimiento({ tabla: tabla(e), equipos: e.equipos, guardadas, sinClave: sinClave(e.calibraciones) });
  };

  it('una fila por marca: GRIMM EDM 180 primero, fija y siempre incluida; después las demás, de más a menos equipos; lo que no tiene marca no tiene interruptor', () => {
    expect(vista().map((m) => [m.clave, m.marca, m.fija, m.incluida])).toEqual([
      ['grimm edm 180', 'GRIMM EDM 180', true, true],
      ['horiba', 'Horiba', false, false],
      ['grimm', 'GRIMM (otros modelos)', false, false],
      ['kunak', 'Kunak', false, false],
    ]);
  });

  it('cuántos entrarían (activos y no retirados), en qué estado, cuántos en avisos y de cuántos clientes —+1 año y sin fecha no avisan—, y cuántas partidas y enlaces', () => {
    const horiba = vista().find((m) => m.clave === 'horiba')!;
    expect(horiba.resumen).toEqual({
      equipos: 5,
      porEstado: { FUERA_CICLO: 1, VENCIDA: 1, VENCE_30: 0, VENCE_60: 0, VENCE_90: 0, AL_DIA: 2, SIN_FECHA: 1 },
      avisos: 1,
      clientesAvisos: 1,
      partidas: 4,
      enlazadas: 3,
    });
    expect(vista().find((m) => m.clave === 'kunak')!.resumen).toMatchObject({ equipos: 1, avisos: 0, partidas: 1, enlazadas: 1 });
    expect(vista()[0].resumen).toMatchObject({ equipos: 1, avisos: 1, clientesAvisos: 1, partidas: 0, enlazadas: 0 });
  });

  it('una marca guardada dice si está incluida y su firma; una guardada que ya no tiene equipos sigue saliendo (para poder apagarla)', () => {
    const firma = { por: 'director@example.com', en: '2026-10-17 15:00:00+00', motivo: 'Decisión ficticia.' };
    const v = vista([{ clave: 'horiba', marca: 'Horiba', incluida: true, ...firma }, { clave: 'thermo', marca: 'Thermo', incluida: true, ...firma }]);
    expect(v.map((m) => [m.clave, m.incluida])).toEqual([['grimm edm 180', true], ['horiba', true], ['thermo', true], ['grimm', false], ['kunak', false]]);
    expect(v[1].firma).toEqual(firma);
    expect(v[2].resumen.equipos).toBe(0);
    expect(JSON.stringify(v)).not.toMatch(/Ficticio|HB-|KN-|18A0/);
  });
});

describe('061_trazabilidad_marcas_seguimiento.sql', () => {
  const fuente = (f: string) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');
  const sinComentarios = fuente('../users/migrations/061_trazabilidad_marcas_seguimiento.sql').replace(/--.*$/gm, '');
  const sentencias = sinComentarios.split(';').map((s) => s.trim()).filter(Boolean);

  it('sólo crea sus dos tablas con IF NOT EXISTS: SIN SEMILLA (al desplegar nada cambia: todas apagadas), sin clave foránea y sin nada que cambie datos en un segundo arranque', () => {
    expect(sentencias.map((s) => /^CREATE TABLE IF NOT EXISTS (portal\.\w+) \(/.exec(s)?.[1])).toEqual(['portal.tmc_marcas', 'portal.tmc_marcas_cambios']);
    expect(sinComentarios).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|SELECT|TRIGGER)\b/i);
    expect(sinComentarios).not.toMatch(/\bREFERENCES\b|\bdesk\.|tmc_equipos|en_seguimiento/i);
    expect(sinComentarios).not.toMatch(/outbox|enviad|envio|cola|programad|destinatari|email/i);
  });

  it('la marca por su clave, si está incluida, con motivo y firma; y un apunte por cambio, con lo que hizo', () => {
    expect(sinComentarios).toMatch(/clave\s+VARCHAR\(60\)\s+PRIMARY KEY/);
    expect(sinComentarios).toMatch(/incluida\s+BOOLEAN\s+NOT NULL/);
    expect(sinComentarios).toMatch(/accion\s+VARCHAR\(8\)\s+NOT NULL CHECK \(accion IN \('incluir', 'excluir'\)\)/);
    expect(sinComentarios.match(/motivo\s+TEXT\s+NOT NULL CHECK \(btrim\(motivo\) <> ''\)/g)).toHaveLength(2);
    for (const c of [/equipos\s+INTEGER\s+NOT NULL/, /partidas\s+INTEGER\s+NOT NULL/, /enlazadas\s+INTEGER\s+NOT NULL/]) expect(sinComentarios).toMatch(c);
    expect(sinComentarios).not.toMatch(/cliente|\bserial\b/i);
  });

  it('está apuntada en MIGRATIONS, detrás de la 060, y es la última', () => {
    expect(fuente('../db.ts')).toMatch(/'060_trazabilidad_exportaciones\.sql',\s*'061_trazabilidad_marcas_seguimiento\.sql'\]/);
  });
});

describe('CANDADO: qué escribe incluir o excluir una marca (marcas-repo.ts)', () => {
  const src = readFileSync(fileURLToPath(new URL('./marcas-repo.ts', import.meta.url)), 'utf8');
  const escrituras = [...src.matchAll(/(INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE)\s+([a-z_.0-9]+)/g)].map((m) => `${m[1].replace(/\s+/g, ' ')} ${m[2]}`);

  it('su tabla, su apunte, y en las calibraciones sólo la partida y el enlace de una suelta: ni tmc_equipos, ni en_seguimiento, ni la congelación, ni borrar nada', () => {
    expect(escrituras.sort()).toEqual(['INSERT INTO portal.tmc_calibraciones', 'INSERT INTO portal.tmc_marcas', 'INSERT INTO portal.tmc_marcas_cambios', 'UPDATE portal.tmc_calibraciones']);
    expect(src).not.toMatch(/tmc_equipos|en_seguimiento|tmc_fst022|tmc_seguimiento|tmc_contactos/);
  });

  it('una fecha NO se edita: el UPDATE sólo pone la clave a una fila que no la tenía; la partida nace con origen fst022 y, si ya existe, no se duplica', () => {
    const update = /UPDATE portal\.tmc_calibraciones[^`]*/.exec(src)![0];
    expect(update).toMatch(/SET clave = x\.clave\s/);
    expect(update).toMatch(/AND c\.clave IS NULL/);
    expect(update).not.toMatch(/\bfecha\s*=|\bestado\s*=|\bserial\s*=|\borigen\s*=/);
    const insert = /INSERT INTO portal\.tmc_calibraciones[^`]*/.exec(src)![0];
    expect(insert).toMatch(/'fst022'/);
    expect(insert).toMatch(/ON CONFLICT \(clave\) WHERE origen = 'fst022' DO NOTHING/);
  });

  it('nada de esto avisa a nadie', () => {
    for (const f of ['./marcas.ts', './marcas-repo.ts', './inventario.ts']) expect(readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8'), f).not.toMatch(/\bfetch\s*\(|n8n|webhook|nodemailer|smtp|sendMail|outbox|setInterval|setTimeout/i);
  });
});
