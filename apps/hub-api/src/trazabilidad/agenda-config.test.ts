import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CATALOGO_ESTADOS_AGENDA,
  CATEGORIAS_AGENDA,
  ETAPAS_AGENDA,
  ETIQUETA_CATEGORIA,
  ETIQUETA_ETAPA,
  PUESTOS_MAX,
  PLAZO_MAX_DIAS,
  PLAZO_MIN_DIAS,
  TIPO_POR_DEFECTO,
  categoriaCoherente,
  categoriaDeEstado,
  claveEstadoDesk,
  duracionDeEtapa,
  esCategoriaAgenda,
  esEtapaAgenda,
  etapaInicial,
  flujoDeTicket,
  tiposDeTickets,
  type CategoriaEstado,
  type DuracionEtapa,
} from './dominio.js';
import { esHabilAgenda, sumarDiasHabilesAgenda } from './agenda-calendario.js';
import { sumarDiasHabiles } from './plazos.js';

// Lote 2 de la agenda del taller: las reglas de la configuración (categoría y
// etapa de cada estado, flujo, etapa inicial, duración y calendario), sin base
// de datos, y las guardas de las migraciones 050 y 051. Datos ficticios.

describe('categoría y etapa de un estado', () => {
  it('las seis categorías y las tres etapas, cada una con su etiqueta', () => {
    expect([...CATEGORIAS_AGENDA]).toEqual(['por_llegar', 'entrada', 'activa', 'standby', 'fin', 'fuera']);
    expect([...ETAPAS_AGENDA]).toEqual(['diagnostico', 'proceso', 'verificacion']);
    for (const c of CATEGORIAS_AGENDA) expect(ETIQUETA_CATEGORIA[c]).toBeTruthy();
    expect(ETAPAS_AGENDA.map((e) => ETIQUETA_ETAPA[e])).toEqual(['Diagnóstico', 'Proceso', 'Verificación']);
    expect(esCategoriaAgenda('activa')).toBe(true);
    expect(esCategoriaAgenda('Activa')).toBe(false);
    expect(esEtapaAgenda('proceso')).toBe(true);
    expect(esEtapaAgenda('')).toBe(false);
  });

  it('sólo una etapa activa lleva etapa, y la lleva siempre', () => {
    expect(categoriaCoherente('activa', 'proceso')).toBe(true);
    expect(categoriaCoherente('activa', null)).toBe(false);
    expect(categoriaCoherente('standby', null)).toBe(true);
    expect(categoriaCoherente('standby', 'proceso')).toBe(false);
    expect(categoriaCoherente('fuera', null)).toBe(true);
  });

  it('el catálogo es la propuesta de la sección C: 23 estados, coherentes y sin repetir', () => {
    expect(CATALOGO_ESTADOS_AGENDA).toHaveLength(23);
    expect(new Set(CATALOGO_ESTADOS_AGENDA.map((e) => claveEstadoDesk(e.estado))).size).toBe(23);
    for (const e of CATALOGO_ESTADOS_AGENDA) expect(categoriaCoherente(e.categoria, e.etapa)).toBe(true);
  });

  it.each([
    ['OV asignada', 'por_llegar', null],
    ['Ticket creado', 'por_llegar', null],
    ['Remisión creada', 'entrada', null],
    ['Ingresado', 'entrada', null],
    ['Rev./Diagnostico', 'activa', 'diagnostico'],
    // D2: «Notificado» sigue ocupando el puesto, dentro de Diagnóstico.
    ['Notificado', 'activa', 'diagnostico'],
    ['En Proceso', 'activa', 'proceso'],
    ['Continuación del proceso', 'activa', 'proceso'],
    ['Verificación', 'activa', 'verificacion'],
    ['Notificación a Compras', 'standby', null],
    ['Notificación Comercial', 'standby', null],
    ['Notificación cliente', 'standby', null],
    ['En espera de SKU inventario', 'standby', null],
    ['En Espera de Repuestos', 'standby', null],
    ['Solicitado', 'standby', null],
    ['Servicio externo', 'standby', null],
    ['Por Facturar', 'fin', null],
    ['Liberación Comercial', 'fin', null],
    ['Por Entregar', 'fin', null],
    ['Por Entregar / Sin facturar', 'fin', null],
    ['Finalizado', 'fin', null],
    // D10: el soporte remoto queda fuera.
    ['Pendiente', 'fuera', null],
    ['Solicitud Soporte', 'fuera', null],
  ])('«%s» → %s / %s', (estado, categoria, etapa) => {
    expect(categoriaDeEstado(estado)).toEqual({ categoria, etapa });
  });

  it('casa por la clave del estado: mayúsculas, tildes y espacios de más no cuentan', () => {
    expect(categoriaDeEstado('  notificacion   COMERCIAL ')).toEqual({ categoria: 'standby', etapa: null });
    expect(categoriaDeEstado('REV./DIAGNÓSTICO')).toEqual({ categoria: 'activa', etapa: 'diagnostico' });
  });

  it('un estado que no está en el catálogo, o ninguno, queda sin categoría', () => {
    expect(categoriaDeEstado('Estado inventado')).toBeNull();
    expect(categoriaDeEstado('')).toBeNull();
    expect(categoriaDeEstado(null)).toBeNull();
  });

  it('lo guardado gana al catálogo, también para un estado que el catálogo no conoce', () => {
    const guardadas = new Map<string, CategoriaEstado>([
      ['ingresado', { categoria: 'fuera', etapa: null }],
      ['estado inventado', { categoria: 'activa', etapa: 'verificacion' }],
    ]);
    expect(categoriaDeEstado('Ingresado', guardadas)).toEqual({ categoria: 'fuera', etapa: null });
    expect(categoriaDeEstado(' ESTADO  inventado', guardadas)).toEqual({ categoria: 'activa', etapa: 'verificacion' });
    expect(categoriaDeEstado('En Proceso', guardadas)).toEqual({ categoria: 'activa', etapa: 'proceso' });
  });
});

