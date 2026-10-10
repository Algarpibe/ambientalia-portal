import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  asignarClaves,
  asuntoSinCodigo,
  claveEstadoDesk,
  claveSerial,
  claveTipoServicio,
  diasDeTipo,
  diasEntre,
  esFechaIso,
  estadoCalibracion,
  estadoPlazo,
  etiquetaEstadoDesk,
  modeloDeCodigo,
  partesDeTipo,
  porOrdenEstadosDesk,
  sumarDias,
  tipoEfectivo,
  TIPOS_COMPUESTOS,
  ESTADOS_PLAZO,
  ESTADOS_PLAZO_TERMINADO,
  ETIQUETA_PLAZO,
  ETIQUETA_ROL,
  ROLES_ESTADO,
  ROL_POR_DEFECTO,
  esPlazoTerminado,
  esRolEstado,
  rolPausaReloj,
  veredictoTerminado,
} from './dominio.js';

describe('fechas', () => {
  it('valida fechas de calendario reales', () => {
    expect(esFechaIso('2026-10-06')).toBe(true);
    expect(esFechaIso('2026-02-30')).toBe(false);
    expect(esFechaIso('06/10/2026')).toBe(false);
    expect(esFechaIso(null)).toBe(false);
  });

  it('suma y resta días cruzando años bisiestos', () => {
    expect(sumarDias('2024-02-28', 1)).toBe('2024-02-29');
    expect(sumarDias('2025-10-17', 365)).toBe('2026-10-17');
    expect(diasEntre('2026-10-06', '2026-10-17')).toBe(11);
    expect(diasEntre('2026-10-06', '2026-09-03')).toBe(-33);
  });
});

describe('estadoCalibracion (regla de la F-ST-022: vigencia = última calibración − hoy + 365)', () => {
  const hoy = '2026-10-06';

  it('reproduce la columna «Vigencia de Calibración (Días)» de la hoja', () => {
    // 18A00006 (Cliente Cuatro), calibrado el 17/10/2025: la hoja da 12 días el 05/10;
    // hoy 06/10 son 11.
    expect(estadoCalibracion('2025-10-17', hoy)).toEqual({ vence: '2026-10-17', vigenciaDias: 11, estado: 'VENCE_30' });
  });

  it('clasifica en las franjas 30/60/90', () => {
    expect(estadoCalibracion(sumarDias(hoy, -365 + 30), hoy).estado).toBe('VENCE_30');
    expect(estadoCalibracion(sumarDias(hoy, -365 + 31), hoy).estado).toBe('VENCE_60');
    expect(estadoCalibracion(sumarDias(hoy, -365 + 60), hoy).estado).toBe('VENCE_60');
    expect(estadoCalibracion(sumarDias(hoy, -365 + 61), hoy).estado).toBe('VENCE_90');
    expect(estadoCalibracion(sumarDias(hoy, -365 + 90), hoy).estado).toBe('VENCE_90');
    expect(estadoCalibracion(sumarDias(hoy, -365 + 91), hoy).estado).toBe('AL_DIA');
  });

  it('vence hoy cuenta como «vence ≤ 30», no como vencida', () => {
    expect(estadoCalibracion(sumarDias(hoy, -365), hoy)).toMatchObject({ vigenciaDias: 0, estado: 'VENCE_30' });
    expect(estadoCalibracion(sumarDias(hoy, -366), hoy)).toMatchObject({ vigenciaDias: -1, estado: 'VENCIDA' });
  });

  it('vencida hace más de un año pasa a FUERA_CICLO (Estado = 1 en la hoja)', () => {
    expect(estadoCalibracion(sumarDias(hoy, -730), hoy)).toMatchObject({ vigenciaDias: -365, estado: 'VENCIDA' });
    expect(estadoCalibracion(sumarDias(hoy, -731), hoy)).toMatchObject({ vigenciaDias: -366, estado: 'FUERA_CICLO' });
  });

  it('sin fecha o con fecha inválida es SIN_FECHA', () => {
    expect(estadoCalibracion(null, hoy)).toEqual({ vence: null, vigenciaDias: null, estado: 'SIN_FECHA' });
    expect(estadoCalibracion('2026-13-01', hoy).estado).toBe('SIN_FECHA');
  });
});

