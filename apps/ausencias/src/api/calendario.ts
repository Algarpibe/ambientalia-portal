import { get } from './http';
import type { CalendarioDelAnio, CalendarioDelMes } from './tipos';

// ARQ-612 — el calendario del mes y del año, sacado de api.ts tal cual. api.ts
// lo reexporta (lo vigila barril.test.ts).

/** El calendario de un mes `YYYY-MM`. Lo ve cualquiera que tenga la app. */
export const fetchCalendario = (mes: string) =>
  get<CalendarioDelMes>(`/api/ausencias/calendario?mes=${encodeURIComponent(mes)}`);

/**
 * El año entero en franjas. Ruta aparte de la mensual porque la respuesta tiene
 * otra forma —barras en vez de marcas por día—, no porque cambie el permiso: el
 * alcance que aplica es el mismo, y lo resuelve el servidor.
 */
export const fetchCalendarioAnual = (anio: string) =>
  get<CalendarioDelAnio>(`/api/ausencias/calendario-anual?anio=${encodeURIComponent(anio)}`);