describe('flujo del ticket (D11)', () => {
  const t = (extra: Partial<Parameters<typeof flujoDeTicket>[0]>) => flujoDeTicket({ fuente: 'principal', clasificacion: null, asunto: null, codigoServicio: null, ...extra });

  it('fuente principal: manda `classification`, con cualquier grafía', () => {
    expect(t({ clasificacion: 'Equipo Nuevo' })).toEqual({ flujo: 'equipo_nuevo', deducido: false });
    expect(t({ clasificacion: '  equipo   NUEVO ' })).toEqual({ flujo: 'equipo_nuevo', deducido: false });
    expect(t({ clasificacion: 'Equipo Para Servicio' })).toEqual({ flujo: 'servicio', deducido: false });
    expect(t({ clasificacion: 'Equipo para servicio de mantenimiento' })).toEqual({ flujo: 'servicio', deducido: false });
  });

  it('fuente principal sin clasificación: servicio, sin deducir nada del asunto ni del código', () => {
    expect(t({})).toEqual({ flujo: 'servicio', deducido: false });
    expect(t({ asunto: 'Equipo Nuevo Cliente Uno', codigoServicio: 'HV_18A00001_EDM180C' })).toEqual({ flujo: 'servicio', deducido: false });
  });

  it('respaldo sin clasificación: se deduce del asunto que empieza por «Equipo Nuevo»', () => {
    expect(t({ fuente: 'respaldo', asunto: 'Equipo Nuevo - Cliente Uno' })).toEqual({ flujo: 'equipo_nuevo', deducido: true });
    expect(t({ fuente: 'respaldo', asunto: '  EQUIPO  nuevo Cliente Uno' })).toEqual({ flujo: 'equipo_nuevo', deducido: true });
    expect(t({ fuente: 'respaldo', asunto: 'Cliente Uno pide equipo nuevo' })).toEqual({ flujo: 'servicio', deducido: true });
  });

  it('respaldo sin clasificación: o del prefijo HV_ del código de servicio', () => {
    expect(t({ fuente: 'respaldo', asunto: 'Cliente Uno', codigoServicio: 'HV_18A00001_EDM180C_261002' })).toEqual({ flujo: 'equipo_nuevo', deducido: true });
    expect(t({ fuente: 'respaldo', codigoServicio: ' hv_18A00001' })).toEqual({ flujo: 'equipo_nuevo', deducido: true });
    expect(t({ fuente: 'respaldo', codigoServicio: 'MT_18A00001_EDM180C_261002' })).toEqual({ flujo: 'servicio', deducido: true });
    expect(t({ fuente: 'respaldo', codigoServicio: 'MT_HV_18A00001' })).toEqual({ flujo: 'servicio', deducido: true });
    expect(t({ fuente: 'respaldo' })).toEqual({ flujo: 'servicio', deducido: true });
  });

  it('respaldo con clasificación (si la réplica la trae): manda ella y no se deduce', () => {
    expect(t({ fuente: 'respaldo', clasificacion: 'Equipo Para Servicio', asunto: 'Equipo Nuevo Cliente Uno', codigoServicio: 'HV_18A00001' })).toEqual({ flujo: 'servicio', deducido: false });
    expect(t({ fuente: 'respaldo', clasificacion: 'Equipo Nuevo', asunto: 'Cliente Uno' })).toEqual({ flujo: 'equipo_nuevo', deducido: false });
  });
});