describe('claves', () => {
  it('los seriales repetidos reciben sufijo en orden de aparición', () => {
    expect(asignarClaves(['18A00004', '18A00005', '18A00004', '18A00004'])).toEqual([
      '18A00004',
      '18A00005',
      '18A00004-2',
      '18A00004-3',
    ]);
    expect(claveSerial(' 18A 20/1 ')).toBe('18A_20_1');
  });
});

describe('servicios: tipo, modelo, cliente y estado del plazo', () => {
  it('el tipo de servicio casa sin mayúsculas, tildes ni espacios de más', () => {
    expect(claveTipoServicio('Diagnóstico')).toBe('diagnostico');
    expect(claveTipoServicio('Diagnostico')).toBe('diagnostico');
    expect(claveTipoServicio('diagnóstico')).toBe('diagnostico');
    expect(claveTipoServicio(' Calibración ')).toBe('calibracion');
    expect(claveTipoServicio('No   aplica')).toBe('no aplica');
    expect(claveTipoServicio('Garantía')).toBe('garantia');
    expect(claveTipoServicio(null)).toBe('');
    expect(claveTipoServicio('   ')).toBe('');
  });

  it('el modelo es el tercer tramo del código de servicio', () => {
    expect(modeloDeCodigo('MT_18A00001_EDM180C_261002')).toBe('EDM180C');
    expect(modeloDeCodigo('MT_18A00001')).toBe('');
    expect(modeloDeCodigo(null)).toBe('');
  });

  it('el asunto se queda sin el código de servicio', () => {
    expect(asuntoSinCodigo('Servicio Técnico Cliente Uno Monitor de Partículas MT_18A00001_EDM180C_260916', 'MT_18A00001_EDM180C_260916')).toBe(
      'Servicio Técnico Cliente Uno Monitor de Partículas',
    );
    // Sin código en su columna, se quita lo que tenga forma de código.
    expect(asuntoSinCodigo('Servicio Técnico Cliente Dos  MT_18A00002_EDM180D_260101 ', null)).toBe('Servicio Técnico Cliente Dos');
    expect(asuntoSinCodigo('Consulta de Cliente Tres', '')).toBe('Consulta de Cliente Tres');
    expect(asuntoSinCodigo(null, null)).toBe('');
  });

  it('estado del plazo: en plazo, vence hoy, vencido o sin plazo', () => {
    expect(estadoPlazo('2026-10-08', '2026-10-06')).toBe('EN_PLAZO');
    expect(estadoPlazo('2026-10-06', '2026-10-06')).toBe('VENCE_HOY');
    expect(estadoPlazo('2026-10-05', '2026-10-06')).toBe('VENCIDO');
    expect(estadoPlazo(null, '2026-10-06')).toBe('SIN_PLAZO');
  });

  it('tipo efectivo: el puesto a mano gana al de Desk; sin él, el de Desk; sin ninguno, vacío', () => {
    expect(tipoEfectivo('Calibración', 'Diagnóstico')).toEqual({ tipo: 'Calibración', origen: 'manual' });
    expect(tipoEfectivo('Calibración', '')).toEqual({ tipo: 'Calibración', origen: 'manual' });
    expect(tipoEfectivo(null, '  Diagnóstico ')).toEqual({ tipo: 'Diagnóstico', origen: 'desk' });
    expect(tipoEfectivo('   ', 'Diagnóstico')).toEqual({ tipo: 'Diagnóstico', origen: 'desk' });
    expect(tipoEfectivo(null, null)).toEqual({ tipo: '', origen: null });
    expect(tipoEfectivo(undefined, '  ')).toEqual({ tipo: '', origen: null });
  });
});

