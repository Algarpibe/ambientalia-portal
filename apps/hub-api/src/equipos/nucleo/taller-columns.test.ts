import { describe, expect, it } from 'vitest';
import { COLUMNAS_TALLER, ESTADOS_CERRADOS, ESTADOS_DESK, ESTADOS_ESPERA_REPUESTOS, claveEstado, columnaDeEstado, type ColumnaId } from './taller-columns.js';

// Estado de Desk (literal del registro) → columna esperada. Es la tabla de la especificación.
const ESPERADO: Record<string, ColumnaId> = {
  'Ticket creado': 'entrada', 'OV asignada': 'entrada', 'Remisión creada': 'entrada',
  'Ingresado': 'diagnostico', 'Rev./Diagnostico': 'diagnostico', 'Notificado': 'diagnostico',
  'Notificación cliente': 'notificacion', 'Notificación Comercial': 'notificacion', 'Notificación a Compras': 'notificacion',
  'En Proceso': 'proceso', 'Continuación del proceso': 'proceso', 'Control de calidad': 'proceso', 'Verificación': 'proceso',
  'En Espera de Repuestos': 'proceso', 'Solicitado': 'proceso', 'En espera de SKU inventario': 'proceso',
  'Servicio externo': 'externo',
  'Por Entregar': 'entregar', 'Por Entregar / Sin facturar': 'entregar', 'Por Facturar': 'entregar', 'Liberación Comercial': 'entregar',
  'Finalizado': 'entregar', 'Anulado': 'entregar', 'Pendiente de facturar': 'entregar', 'Pendiente': 'entregar', 'Solicitud Soporte': 'entregar',
};

describe('estados de Desk y columnas', () => {
  it('el registro tiene los 26 estados, sin repetidos', () => {
    expect(ESTADOS_DESK).toHaveLength(26);
    expect(new Set(ESTADOS_DESK).size).toBe(26);
  });

  it.each(ESTADOS_DESK.map((e) => [e]))('«%s» tiene columna en la tabla', (e) => {
    expect(ESPERADO[e], 'estado del registro sin fila en la tabla de la prueba: ' + e).toBeDefined();
    expect(columnaDeEstado(e)).toBe(ESPERADO[e]);
  });

  it('la tabla de la prueba no tiene estados que el registro desconozca', () => {
    expect([...Object.keys(ESPERADO)].sort()).toEqual([...ESTADOS_DESK].sort());
  });

  it('no distingue mayúsculas, tildes ni espacios sobrantes', () => {
    expect(columnaDeEstado('  notificacion CLIENTE ')).toBe('notificacion');
    expect(columnaDeEstado('EN   PROCESO')).toBe('proceso');
  });

  it('claveEstado quita TODOS los espacios: «Rev./Diagnostico» = «Rev. / Diagnóstico»', () => {
    expect(claveEstado('Rev./Diagnostico')).toBe(claveEstado('Rev. / Diagnóstico'));
    expect(columnaDeEstado('Rev. / Diagnóstico')).toBe('diagnostico');
  });

  it('las claves de los 26 estados no chocan entre sí', () => {
    expect(new Set(ESTADOS_DESK.map(claveEstado)).size).toBe(26);
  });

  it('un estado desconocido o vacío no tiene columna (y no lanza)', () => {
    expect(columnaDeEstado('Estado Inventado')).toBeNull();
    expect(columnaDeEstado('')).toBeNull();
    expect(columnaDeEstado(null)).toBeNull();
    expect(columnaDeEstado(undefined)).toBeNull();
  });

  it('las columnas van de 1 a 6 con su nombre y descripción', () => {
    expect(COLUMNAS_TALLER.map((c) => c.id)).toEqual(['entrada', 'diagnostico', 'notificacion', 'proceso', 'externo', 'entregar']);
    expect(COLUMNAS_TALLER.map((c) => c.nombre)).toEqual([
      'Entrada – Remisión', 'Rev. / Diagnóstico', 'Notificación cliente', 'En proceso', 'Servicio externo', 'Por entregar',
    ]);
    expect(COLUMNAS_TALLER.map((c) => c.descripcion)).toEqual([
      'Recién llegado · en registro', 'Recibido, en revisión inicial', 'Esperando aprobación del cliente',
      'Reparación / calibración en curso', 'En fábrica o con proveedor', 'Listo · esperando recogida',
    ]);
  });

  it('los estados de cada columna salen de la misma tabla', () => {
    for (const c of COLUMNAS_TALLER) for (const e of c.estados) expect(ESPERADO[e]).toBe(c.id);
    expect(COLUMNAS_TALLER.flatMap((c) => c.estados).sort()).toEqual([...ESTADOS_DESK].sort());
  });

  it('conjuntos de etiqueta: espera de repuestos y ticket cerrado', () => {
    expect([...ESTADOS_ESPERA_REPUESTOS].sort()).toEqual(['En Espera de Repuestos', 'En espera de SKU inventario', 'Solicitado']);
    expect([...ESTADOS_CERRADOS].sort()).toEqual(['Anulado', 'Finalizado', 'Pendiente', 'Pendiente de facturar', 'Solicitud Soporte']);
  });
});
