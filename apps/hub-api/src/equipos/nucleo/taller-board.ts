// Modelo puro del tablero kanban del taller: de las filas ajustadas a columnas, tarjetas, etiquetas, días y KPIs.
// Sin E/S ni reloj propio: el instante actual entra como parámetro (`ahoraMs`).
import { nkey } from "./reglas.js";
import { VISTAS, VISTA_PARCIALES, VISTA_TICKET_ABIERTO, claveFila } from "./pantalla.js";
import { EST, type Fila } from "./tipos.js";
import { COLUMNAS_TALLER, columnaDeEstado, esEsperaRepuestos, esEstadoCerrado, type ColumnaId } from "./taller-columns.js";

export type TonoDias = "verde" | "ambar" | "rojo";
export type TipoEtiqueta = "sin_ticket" | "estado_desconocido" | "espera_repuestos" | "ticket_cerrado" | "falta_remision";

export interface Etiqueta {
  tipo: TipoEtiqueta;
  texto: string;
}

export interface Tarjeta {
  /** Clave de ajuste de la fila (`claveFila`). */
  clave: string;
  sn: string;
  equipo: string;
  cliente: string;
  /** Fecha de entrada AAAA-MM-DD. */
  entrada: string;
  dias: number;
  tono: TonoDias;
  etiquetas: Etiqueta[];
  tecnico: { nombre: string; iniciales: string; avatar: number } | null;
  ticket: string | null;
  pie: "tecnico" | "sin_asignar" | "neutro";
}

// ---------- KPIs seleccionables: los contadores de VISTAS ----------
/** Id de cada KPI → nombre de su vista en VISTAS y etiqueta con que se muestra en pantalla. */
export const KPI_DEFS = {
  en_taller: { vista: EST.TALLER, etiqueta: "En taller" },
  externo: { vista: EST.EXTERNO, etiqueta: "Servicio externo" },
  revisar: { vista: EST.REVISAR, etiqueta: "Por revisar" },
  ticket_cerrado: { vista: EST.CERRADO, etiqueta: "Ticket cerrado sin salida" },
  ticket_abierto: { vista: VISTA_TICKET_ABIERTO, etiqueta: VISTA_TICKET_ABIERTO },
  parciales: { vista: VISTA_PARCIALES, etiqueta: VISTA_PARCIALES },
  entregado: { vista: EST.ENTREGADO, etiqueta: "Entregados" },
  retirado: { vista: EST.RETIRADO, etiqueta: "Retirado" },
} as const;
export type KpiId = keyof typeof KPI_DEFS;
export const KPI_IDS: readonly KpiId[] = Object.keys(KPI_DEFS) as KpiId[];
export const KPIS_REQUERIDOS = 5;

export interface Kpi {
  id: KpiId;
  etiqueta: string;
  valor: number;
  tono: "neutro" | "ambar" | "rojo" | "verde";
}

/**
 * Tono del KPI, como en el PDF: «Salió con ticket abierto» rojo y lo que hay que revisar ámbar
 * (solo si hay alguno), lo entregado verde, el resto neutro.
 */
const tonoKpi = (id: KpiId, valor: number): Kpi["tono"] =>
  id === "entregado" ? "verde"
    : valor > 0 && id === "ticket_abierto" ? "rojo"
    : valor > 0 && (id === "revisar" || id === "ticket_cerrado" || id === "parciales") ? "ambar"
    : "neutro";

export interface ColumnaTablero {
  id: ColumnaId;
  nombre: string;
  descripcion: string;
  tarjetas: Tarjeta[];
}

export interface Tablero {
  columnas: ColumnaTablero[];
  kpis: Kpi[];
}

export interface AjustesTablero {
  /** Desde cuántos días la tarjeta pasa a ámbar. */
  umbralAmbar: number;
  /** Con más de cuántos días pasa a rojo. */
  umbralRojo: number;
  /** Hora de Bogotá (0–23) en que empieza el tema nocturno. */
  nocheDesde: number;
  /** Hora de Bogotá (0–23) en que termina. */
  nocheHasta: number;
  /** Exactamente 5 KPIs distintos, en orden. */
  kpis: KpiId[];
  /** Tema de la TV: fijo de día, fijo de noche o «auto» (noche entre `nocheDesde` y `nocheHasta`). */
  temaTv: ModoTemaTv;
}

/** Los valores que admite el tema de la TV (y `?tema=` en su dirección). */
export const MODOS_TEMA_TV = ["dia", "noche", "auto"] as const;
export type ModoTemaTv = (typeof MODOS_TEMA_TV)[number];
export const esModoTemaTv = (x: unknown): x is ModoTemaTv => (MODOS_TEMA_TV as readonly unknown[]).includes(x);

export const AJUSTES_TABLERO_POR_DEFECTO: AjustesTablero = {
  umbralAmbar: 30,
  umbralRojo: 90,
  nocheDesde: 18,
  nocheHasta: 6,
  kpis: ["en_taller", "revisar", "ticket_abierto", "externo", "entregado"],
  temaTv: "dia",
};

const esEntero = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x);
const esHora = (x: unknown): x is number => esEntero(x) && x >= 0 && x <= 23;

/** Valida unos ajustes de tablero. Devuelve una copia limpia (sin campos extra) o null si algo no cumple. */
export function validarAjustesTablero(x: unknown): AjustesTablero | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const { umbralAmbar, umbralRojo, nocheDesde, nocheHasta, kpis, temaTv } = o;
  if (!esEntero(umbralAmbar) || umbralAmbar < 1) return null;
  if (!esEntero(umbralRojo) || umbralRojo <= umbralAmbar) return null;
  if (!esHora(nocheDesde) || !esHora(nocheHasta)) return null;
  if (!Array.isArray(kpis) || kpis.length !== KPIS_REQUERIDOS) return null;
  if (!kpis.every((k): k is KpiId => typeof k === "string" && (KPI_IDS as readonly string[]).includes(k))) return null;
  if (new Set(kpis).size !== KPIS_REQUERIDOS) return null;
  if (!esModoTemaTv(temaTv)) return null;
  return { umbralAmbar, umbralRojo, nocheDesde, nocheHasta, kpis: [...kpis], temaTv };
}