describe('tipo compuesto «Diagnóstico + Calibración»', () => {
  const COMBINADO = claveTipoServicio('Diagnóstico + Calibración');

  it('la composición vive en un solo sitio, con claves ya normalizadas', () => {
    expect(COMBINADO).toBe('diagnostico + calibracion');
    expect(TIPOS_COMPUESTOS).toEqual({ 'diagnostico + calibracion': ['diagnostico', 'calibracion'] });
    for (const [clave, partes] of Object.entries(TIPOS_COMPUESTOS)) {
      expect(clave).toBe(claveTipoServicio(clave));
      expect(partes.length).toBeGreaterThanOrEqual(2);
      for (const p of partes) {
        expect(p).toBe(claveTipoServicio(p));
        // Una parte no puede ser a su vez un compuesto: la suma es de un solo nivel.
        expect(partesDeTipo(p)).toBeNull();
      }
    }
  });

  it('partesDeTipo: las partes de un compuesto, y null para un tipo simple o vacío', () => {
    expect(partesDeTipo(COMBINADO)).toEqual(['diagnostico', 'calibracion']);
    expect(partesDeTipo('diagnostico')).toBeNull();
    expect(partesDeTipo('')).toBeNull();
    // Nada heredado de Object.prototype se cuela como compuesto.
    expect(partesDeTipo('constructor')).toBeNull();
    expect(partesDeTipo('toString')).toBeNull();
  });

  it('sus días son la suma de los de sus partes', () => {
    const dias = new Map<string, number | null>([['diagnostico', 3], ['calibracion', 4]]);
    expect(diasDeTipo(COMBINADO, dias)).toBe(7);
  });

  it('cambiar una parte cambia el compuesto, sin tocar nada más', () => {
    const dias = new Map<string, number | null>([['diagnostico', 3], ['calibracion', 4]]);
    dias.set('diagnostico', 5);
    expect(diasDeTipo(COMBINADO, dias)).toBe(9);
  });

  it('si a una parte le falta el plazo (o la fila), el compuesto no tiene plazo', () => {
    expect(diasDeTipo(COMBINADO, new Map<string, number | null>([['diagnostico', 3], ['calibracion', null]]))).toBeNull();
    expect(diasDeTipo(COMBINADO, new Map<string, number | null>([['calibracion', 4]]))).toBeNull();
    expect(diasDeTipo(COMBINADO, new Map())).toBeNull();
  });

  it('es derivado: lo que hubiera guardado en su propia fila no cuenta', () => {
    const dias = new Map<string, number | null>([['diagnostico', 3], ['calibracion', 4], [COMBINADO, 99]]);
    expect(diasDeTipo(COMBINADO, dias)).toBe(7);
  });

  it('un tipo simple conserva los suyos, y uno desconocido o vacío no tiene', () => {
    const dias = new Map<string, number | null>([['diagnostico', 3], ['garantia', null]]);
    expect(diasDeTipo('diagnostico', dias)).toBe(3);
    expect(diasDeTipo('garantia', dias)).toBeNull();
    expect(diasDeTipo('instalacion', dias)).toBeNull();
    expect(diasDeTipo('', dias)).toBeNull();
  });
});

describe('estados de Zoho Desk (standby)', () => {
  it('la clave casa sin mayúsculas, tildes ni espacios repetidos o sobrantes', () => {
    expect(claveEstadoDesk('Notificación  Comercial')).toBe('notificacion comercial');
    expect(claveEstadoDesk('Notificación Comercial')).toBe('notificacion comercial');
    expect(claveEstadoDesk('  NOTIFICACION\tcomercial ')).toBe('notificacion comercial');
    expect(claveEstadoDesk('Rev./Diagnostico')).toBe('rev./diagnostico');
    expect(claveEstadoDesk('En Espera de Repuestos')).toBe(claveEstadoDesk('en espera de repuestos '));
    expect(claveEstadoDesk(null)).toBe('');
    expect(claveEstadoDesk('   ')).toBe('');
  });

  it('es la misma normalización que la de los tipos de servicio', () => {
    for (const s of ['Notificación  Comercial', ' Por Facturar', 'OV asignada', '']) expect(claveEstadoDesk(s)).toBe(claveTipoServicio(s));
  });

  it('la etiqueta conserva mayúsculas y tildes; sólo se queda sin espacios de más', () => {
    expect(etiquetaEstadoDesk('  Notificación  Comercial ')).toBe('Notificación Comercial');
    expect(etiquetaEstadoDesk('Por Facturar')).toBe('Por Facturar');
    expect(etiquetaEstadoDesk(null)).toBe('');
  });

  it('orden: abiertos, en espera, cerrados y sin tipo; dentro, más tickets abiertos primero y después alfabético', () => {
    const e = (etiqueta: string, tipoDesk: string | null, ticketsAbiertos: number) => ({ etiqueta, tipoDesk, ticketsAbiertos });
    const lista = [
      e('Finalizado', 'Closed', 0),
      e('Sin tickets', null, 0),
      e('Servicio externo', 'On Hold', 1),
      e('Por Facturar', 'On Hold', 4),
      e('Ingresado', 'Open', 2),
      e('En Proceso', 'Open', 2),
      e('Por Entregar', 'Open', 5),
      e('Árbol', 'Open', 2),
    ];
    expect([...lista].sort(porOrdenEstadosDesk).map((x) => x.etiqueta)).toEqual([
      'Por Entregar',
      'Árbol',
      'En Proceso',
      'Ingresado',
      'Por Facturar',
      'Servicio externo',
      'Finalizado',
      'Sin tickets',
    ]);
  });
});

