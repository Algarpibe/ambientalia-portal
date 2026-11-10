// Lógica de pantalla compartida por la página de Claude y la pantalla React de Desk 2.0:
// ajustes manuales, vistas (pestañas), orden y remisiones ilegibles pendientes.
import { ADENTRO, cls, key, nrm } from "./reglas.js";
import { EST, type Ajuste, type Ajustes, type Fila, type Foto, type Ilegible } from "./tipos.js";

/** Clave de ajuste de una entrada. */
export const claveFila = (r: Pick<Fila, "sn" | "d">): string => cls(r.sn) + "|" + r.d;
export const claveIlegible = (x: Pick<Ilegible, "id">): string => "pdf:" + x.id;

/** Casos fijos conocidos (equivalen a «Marcar retirado»). Vacío: el repo es público y el caso que había se rehace con «Marcar retirado» tras el despliegue. */
export const RETIRADOS_FIJOS: Record<string, string> = {};

/** Aplica los ajustes manuales sobre la clasificación automática. */
export function aplicarAjustes(rows: Fila[], aj: Ajustes): Fila[] {
  return rows.map((r) => {
    const a = aj[claveFila(r)];
    const lg = aj["*" + cls(r.sn)];
    const b = RETIRADOS_FIJOS[nrm(r.sn)];
    const m = (t: string) => (t ? ": " + t : "");
    if (a && a.t === "ret" && r.est !== EST.ENTREGADO)
      return { ...r, est: EST.RETIRADO, src: "manual", why: r.why.concat("Marcado como retirado: " + a.m), man: 1 };
    if (a && a.t === "out" && ADENTRO.includes(r.est))
      return { ...r, est: EST.ENTREGADO, src: "confirmado", xd: a.at || "", why: r.why.concat("Salida confirmada manualmente" + m(a.m)), man: 1 };
    if (a && a.t === "in" && (r.est === EST.REVISAR || r.est === EST.CERRADO))
      return { ...r, est: EST.TALLER, src: "confirmado", why: r.why.concat("Confirmado en taller manualmente" + m(a.m)), man: 1 };
    if (lg && r.d <= (lg.d || "9999") && r.est !== EST.ENTREGADO)
      return { ...r, est: EST.RETIRADO, src: "manual", why: r.why.concat("Marcado como retirado: " + lg.m), man: 2 };
    if (b && r.est !== EST.ENTREGADO) return { ...r, est: EST.RETIRADO, src: "manual", why: r.why.concat(b) };
    return r;
  });
}

/** Ajustes guardados por versiones anteriores de la página de Claude. */
export function ajustesLegados(o: unknown): Ajustes {
  if (!o || typeof o !== "object") return {};
  const x = o as { aj?: Ajustes; in?: Record<string, { m?: string; at?: string }>; m?: Record<string, string | { m: string; d: string }> };
  if (x.aj) return x.aj;
  const out: Ajustes = {};
  Object.entries(x.in || {}).forEach(([k, v]) => (out[k] = { t: "in", m: v.m || "", at: v.at || "" }));
  Object.entries(x.m || {}).forEach(([k, v]) => (out["*" + k] = { t: "ret", m: typeof v === "string" ? v : v.m, at: "", d: typeof v === "string" ? "9999" : v.d }));
  return out;
}

export const nuevoAjuste = (t: Ajuste["t"], m = "", hoy = new Date().toISOString().slice(0, 10)): Ajuste => ({ t, m, at: hoy });

/** Tono de color de cada estado (0 verde, 1 ámbar, 2 gris, 3 azul, 4 morado). */
export const TONO: Record<string, number> = {
  [EST.TALLER]: 0, [EST.EXTERNO]: 1, [EST.REVISAR]: 1, [EST.CERRADO]: 2, [EST.ENTREGADO]: 3, [EST.RETIRADO]: 2,
};

export interface Vista {
  nombre: string;
  filtro: (r: Fila) => boolean;
  tono: number;
  ayuda: string;
  /** Empieza un grupo nuevo de pestañas. */
  grupo?: boolean;
}

export const VISTA_TICKET_ABIERTO = "Salió con ticket abierto";
export const VISTA_PARCIALES = "Salidas parciales";

export const VISTAS: Vista[] = [
  { nombre: EST.TALLER, filtro: (r) => r.est === EST.TALLER, tono: 0, ayuda: "Equipos físicamente en el taller." },
  { nombre: EST.EXTERNO, filtro: (r) => r.est === EST.EXTERNO, tono: 1, ayuda: "Enviados a Metrological o Metrolabor sin fecha de regreso." },
  { nombre: EST.REVISAR, filtro: (r) => r.est === EST.REVISAR, tono: 1, ayuda: "Sin ticket, o con datos de Drive y Zoho que se contradicen. Resuelve con los botones. Más abajo: remisiones de salida escaneadas que no se pudieron leer." },
  { nombre: EST.CERRADO, filtro: (r) => r.est === EST.CERRADO, tono: 2, ayuda: "El ticket se cerró pero no hay remisión de salida escaneada ni comentario de recogida. Lo normal es que el ticket se cierre con la entrega o después." },
  { nombre: VISTA_TICKET_ABIERTO, grupo: true, filtro: (r) => r.est === EST.ENTREGADO && !!r.z && !r.zc, tono: 4, ayuda: "Equipos que ya salieron y cuyo ticket sigue abierto (por facturar, liberación comercial…). Ordenados por días con el ticket abierto." },
  { nombre: VISTA_PARCIALES, filtro: (r) => !!r.pa?.length && ADENTRO.includes(r.est), tono: 1, ayuda: "Accesorios o partes que salieron por separado mientras el equipo principal sigue adentro o tiene una novedad (revisar, ticket cerrado sin salida). Las de equipos ya entregados quedan solo como nota en su fila." },
  { nombre: EST.ENTREGADO, grupo: true, filtro: (r) => r.est === EST.ENTREGADO, tono: 3, ayuda: "" },
  { nombre: EST.RETIRADO, filtro: (r) => r.est === EST.RETIRADO, tono: 2, ayuda: "Marcados a mano como retirados (p. ej. devueltos a fábrica)." },
];

