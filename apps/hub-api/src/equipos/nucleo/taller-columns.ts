// Columnas del tablero kanban del taller y su relación con los estados de Desk.
// Puro: sin E/S ni reloj. Lo usan el servidor y la pantalla a través de `index.ts`.
import { nkey } from "./reglas.js";

/** Los 26 estados del registro de Desk, literales. Es la lista contra la que se prueba la cobertura. */
export const ESTADOS_DESK: readonly string[] = [
  "Ingresado", "Rev./Diagnostico", "Notificado",
  "En Proceso", "Continuación del proceso", "Control de calidad", "Verificación",
  "En Espera de Repuestos", "Solicitado", "En espera de SKU inventario",
  "Notificación cliente", "Notificación Comercial", "Notificación a Compras",
  "Servicio externo",
  "Por Entregar", "Por Entregar / Sin facturar", "Por Facturar", "Liberación Comercial",
  "Finalizado", "Anulado", "Pendiente de facturar", "Pendiente", "Solicitud Soporte",
  "Ticket creado", "OV asignada", "Remisión creada",
];

export type ColumnaId = "entrada" | "diagnostico" | "notificacion" | "proceso" | "externo" | "entregar";

export interface ColumnaTaller {
  id: ColumnaId;
  nombre: string;
  descripcion: string;
  /** Estados de Desk que caen aquí, literales. */
  estados: string[];
}

export const COLUMNAS_TALLER: readonly ColumnaTaller[] = [
  { id: "entrada", nombre: "Entrada – Remisión", descripcion: "Recién llegado · en registro", estados: ["Ticket creado", "OV asignada", "Remisión creada"] },
  { id: "diagnostico", nombre: "Rev. / Diagnóstico", descripcion: "Recibido, en revisión inicial", estados: ["Ingresado", "Rev./Diagnostico", "Notificado"] },
  { id: "notificacion", nombre: "Notificación cliente", descripcion: "Esperando aprobación del cliente", estados: ["Notificación cliente", "Notificación Comercial", "Notificación a Compras"] },
  {
    id: "proceso", nombre: "En proceso", descripcion: "Reparación / calibración en curso",
    estados: ["En Proceso", "Continuación del proceso", "Control de calidad", "Verificación", "En Espera de Repuestos", "Solicitado", "En espera de SKU inventario"],
  },
  { id: "externo", nombre: "Servicio externo", descripcion: "En fábrica o con proveedor", estados: ["Servicio externo"] },
  {
    id: "entregar", nombre: "Por entregar", descripcion: "Listo · esperando recogida",
    estados: ["Por Entregar", "Por Entregar / Sin facturar", "Por Facturar", "Liberación Comercial", "Finalizado", "Anulado", "Pendiente de facturar", "Pendiente", "Solicitud Soporte"],
  },
];

/** Estados que llevan la etiqueta «Espera repuestos». */
export const ESTADOS_ESPERA_REPUESTOS: readonly string[] = ["En Espera de Repuestos", "Solicitado", "En espera de SKU inventario"];
/** Estados de ticket cerrado que, en una fila de taller, caen en «Por entregar» con la etiqueta «Ticket cerrado». */
export const ESTADOS_CERRADOS: readonly string[] = ["Finalizado", "Anulado", "Pendiente de facturar", "Pendiente", "Solicitud Soporte"];

/** Clave de comparación de un estado: sin tildes, mayúsculas y SIN ningún espacio («Rev./Diagnostico» = «Rev. / Diagnóstico»). */
export const claveEstado = (s: string): string => nkey(s).replace(/ /g, "");

const COLUMNA_POR_CLAVE: ReadonlyMap<string, ColumnaId> = new Map(
  COLUMNAS_TALLER.flatMap((c) => c.estados.map((e) => [claveEstado(e), c.id] as const)),
);
const CLAVES_ESPERA: ReadonlySet<string> = new Set(ESTADOS_ESPERA_REPUESTOS.map(claveEstado));
const CLAVES_CERRADOS: ReadonlySet<string> = new Set(ESTADOS_CERRADOS.map(claveEstado));

/** Columna de un estado de Desk, o null si no es del registro (nunca lanza). */
export const columnaDeEstado = (st: string | null | undefined): ColumnaId | null => COLUMNA_POR_CLAVE.get(claveEstado(st ?? "")) ?? null;
export const esEsperaRepuestos = (st: string | null | undefined): boolean => CLAVES_ESPERA.has(claveEstado(st ?? ""));
export const esEstadoCerrado = (st: string | null | undefined): boolean => CLAVES_CERRADOS.has(claveEstado(st ?? ""));