describe('rol de un estado de Desk y estados del plazo', () => {
  it('hay tres roles, excluyentes, y «cuenta» es el de partida', () => {
    expect([...ROLES_ESTADO]).toEqual(['cuenta', 'standby', 'terminado']);
    expect(ROL_POR_DEFECTO).toBe('cuenta');
    expect(ETIQUETA_ROL).toEqual({ cuenta: 'Cuenta', standby: 'Standby', terminado: 'Trabajo terminado' });
  });

  it('esRolEstado sólo acepta esos tres textos, tal cual', () => {
    for (const r of ROLES_ESTADO) expect(esRolEstado(r)).toBe(true);
    for (const v of ['Standby', ' standby', 'pausa', '', null, undefined, true, 1, ['standby'], {}, 'constructor', 'toString']) expect(esRolEstado(v)).toBe(false);
  });

  it('pausan el reloj standby y terminado; cuenta, no', () => {
    expect(ROLES_ESTADO.filter(rolPausaReloj)).toEqual(['standby', 'terminado']);
  });

  it('el plazo gana tres estados para el trabajo terminado, todos con etiqueta y detrás de los que siguen en marcha', () => {
    expect([...ESTADOS_PLAZO]).toEqual(['VENCIDO', 'VENCE_HOY', 'EN_PLAZO', 'SIN_PLAZO', 'INCUMPLIDO', 'CUMPLIDO', 'TERMINADO']);
    expect([...ESTADOS_PLAZO_TERMINADO]).toEqual(['INCUMPLIDO', 'CUMPLIDO', 'TERMINADO']);
    expect(Object.keys(ETIQUETA_PLAZO).sort()).toEqual([...ESTADOS_PLAZO].sort());
    expect(ETIQUETA_PLAZO).toMatchObject({ CUMPLIDO: 'Cumplido', INCUMPLIDO: 'Incumplido', TERMINADO: 'Terminado' });
    for (const e of ESTADOS_PLAZO) expect(esPlazoTerminado(e)).toBe(ESTADOS_PLAZO_TERMINADO.includes(e));
  });

  it('veredicto del trabajo terminado: a tiempo, tarde o sin poder medirlo', () => {
    expect(veredictoTerminado('2026-10-07', '2026-10-08', true)).toBe('CUMPLIDO');
    expect(veredictoTerminado('2026-10-08', '2026-10-08', true)).toBe('CUMPLIDO');
    expect(veredictoTerminado('2026-10-09', '2026-10-08', true)).toBe('INCUMPLIDO');
    // No se vio el cambio: se sabe que está terminado, no desde cuándo.
    expect(veredictoTerminado('2026-10-07', '2026-10-08', false)).toBe('TERMINADO');
    expect(veredictoTerminado('2026-10-09', '2026-10-08', false)).toBe('TERMINADO');
    // Sin fecha límite no hay nada con lo que comparar.
    expect(veredictoTerminado('2026-10-07', null, true)).toBe('SIN_PLAZO');
  });

  it('estadoPlazo sigue clasificando sólo lo que está en marcha', () => {
    expect(['VENCIDO', 'VENCE_HOY', 'EN_PLAZO', 'SIN_PLAZO']).toContain(estadoPlazo('2026-10-08', '2026-10-06'));
  });
});

describe('pureza', () => {
  it('dominio.ts no importa nada (lo consume también la app del portal)', () => {
    const src = readFileSync(fileURLToPath(new URL('./dominio.ts', import.meta.url)), 'utf8');
    expect(src).not.toMatch(/^\s*import\s/m);
  });
});