/** Filas de una vista, en su orden. */
export function filasDeVista(rows: Fila[], nombre: string): Fila[] {
  const v = VISTAS.find((x) => x.nombre === nombre) || VISTAS[0];
  const list = rows.filter(v.filtro);
  if (nombre === VISTA_TICKET_ABIERTO) return list.sort((a, b) => (a.xd || "9").localeCompare(b.xd || "9"));
  if (nombre === VISTA_PARCIALES) return list.sort((a, b) => b.pa[b.pa.length - 1].d.localeCompare(a.pa[a.pa.length - 1].d));
  return list.sort((a, b) => a.d.localeCompare(b.d));
}

export const ilegiblesPendientes = (snap: Foto | null, aj: Ajustes): Ilegible[] =>
  (snap?.ilegibles || []).filter((x) => !aj[claveIlegible(x)]);

/** Días entre dos fechas, sin negativos. */
export const dias = (a: string, b: string): number => Math.max(0, Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 864e5));

export const enlaceArchivo = (id: string) => "https://drive.google.com/file/d/" + encodeURIComponent(id) + "/view";
export const enlaceCarpeta = (id: string) => "https://drive.google.com/drive/folders/" + encodeURIComponent(id);

// ---------- Filtros por cliente y por estado en Zoho ----------
/** Valor del filtro de Zoho para los equipos sin ticket enlazado. */
export const SIN_TICKET = "Sin ticket";
const SUFIJOS = new Set(["S", "A", "SA", "SAS", "LTDA", "LIMITADA", "E", "P", "ESP", "BIC", "CIA", "INC"]);

/** Clave de agrupación del cliente: sin tildes, sin puntuación y sin sufijos societarios («Cliente Ejemplo S.A. E.S.P.» = «CLIENTE EJEMPLO»). */
export function claveCliente(c: string): string {
  const p = key(c).replace(/[^A-Z0-9&]+/g, " ").trim().split(" ").filter(Boolean);
  while (p.length > 1 && SUFIJOS.has(p[p.length - 1])) p.pop();
  return p.join(" ");
}
export const estadoZoho = (r: Pick<Fila, "z">): string => (r.z ? r.z.st || "Sin estado" : SIN_TICKET);

/** Filtros activos; "" = todos. `cliente` es la clave de claveCliente. */
export interface Filtros {
  cliente: string;
  zoho: string;
}
export const SIN_FILTROS: Filtros = { cliente: "", zoho: "" };
export const hayFiltros = (f: Filtros): boolean => !!(f.cliente || f.zoho);

export function aplicarFiltros(rows: Fila[], f: Filtros): Fila[] {
  if (!hayFiltros(f)) return rows;
  return rows.filter((r) => (!f.cliente || claveCliente(r.c) === f.cliente) && (!f.zoho || estadoZoho(r) === f.zoho));
}

export interface OpcionFiltro {
  valor: string;
  etiqueta: string;
  /** Equipos de la vista actual con ese valor (respetando el otro filtro). */
  n: number;
}

/**
 * Opciones de un filtro para las filas de la vista actual, con cuántos equipos tiene cada una,
 * respetando el otro filtro. El valor elegido siempre aparece, aunque quede en 0.
 * Clientes: el nombre que más se repite en el grupo. Estados de Zoho: de mayor a menor cantidad, «Sin ticket» al final.
 */
export function opcionesFiltro(rowsVista: Fila[], campo: keyof Filtros, f: Filtros): OpcionFiltro[] {
  const base = aplicarFiltros(rowsVista, campo === "cliente" ? { ...f, cliente: "" } : { ...f, zoho: "" });
  const grupos = new Map<string, { n: number; nombres: Map<string, number> }>();
  base.forEach((r) => {
    const v = campo === "cliente" ? claveCliente(r.c) : estadoZoho(r);
    const g = grupos.get(v) || { n: 0, nombres: new Map<string, number>() };
    g.n++;
    const nom = campo === "cliente" ? r.c.trim() : v;
    g.nombres.set(nom, (g.nombres.get(nom) || 0) + 1);
    grupos.set(v, g);
  });
  const sel = f[campo];
  if (sel && !grupos.has(sel)) grupos.set(sel, { n: 0, nombres: new Map([[sel, 1]]) });
  const op = [...grupos.entries()].map(([valor, g]) => ({
    valor,
    etiqueta: [...g.nombres.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0],
    n: g.n,
  }));
  return campo === "cliente"
    ? op.sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, "es"))
    : op.sort((a, b) => Number(a.valor === SIN_TICKET) - Number(b.valor === SIN_TICKET) || b.n - a.n || a.etiqueta.localeCompare(b.etiqueta, "es"));
}