describe('etapa inicial según el flujo', () => {
  it('servicio empieza en Diagnóstico y equipo nuevo en Proceso', () => {
    expect(etapaInicial('servicio')).toBe('diagnostico');
    expect(etapaInicial('equipo_nuevo')).toBe('proceso');
  });
});

describe('duración de una etapa para un tipo (D9)', () => {
  const duraciones: DuracionEtapa[] = [
    { etapa: 'diagnostico', tipo: TIPO_POR_DEFECTO, dias: 3 },
    { etapa: 'diagnostico', tipo: 'calibracion', dias: 2 },
    { etapa: 'proceso', tipo: TIPO_POR_DEFECTO, dias: 4 },
    { etapa: 'proceso', tipo: 'mantenimiento', dias: 6 },
  ];

  it('la fila por defecto es «*»', () => {
    expect(TIPO_POR_DEFECTO).toBe('*');
  });

  it('la fila exacta del tipo gana a la «*»; el tipo casa por su clave', () => {
    expect(duracionDeEtapa(duraciones, 'diagnostico', null, ' Calibración ')).toEqual({ dias: 2, origen: 'tipo', tipo: 'calibracion', sinTipo: false });
  });

  it('un tipo sin fila propia usa la «*» de la etapa', () => {
    expect(duracionDeEtapa(duraciones, 'proceso', null, 'Calibración')).toEqual({ dias: 4, origen: 'defecto', tipo: 'calibracion', sinTipo: false });
  });

  it('el tipo puesto a mano gana al de la fuente', () => {
    expect(duracionDeEtapa(duraciones, 'proceso', 'Mantenimiento', 'Calibración')).toEqual({ dias: 6, origen: 'tipo', tipo: 'mantenimiento', sinTipo: false });
    expect(duracionDeEtapa(duraciones, 'diagnostico', 'Mantenimiento', 'Calibración')).toEqual({ dias: 3, origen: 'defecto', tipo: 'mantenimiento', sinTipo: false });
  });

  it('sin tipo: la «*», con la marca «sin tipo»', () => {
    expect(duracionDeEtapa(duraciones, 'diagnostico', null, null)).toEqual({ dias: 3, origen: 'defecto', tipo: '', sinTipo: true });
    expect(duracionDeEtapa(duraciones, 'diagnostico', '  ', '')).toEqual({ dias: 3, origen: 'defecto', tipo: '', sinTipo: true });
  });

  it('sin fila exacta ni «*»: sin duración', () => {
    expect(duracionDeEtapa(duraciones, 'verificacion', null, 'Calibración')).toEqual({ dias: null, origen: null, tipo: 'calibracion', sinTipo: false });
    expect(duracionDeEtapa([], 'diagnostico', null, null)).toEqual({ dias: null, origen: null, tipo: '', sinTipo: true });
  });

  it('un tipo llamado «*» no existe: nadie se cuela en la fila por defecto como si fuera exacta', () => {
    expect(duracionDeEtapa(duraciones, 'diagnostico', null, '*')).toEqual({ dias: 3, origen: 'defecto', tipo: '*', sinTipo: false });
  });
});