// ---------- Hora y días en Bogotá (UTC-5 todo el año, sin horario de verano) ----------
const BOGOTA_MS = 5 * 3600e3;
/** Fecha AAAA-MM-DD en Bogotá de un instante. */
export const fechaBogota = (ms: number): string => new Date(ms - BOGOTA_MS).toISOString().slice(0, 10);
/** Hora (0–23) en Bogotá de un instante. */
export const horaBogota = (ms: number): number => new Date(ms - BOGOTA_MS).getUTCHours();

/** Días de calendario entre la entrada (AAAA-MM-DD) y hoy en Bogotá. Futuro o ilegible: 0. */
export function diasEnTaller(entrada: string, ahoraMs: number): number {
  const a = Date.parse(entrada.slice(0, 10));
  const b = Date.parse(fechaBogota(ahoraMs));
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, Math.round((b - a) / 864e5)) : 0;
}

export const tonoDias = (dias: number, cfg: Pick<AjustesTablero, "umbralAmbar" | "umbralRojo">): TonoDias =>
  dias > cfg.umbralRojo ? "rojo" : dias >= cfg.umbralAmbar ? "ambar" : "verde";

// ---------- Tarjetas ----------
/** Índice de color (0–5) del avatar: FNV-1a de la clave del nombre, módulo 6. */
export function avatarDe(nombre: string): number {
  let h = 0x811c9dc5;
  for (const c of nkey(nombre)) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 6;
}

const iniciales = (nombre: string): string =>
  nombre.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join("");

function columnaDe(r: Fila): ColumnaId {
  if (r.est === EST.EXTERNO) return "externo";
  if (!r.z) return "entrada";
  return columnaDeEstado(r.z.st) ?? "diagnostico";
}

function etiquetasDe(r: Fila): Etiqueta[] {
  const out: Etiqueta[] = [];
  if (!r.z) out.push({ tipo: "sin_ticket", texto: "Sin ticket" });
  else {
    if (columnaDeEstado(r.z.st) === null) out.push({ tipo: "estado_desconocido", texto: r.z.st || "Sin estado" });
    if (esEsperaRepuestos(r.z.st)) out.push({ tipo: "espera_repuestos", texto: "Espera repuestos" });
    if (r.est === EST.TALLER && esEstadoCerrado(r.z.st)) out.push({ tipo: "ticket_cerrado", texto: "Ticket cerrado" });
  }
  if (r.src === "esperando recogida") out.push({ tipo: "falta_remision", texto: "Falta remisión firmada" });
  return out;
}

/** Lo que Desk pone en «Encargado» cuando el ticket aún no tiene técnico: no es una persona. */
const SIN_TECNICO_DESK = new Set(["Pendiente Asignar"].map(nkey));

function tarjetaDe(r: Fila, cfg: AjustesTablero, ahoraMs: number): Tarjeta {
  const dias = diasEnTaller(r.d, ahoraMs);
  const crudo = r.z?.enc?.trim() ?? "";
  const enc = SIN_TECNICO_DESK.has(nkey(crudo)) ? "" : crudo;
  return {
    clave: claveFila(r),
    sn: r.sn,
    equipo: r.z?.eq || r.eq,
    cliente: r.c,
    entrada: r.d,
    dias,
    tono: tonoDias(dias, cfg),
    etiquetas: etiquetasDe(r),
    tecnico: enc ? { nombre: enc, iniciales: iniciales(enc), avatar: avatarDe(enc) } : null,
    ticket: r.z ? r.z.n : null,
    pie: !r.z ? "neutro" : enc ? "tecnico" : "sin_asignar",
  };
}

const porAntiguedad = (a: Tarjeta, b: Tarjeta): number =>
  b.dias - a.dias || (a.sn < b.sn ? -1 : a.sn > b.sn ? 1 : 0) || (a.clave < b.clave ? -1 : a.clave > b.clave ? 1 : 0);

/**
 * Tablero a partir de las filas YA ajustadas (`aplicarAjustes`) y sin filtrar.
 * Tarjetas: solo filas TALLER y EXTERNO. KPIs: conteos de `VISTAS` sobre todas las filas recibidas.
 */
export function construirTablero(filasAjustadas: Fila[], cfg: AjustesTablero, ahoraMs: number): Tablero {
  const porColumna = new Map<ColumnaId, Tarjeta[]>(COLUMNAS_TALLER.map((c) => [c.id, []]));
  for (const r of filasAjustadas) {
    if (r.est !== EST.TALLER && r.est !== EST.EXTERNO) continue;
    porColumna.get(columnaDe(r))!.push(tarjetaDe(r, cfg, ahoraMs));
  }
  const columnas = COLUMNAS_TALLER.map((c) => ({
    id: c.id,
    nombre: c.nombre,
    descripcion: c.descripcion,
    tarjetas: porColumna.get(c.id)!.sort(porAntiguedad),
  }));
  const kpis = cfg.kpis.map((id) => {
    const filtro = VISTAS.find((v) => v.nombre === KPI_DEFS[id].vista)!.filtro;
    const valor = filasAjustadas.filter(filtro).length;
    return { id, etiqueta: KPI_DEFS[id].etiqueta, valor, tono: tonoKpi(id, valor) };
  });
  return { columnas, kpis };
}