describe('tipos de servicio que traen los tickets abiertos (columnas de la tabla de duraciones)', () => {
  const t = (numero: number, tipoServicio: string | null) => ({ numero, tipoServicio });

  it('uno por clave, con la grafía del ticket más antiguo y cuántos lo traen, por orden alfabético', () => {
    expect(tiposDeTickets([t(2030, 'mantenimiento'), t(2010, ' Diagnostico '), t(2020, 'Mantenimiento'), t(2040, 'diagnóstico'), t(2050, 'Diagnostico')])).toEqual([
      { clave: 'diagnostico', etiqueta: 'Diagnostico', tickets: 3 },
      { clave: 'mantenimiento', etiqueta: 'Mantenimiento', tickets: 2 },
    ]);
  });

  it('sin tipo no cuenta, y un tipo llamado «*» tampoco: es la fila por defecto', () => {
    expect(tiposDeTickets([t(1, null), t(2, '   '), t(3, '*')])).toEqual([]);
    expect(tiposDeTickets([])).toEqual([]);
  });
});

describe('calendario de la agenda (D3)', () => {
  // Octubre de 2026: el lunes 12 es festivo; el 10 y el 11 son fin de semana.
  const SIN_CIERRES = new Set<string>();

  it('sin cierres es el calendario de los plazos: lunes a viernes sin festivos', () => {
    expect(esHabilAgenda('2026-10-09', SIN_CIERRES)).toBe(true);
    expect(esHabilAgenda('2026-10-10', SIN_CIERRES)).toBe(false);
    expect(esHabilAgenda('2026-10-12', SIN_CIERRES)).toBe(false);
    for (const [desde, n] of [['2026-10-05', 3], ['2026-10-06', 4], ['2026-10-09', 3], ['2026-12-30', 2]] as const) {
      expect(sumarDiasHabilesAgenda(desde, n, SIN_CIERRES)).toBe(sumarDiasHabiles(desde, n));
    }
  });

  it('un cierre de empresa no es hábil y corre la cuenta', () => {
    const cierres = new Set(['2026-10-08']);
    expect(esHabilAgenda('2026-10-08', cierres)).toBe(false);
    expect(esHabilAgenda('2026-10-07', cierres)).toBe(true);
    // Martes 6 + 3: mié 7, (jue 8 cerrado), vie 9, (fin de semana y festivo), mar 13.
    expect(sumarDiasHabilesAgenda('2026-10-06', 3, cierres)).toBe('2026-10-13');
    expect(sumarDiasHabiles('2026-10-06', 3)).toBe('2026-10-09');
  });

  it('un cierre que cae en fin de semana o festivo no cambia nada', () => {
    const cierres = new Set(['2026-10-10', '2026-10-12']);
    expect(sumarDiasHabilesAgenda('2026-10-06', 4, cierres)).toBe(sumarDiasHabiles('2026-10-06', 4));
  });

  it('el día de partida no cuenta, y con cero días se queda donde está', () => {
    expect(sumarDiasHabilesAgenda('2026-10-08', 1, new Set(['2026-10-08']))).toBe('2026-10-09');
    expect(sumarDiasHabilesAgenda('2026-10-08', 0, SIN_CIERRES)).toBe('2026-10-08');
  });
});

// ── Guardas de las migraciones ──────────────────────────────────────────────
// Las dos se vuelven a ejecutar en cada arranque: tienen que poder repetirse
// sin fallar y sin llevarse por delante lo que alguien haya elegido.

const leer = (fichero: string) => readFileSync(fileURLToPath(new URL(`../users/migrations/${fichero}`, import.meta.url)), 'utf8');
const lista = (s: string) => s.split(',').map((x) => x.trim().replace(/'/g, ''));

describe('050_trazabilidad_estados_categoria.sql', () => {
  const SQL = leer('050_trazabilidad_estados_categoria.sql');
  const sinComentarios = SQL.replace(/--.*$/gm, '');
  const semilla = [...sinComentarios.matchAll(/\('([^']+)',\s*'([^']+)',\s*'([a-z_]+)',\s*(NULL|'[a-z]+')\)/g)].map((m) => ({
    clave: m[1],
    estado: m[2],
    categoria: m[3],
    etapa: m[4] === 'NULL' ? null : m[4].replace(/'/g, ''),
  }));

  it('extiende la tabla sin crear otra: dos columnas con ADD COLUMN IF NOT EXISTS, que admiten NULL', () => {
    expect(sinComentarios).toMatch(/ALTER TABLE portal\.tmc_estados_desk\s+ADD COLUMN IF NOT EXISTS categoria\s+VARCHAR\(\d+\)\s+NULL/i);
    expect(sinComentarios).toMatch(/ALTER TABLE portal\.tmc_estados_desk\s+ADD COLUMN IF NOT EXISTS etapa\s+VARCHAR\(\d+\)\s+NULL/i);
    expect(sinComentarios).not.toMatch(/CREATE TABLE/i);
    for (const m of sinComentarios.matchAll(/ADD COLUMN\b(?! IF NOT EXISTS)/gi)) expect(m).toBeNull();
  });

  it('la categoría lleva su propia firma, aparte de la del papel del reloj: tres columnas más, que admiten NULL', () => {
    expect(sinComentarios).toMatch(/ADD COLUMN IF NOT EXISTS categoria_por_id\s+UUID\s+NULL/i);
    expect(sinComentarios).toMatch(/ADD COLUMN IF NOT EXISTS categoria_por\s+VARCHAR\(254\)\s+NULL/i);
    expect(sinComentarios).toMatch(/ADD COLUMN IF NOT EXISTS categoria_en\s+TIMESTAMPTZ\s+NULL/i);
    expect(sinComentarios.match(/ADD COLUMN IF NOT EXISTS/gi)).toHaveLength(5);
  });

  it('la firma del papel deja de ser obligatoria (una fila sembrada no la tiene), y es lo único que se le hace a esas columnas', () => {
    expect(sinComentarios).toMatch(/ALTER COLUMN actualizado_por DROP NOT NULL/i);
    expect(sinComentarios).toMatch(/ALTER COLUMN actualizado_en DROP NOT NULL/i);
    expect(sinComentarios.match(/ALTER COLUMN/gi)).toHaveLength(2);
    // Fuera de eso sólo salen en la lista de columnas del INSERT (para dejarlas vacías en una fila nueva): nunca en un SET.
    const set = /DO UPDATE\s+SET([\s\S]*?)WHERE/i.exec(sinComentarios)![1];
    expect(set).not.toMatch(/actualizado_/);
    expect(sinComentarios.match(/actualizado_\w+/g)).toEqual(['actualizado_por', 'actualizado_en', 'actualizado_por', 'actualizado_en']);
    expect(sinComentarios).toMatch(/'semilla \(migracion 050\)', NOW\(\), NULL::varchar, NULL::timestamptz/);
  });

  it('los CHECK llevan los valores del dominio y sólo se añaden si faltan', () => {
    const cat = /CHECK \(categoria IN \(([^)]*)\)\)/i.exec(sinComentarios);
    const eta = /CHECK \(etapa IN \(([^)]*)\)\)/i.exec(sinComentarios);
    expect(lista(cat![1])).toEqual([...CATEGORIAS_AGENDA]);
    expect(lista(eta![1])).toEqual([...ETAPAS_AGENDA]);
    expect(sinComentarios).toMatch(/CHECK \(\(categoria IS NOT DISTINCT FROM 'activa'\) = \(etapa IS NOT NULL\)\)/i);
    const añadidos = [...sinComentarios.matchAll(/ADD CONSTRAINT (\w+)/gi)].map((m) => m[1]);
    expect(añadidos).toHaveLength(3);
    for (const nombre of añadidos) expect(sinComentarios).toMatch(new RegExp(`IF NOT EXISTS \\(SELECT 1 FROM pg_constraint WHERE conname = '${nombre}'`));
  });

  it('la semilla es el catálogo del dominio, estado por estado, con la clave normalizada', () => {
    expect(semilla.map(({ estado, categoria, etapa }) => ({ estado, categoria, etapa }))).toEqual(CATALOGO_ESTADOS_AGENDA.map((e) => ({ ...e })));
    for (const s of semilla) expect(s.clave).toBe(claveEstadoDesk(s.estado));
  });

  it('la semilla sólo rellena donde no hay categoría, y nunca nombra el papel del reloj', () => {
    expect(sinComentarios).toMatch(/INSERT INTO portal\.tmc_estados_desk AS e \(clave, etiqueta, categoria, etapa, categoria_por, categoria_en, actualizado_por, actualizado_en\)\s+SELECT/);
    expect(sinComentarios).toMatch(
      /ON CONFLICT \(clave\) DO UPDATE\s+SET categoria = EXCLUDED\.categoria, etapa = EXCLUDED\.etapa,\s+categoria_por = EXCLUDED\.categoria_por, categoria_en = EXCLUDED\.categoria_en\s+WHERE e\.categoria IS NULL;\s*$/i,
    );
    // «standby» es también una categoría: lo que no puede salir es la columna del papel.
    expect(sinComentarios).not.toMatch(/\brol\b/i);
    expect(sinComentarios.match(/\bUPDATE\b/gi)).toHaveLength(1);
    expect(sinComentarios.replace(/DROP NOT NULL/gi, '')).not.toMatch(/\b(DELETE|DROP|TRUNCATE)\b/i);
  });

  it('no toca el esquema desk ni le pone una clave foránea', () => {
    expect(SQL).not.toMatch(/\bdesk\./);
    expect(SQL).not.toMatch(/\bREFERENCES\b/i);
  });

  it('está apuntada en MIGRATIONS, detrás de la 049', () => {
    const db = readFileSync(fileURLToPath(new URL('../db.ts', import.meta.url)), 'utf8');
    expect(db).toMatch(/'049_trazabilidad_roles\.sql',\s*'050_trazabilidad_estados_categoria\.sql'/);
  });
});

describe('051_trazabilidad_agenda_config.sql', () => {
  const SQL = leer('051_trazabilidad_agenda_config.sql');
  const sinComentarios = SQL.replace(/--.*$/gm, '');
  const sentencias = sinComentarios
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

  it('sólo crea con IF NOT EXISTS y siembra con ON CONFLICT DO NOTHING', () => {
    expect(sentencias).toHaveLength(5);
    for (const s of sentencias) expect(s).toMatch(/^(CREATE (SCHEMA|TABLE) IF NOT EXISTS |INSERT INTO portal\.tmc_agenda_(etapas|duraciones) )/);
    for (const s of sentencias.filter((x) => x.startsWith('INSERT'))) expect(s).toMatch(/ON CONFLICT \([a-z, ]+\) DO NOTHING$/);
    expect(sinComentarios).not.toMatch(/\b(UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i);
  });

  it('las etapas son las del dominio, en las dos tablas, y los topes son los del dominio', () => {
    const checks = [...sinComentarios.matchAll(/CHECK \(etapa IN \(([^)]*)\)\)/gi)].map((m) => lista(m[1]));
    expect(checks).toEqual([[...ETAPAS_AGENDA], [...ETAPAS_AGENDA]]);
    expect(sinComentarios).toMatch(new RegExp(`CHECK \\(puestos BETWEEN 0 AND ${PUESTOS_MAX}\\)`));
    expect(sinComentarios).toMatch(new RegExp(`CHECK \\(dias_habiles BETWEEN ${PLAZO_MIN_DIAS} AND ${PLAZO_MAX_DIAS}\\)`));
    expect(sinComentarios).toMatch(/PRIMARY KEY \(etapa, tipo\)/);
  });

  it('siembra los puestos de ejemplo: Diagnóstico 3, Proceso 4 y Verificación 2, con la etiqueta y el orden del dominio', () => {
    const filas = [...sinComentarios.matchAll(/\('([a-z]+)',\s*'([^']+)',\s*(\d+),\s*(\d+)\)/g)].map((m) => ({ etapa: m[1], etiqueta: m[2], orden: Number(m[3]), puestos: Number(m[4]) }));
    expect(filas).toEqual([
      { etapa: 'diagnostico', etiqueta: 'Diagnóstico', orden: 1, puestos: 3 },
      { etapa: 'proceso', etiqueta: 'Proceso', orden: 2, puestos: 4 },
      { etapa: 'verificacion', etiqueta: 'Verificación', orden: 3, puestos: 2 },
    ]);
    filas.forEach((f, i) => {
      expect(f.etapa).toBe(ETAPAS_AGENDA[i]);
      expect(f.etiqueta).toBe(ETIQUETA_ETAPA[ETAPAS_AGENDA[i]]);
    });
  });

  it('siembra sólo la duración por defecto («*») de cada etapa: 3, 4 y 1 días', () => {
    const filas = [...sinComentarios.matchAll(/\('([a-z]+)',\s*'([^']+)',\s*(\d+)\)/g)].map((m) => ({ etapa: m[1], tipo: m[2], dias: Number(m[3]) }));
    expect(filas).toEqual([
      { etapa: 'diagnostico', tipo: TIPO_POR_DEFECTO, dias: 3 },
      { etapa: 'proceso', tipo: TIPO_POR_DEFECTO, dias: 4 },
      { etapa: 'verificacion', tipo: TIPO_POR_DEFECTO, dias: 1 },
    ]);
  });

  it('firmada como el resto, sin tocar el esquema desk ni poner claves foráneas, y sin nada de envíos', () => {
    expect(sinComentarios.match(/actualizado_por_id\s+UUID\s+NULL/gi)).toHaveLength(2);
    expect(sinComentarios.match(/actualizado_por\s+VARCHAR\(254\)\s+NULL/gi)).toHaveLength(2);
    expect(sinComentarios.match(/actualizado_en\s+TIMESTAMPTZ\s+NULL/gi)).toHaveLength(2);
    expect(SQL).not.toMatch(/\bdesk\./);
    expect(SQL).not.toMatch(/\bREFERENCES\b/i);
    expect(sinComentarios).not.toMatch(/outbox|enviad|envio|cola|programad/i);
  });

  // La guarda de cuál es la ÚLTIMA migración apuntada está en agenda-asignaciones.test.ts (la 053).
  it('está apuntada en MIGRATIONS, detrás de la 050', () => {
    const db = readFileSync(fileURLToPath(new URL('../db.ts', import.meta.url)), 'utf8');
    expect(db).toMatch(/'050_trazabilidad_estados_categoria\.sql',\s*'051_trazabilidad_agenda_config\.sql'/);
  });
});
