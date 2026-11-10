// Equipos en Ambientalia — reglas de clasificación (dominio puro, sin dependencias).
// Corre igual en el navegador (pantalla del portal, página de Claude) y en Node (hub-api).
import {
  EST,
  type ArchivoDrive,
  type Clasificacion,
  type ComentarioZoho,
  type Entrada,
  type Escaneo,
  type EscaneoVisita,
  type Estado,
  type EvidenciaComentario,
  type Evidencia,
  type ItemEscaneo,
  type RemisionEntrada,
  type SalidaParcial,
  type Ticket,
  type TicketZoho,
  type Visita,
} from "./tipos.js";

export { EST };
export const ADENTRO: readonly Estado[] = [EST.TALLER, EST.EXTERNO, EST.REVISAR, EST.CERRADO];
/** Remisiones de envío a servicio externo. */
export const EXT = /METROLOG|METROLABOR/;

// ---------- Utilidades ----------
/** Mayúsculas, solo letras y números, O→0 e I→1. */
export const nrm = (s: unknown): string =>
  String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/O/g, "0").replace(/I/g, "1");
/** Clase de confusión OCR: O/0, I/1, S/5, T/7 y B/8 cuentan igual; los ceros a la izquierda no cuentan (0344460096 = 344460096). */
export const cls = (s: unknown): string =>
  nrm(s).replace(/^0+(?=.)/, "").replace(/5/g, "S").replace(/7/g, "T").replace(/8/g, "B");
/** Mayúsculas sin tildes. */
export const key = (s: unknown): string =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
/** AAMMDD → AAAA-MM-DD. */
export const iso = (d: string): string =>
  /^\d{6}$/.test(d) ? "20" + d.slice(0, 2) + "-" + d.slice(2, 4) + "-" + d.slice(4, 6) : "";
export const day = (s: unknown): string => (s ? String(s).slice(0, 10) : "");
/** Días entre dos fechas (a − b). */
export const diff = (a: string, b: string): number =>
  Math.round((new Date(day(a)).getTime() - new Date(day(b)).getTime()) / 864e5);
export const nkey = (n: string): string => key(n).replace(/\s+/g, " ").trim();
export const plain = (h: unknown): string =>
  key(String(h ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ")).trim();

/** Carpeta «AAMMDD - Cliente - S/N». */
export function parseF(f: ArchivoDrive): Entrada | null {
  const m = String(f.title || "").match(/^(\d{6})\s*-\s*(.+?)\s*-\s*([A-Za-z0-9]+)\s*$/);
  return m ? { id: f.id, d: iso(m[1]), c: m[2].trim(), sn: m[3] } : null;
}

// ---------- Remisiones de salida escaneadas ----------
const HSN = /^\\?#?\s*S\s*\/\s*N\b/;
const HDRW = /^(SERVICIO|MARCA|EQUIPO|TICKET|DESCRIPCION DEL EQUIPO|APLICA.*)$/;
const INCL = /^SE INCLUYE/;
const OBS = /^OBSERVACION/;
const STOP_FWD = /^SE INCLUYE|^OBSERVACION|^APLICA|^FIRMA|^NOTA|^CARGO|^NOMBRE|^FECHA/;
const PART = /\b(CABLE|ACCESORIOS?|SENSOR|CARGADOR|ADAPTADOR|BATERIA|MANGUERA|TARJETA|REPUESTOS?|BOMBA|CABEZAL|FILTRO|KIT|MODULO|CELDA|LAMPARA|PANTALLA|FUENTE|PARTES?|TUBO|ANTENA)\b/;
const MAIN = /MONITOR|ANALIZADOR|EDM|\bAP[A-Z]{2}|SONDA|MEDIDOR|ESTACION|MUESTREADOR|CONTADOR|OCMA/;
const STOPW = new Set(
  "SERVICIO EQUIPO EQUIPOS OBSERVACIONES NOVEDADES REMISION FIRMA NOMBRE CEDULA CARGO APLICA ORIGEN DESTINO DIRECCION UNIDADES REMITENTE DESTINATARIO FACTURACION ORIGINAL COLOMBIA HORIBA BOGOTA CREDITO CONTENER DELICADO OPERATIVO CALIBRADO INFORMACION DESCRIPCION AMBIENTALIA ENVIRONICS CERTIFICATION BUREAU VERITAS DIAGNOSTICO MANTENIMIENTO REPARACION CALIBRACION OPTIMAS CONDICIONES ACCESORIO ACCESORIOS FUNCIONAL GENERALES CLIENTE TELEFONO EMPRESA CONTACTO SALIDA ENTRADA INCLUYE TRANSPORTE TARJETA POLIZA SINIESTRO SEGUROS RIESGOS VIGENCIA ADMISION DEVOLUCION INTENTO OFICINA REGISTRO POSTAL MERCANCIA ATLANTICO BARRANQUILLA LABORATORIO TECNICO TECNICA ESPECIALISTA OPERACIONES".split(" "),
);

/** Descripción del ítem de la remisión al que pertenece un serial (lo que salió). */
function itemDesc(R: string[], L: string[], i: number): string {
  let h = -1;
  for (let j = i - 1; j >= Math.max(0, i - 16); j--) {
    if (HSN.test(L[j])) { h = j; break; }
    if (/REMISION DE SERVICIO/.test(L[j])) break;
  }
  const out: string[] = [];
  let inc = false;
  const take = (j: number) => {
    const s = L[j];
    if (INCL.test(s)) { inc = true; return; }
    if (OBS.test(s)) { inc = false; return; }
    if (inc || HDRW.test(s) || /^\d{1,4}$/.test(s) || HSN.test(s)) return;
    out.push(R[j]);
  };
  if (h >= 0) for (let j = h + 1; j < i; j++) take(j);
  else for (let j = Math.max(0, i - 3); j < i; j++) take(j);
  for (let j = i + 1; j <= Math.min(L.length - 1, i + 2); j++) {
    if (STOP_FWD.test(L[j]) || HSN.test(L[j])) break;
    if (!HDRW.test(L[j])) out.push(R[j]);
  }
  return out.join(" · ").replace(/\s+/g, " ").slice(0, 90);
}

/** Extrae seriales y el detalle de cada ítem del texto OCR de una remisión escaneada. */
export function scanParse(text: string): Pick<Escaneo, "t" | "it"> {
  const R = String(text || "").split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const L = R.map(key);
  const t = new Set<string>();
  const it: Record<string, ItemEscaneo> = {};
  let blk = 0;
  L.forEach((ln, i) => {
    if (/REMISION DE SERVICIO/.test(ln)) blk = i;
    (ln.match(/[A-Z0-9][A-Z0-9\-/]{3,}/g) || []).forEach((raw) => {
      const n = nrm(raw);
      if (n.length < 5 || n.length > 12 || !/\d/.test(n)) return;
      if (/^\d{9,}$/.test(n)) return;
      // Sin dígitos reales (un serial que el OCR leyó solo con letras): solo cuenta si va sola, en mayúsculas y no es una palabra del formato.
      if (!/\d/.test(raw) && (R[i] !== raw || STOPW.has(raw) || n.length < 6)) return;
      const c = cls(n);
      t.add(c);
      if (nrm(ln) !== n || it[c]) return; // detalle solo cuando el serial ocupa su propia celda
      let k = "";
      for (let j = i - 1; j >= blk; j--) {
        if (/^\d{3,4}$/.test(L[j])) {
          const v = +L[j];
          if (v >= 700 && v < 1500) { k = L[j]; break; }
        }
      }
      it[c] = { e: itemDesc(R, L, i), k };
    });
  });
  return { t: [...t], it };
}

/** La fila dice cable, accesorio, sensor… y no un equipo principal. */
export const esParcial = (e: string): boolean => {
  const s = key(e);
  return PART.test(s) && !MAIN.test(s);
};

// ---------- Remisiones escaneadas ilegibles ----------
const HDR = /^(T1CKET|CANT1DAD|REC1B1D0)$/; // encabezados de la remisión de servicio (en clase OCR)
const EQW = /GRIMM|HORIBA|ENVIRONICS|KUNAK|TELEDYNE|THERMO|DAVIS|LENOVO|MESA LABS|EDM|\bAP[A-Z]{2}|\bWQ|OCMA|CONDICIONES TECNICAS|OPERATIV|CALIBRAD|ACCESORIO|SHELTER|SENSOR|MONITOR|ANALIZADOR|DATALOGGER/;
const EQT = /^1B[AB][\dSTB]{5}$|^2B0[\dSTB]{5}$|^EDM[12]B0|^AP[A-Z]{2}3T0|^WQ\d|^0CMA|^PG3S0|^US000/; // serial GRIMM o modelo reconocible
const GARBLED = /\b(\d{2})\s*[#\\/]+\s*(\d{4,6})\b/;
const COMERCIAL = /^REM20\d\d|^0V1?20\d\d/;

export interface MotivoIlegible {
  m: string;
  q: string;
  /** Dígitos leídos del serial deformado, para sugerir el equipo. */
  dg?: string;
}

/**
 * ¿La remisión escaneada (que no se cruzó con ningún equipo) es ilegible?
 * No aplica a remisiones comerciales (REM-/OV-) ni al alquiler de gases (botellas / manómetro).
 */
export function scanIlegible(x: Pick<Escaneo, "t" | "it">, entrySet: Set<string>): MotivoIlegible | null {
  const t = x.t || [];
  const it = x.it || {};
  if (t.some((c) => COMERCIAL.test(c) || c === "B0TELLAS" || c === "MAN0METR0")) return null;
  if (t.some((c) => entrySet.has(c))) return null; // trae el serial de un equipo con entrada
  const items = Object.values(it).map((o) => key(o.e || ""));
  const g = items.map((e) => e.match(GARBLED)).find(Boolean);
  if (g) return { m: "serial ilegible", q: "El OCR leyó «" + g[0].replace(/\\/g, "") + "» donde va el serial", dg: g[2] };
  if (t.some((c) => EQT.test(c))) return null;
  if (!t.length) return { m: "sin texto legible", q: "El escaneo no tiene texto legible (página en blanco, foto o baja calidad)" };
  if (!Object.keys(it).length && t.length <= 3)
    return { m: "sin texto legible", q: "El escaneo casi no tiene texto legible: no se identifica equipo ni serial" };
  if (t.some((c) => HDR.test(c)) && !items.some((e) => EQW.test(e)))
    return { m: "serial ilegible", q: "Se reconoce el formato de remisión pero no el equipo ni el serial" };
  return null;
}
export const esComercial = (x: Pick<Escaneo, "t">): boolean => (x.t || []).some((c) => COMERCIAL.test(c));

/**
 * Fecha usable de una salida escaneada: la del nombre; si el nombre trae una fecha futura o no la trae,
 * la fecha AAAAMMDD impresa en el documento con el mismo mes y día. "" si no hay una fecha confiable.
 */
export function fechaReal(x: Pick<Escaneo, "d" | "n" | "t">, hoy: string): string {
  if (x.d && x.d <= hoy) return x.d;
  const md = (String(x.n || "").match(/^\d{2}(\d{4})/) || [])[1];
  if (!md) return "";
  const re = new RegExp("^20\\d{2}" + md + "$");
  const f = (x.t || []).map((c) => c.replace(/S/g, "5").replace(/T/g, "7").replace(/B/g, "8")).find((c) => re.test(c));
  const d = f ? f.slice(0, 4) + "-" + f.slice(4, 6) + "-" + f.slice(6) : "";
  return d && d <= hoy ? d : "";
}

// ---------- Remisión de entrada (Google Doc de la carpeta AAMMDD - Cliente - S/N) ----------
/** Fila del serial en la tabla de la remisión de entrada: «EQUIPO · MARCA», servicio y número de ticket. */
export function parseRemisionEntrada(text: string, sn: string): RemisionEntrada | null {
  const c = cls(sn);
  const L = String(text || "").split(/\n/).map((l) => l.replace(/\\/g, "").replace(/\*\*/g, "").trim());
  let H: string[] | null = null;
  let first: RemisionEntrada | null = null;
  const out = (v: string[], h: string[]): RemisionEntrada => {
    const g = (n: string) => { const i = h.indexOf(n); return i >= 0 ? (v[i] || "").trim() : ""; };
    return { eq: [g("EQUIPO"), g("MARCA")].filter(Boolean).join(" · "), srv: g("SERVICIO"), k: (g("TICKET").match(/\d{3,5}/) || [""])[0] };
  };
  for (const l of L) {
    if (!l.includes("|")) continue;
    const cells = l.replace(/^\|/, "").replace(/\|$/, "").split("|").map((x) => x.trim());
    const K = cells.map(key);
    if (K.includes("EQUIPO") && K.includes("MARCA")) { H = K.map((x) => (/S\s*\/\s*N/.test(x) ? "SN" : x)); continue; }
    if (H) {
      const sv = cells[H.indexOf("SN")] || "";
      if (!sv && !cells.some(Boolean)) continue;
      const o = out(cells, H);
      if (cls(sv) === c) return o;
      if (!first && sv) first = o;
      if (/OBSERVACION/.test(K.join(" "))) break;
    }
  }
  if (first) return first;
  const P = L.filter(Boolean);
  for (let i = 0; i < P.length; i++) {
    if (cls(P[i]) === c) {
      const pre = P.slice(Math.max(0, i - 3), i).filter((x) => !/^(TICKET|EQUIPO|MARCA|#?\s*S\/N|\d{3,5})$/i.test(x));
      return { eq: pre.slice(-2).join(" · "), srv: "", k: "" };
    }
  }
  return null;
}

// ---------- Tickets de Zoho Desk ----------
const TF = ["cf_serial", "cf_serial1", "cf_serial2", "cf_serial3", "cf_codigo_servicio", "cf_equipo_1", "cf_modelo", "cf_encargado", "cf_tipo_de_servicio", "cf_fecha_remision_entreda", "cf_fecha_remision_de_salida", "cf_fecha_finalizacion_st", "cf_fecha_entrada_de_servicio_externo", "cf_fecha_salida_servicio_externo"];
const EMPTY = /EMPTY RESPONSE|NO CONTENT|NO RECORDS/i;
const fld = (t: string, k: string): string => {
  const m = t.match(new RegExp('"' + k + '":"((?:[^"\\\\]|\\\\.)*)"'));
  return m ? m[1].replace(/\\\//g, "/") : "";
};
const esObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";

/**
 * Lista de tickets a partir de la respuesta de Zoho: directa, envuelta ({headers,status,data:{data}}), en texto o cortada.
 * «Sin resultados» (Empty response / 204) → []. Forma desconocida → null.
 */
export function tix(x: unknown): TicketZoho[] | null {
  if (typeof x === "string") {
    if (EMPTY.test(x) && x.indexOf('"ticketNumber"') < 0) return [];
    try { return tix(JSON.parse(x)); } catch { /* texto cortado: se rescata campo por campo */ }
    const ch = x.split('{"modifiedTime":').slice(1);
    return ch.length
      ? ch.map((c) => {
          const cf: Record<string, string> = {};
          TF.forEach((k) => (cf[k] = fld(c, k)));
          return {
            modifiedTime: (c.match(/^"([^"]+)"/) || [])[1] || "", createdTime: fld(c, "createdTime"), closedTime: fld(c, "closedTime"),
            statusType: fld(c, "statusType"), subject: fld(c, "subject"), status: fld(c, "status"), ticketNumber: fld(c, "ticketNumber"), webUrl: fld(c, "webUrl"), cf,
          };
        }).filter((t) => t.ticketNumber)
      : null;
  }
  if (Array.isArray(x)) return !x.length || (esObj(x[0]) && x[0].ticketNumber) ? (x as TicketZoho[]) : null;
  if (esObj(x)) {
    if (Array.isArray(x.data)) return x.data as TicketZoho[];
    if (typeof x.message === "string" && EMPTY.test(x.message)) return [];
    for (const v of Object.values(x)) {
      const r = typeof v === "string" || esObj(v) ? tix(v) : null;
      if (r && r.length) return r;
    }
    for (const v of Object.values(x)) {
      const r = esObj(v) ? tix(v) : null;
      if (r) return r;
    }
  }
  return null;
}

export function tnorm(t: TicketZoho): Ticket {
  const f = t.cf || {};
  const tk = new Set<string>();
  [f.cf_serial, f.cf_serial1, f.cf_serial2, f.cf_serial3, f.cf_codigo_servicio, t.subject].forEach((v) =>
    String(v || "").split(/[^A-Za-z0-9]+/).forEach((x) => { if (x.length >= 5 && /\d/.test(nrm(x))) tk.add(cls(x)); }),
  );
  const u = t.webUrl || "";
  const cod = String(f.cf_codigo_servicio || "").match(/_(\d{6})\s*$/);
  const e1 = String(f.cf_equipo_1 || "").trim();
  return {
    n: String(t.ticketNumber), id: (u.match(/dv\/(\d+)/) || [])[1] || t.id || "", st: t.status || "", stt: t.statusType || "",
    ct: day(t.createdTime), cl: day(t.closedTime), m: t.modifiedTime || "", u,
    fe: day(f.cf_fecha_remision_entreda), fs: day(f.cf_fecha_remision_de_salida), ff: day(f.cf_fecha_finalizacion_st),
    xo: day(f.cf_fecha_salida_servicio_externo), xi: day(f.cf_fecha_entrada_de_servicio_externo),
    cd: cod ? iso(cod[1]) : "", enc: f.cf_encargado || "",
    eq: [/^(OTRO|--NINGUNA--)$/i.test(e1) ? "" : e1, f.cf_modelo || ""].filter(Boolean).join(" "),
    srv: f.cf_tipo_de_servicio || "", tk: [...tk],
  };
}
export const closed = (z: Pick<Ticket, "stt" | "st"> | null | undefined): boolean =>
  !!z && (z.stt === "Closed" || key(z.st) === "FINALIZADO");
/** Estados en los que el equipo ya terminó servicio (coherentes con una salida física). */
export const POST = /^(POR FACTURAR|LIBERACION COMERCIAL|POR ENTREGAR|POR ENTREGAR\s*\/\s*SIN FACTURAR|FINALIZADO)$/;

/**
 * Enlace entrada → ticket: 0) número de ticket de la remisión de entrada; 1) Fecha Remisión Entrada ±3 días
 * (manda aunque otras fechas del ticket estén mal); 2) fecha del código de servicio; 3) creado desde 60 días antes;
 * 4) carpeta repetida en la misma estadía: ticket de la entrada anterior aún abierto.
 */
export function linkTicket(v: Pick<Visita, "k" | "d" | "next">, tickets: Ticket[], kRem?: string): Ticket | null {
  const c = v.k;
  const hi = v.next || "9999";
  let best: Ticket | null = null;
  let bs = 1e9;
  let why = "";
  if (kRem) {
    const f = tickets.find((z) => z.n === String(kRem));
    if (f) return { ...f, lw: "número de ticket " + kRem + " en la remisión de entrada" };
  }
  tickets.forEach((z) => {
    if (!z.tk.includes(c)) return;
    let s: number | null = null;
    let w = "";
    if (z.fe) {
      const df = diff(z.fe, v.d);
      if (df >= -3 && z.fe < hi) { s = Math.abs(df); w = "Fecha Remisión Entrada " + z.fe; } else return;
    } else {
      if ((z.cl && z.cl < v.d) || (z.fs && z.fs < v.d)) return;
      if (z.cd && diff(z.cd, v.d) >= -3 && z.cd < hi) { s = 10 + Math.abs(diff(z.cd, v.d)); w = "fecha del código de servicio " + z.cd; }
      else if (z.ct && diff(z.ct, v.d) >= -60 && z.ct < hi) { s = 20 + Math.abs(diff(z.ct, v.d)); w = "creado el " + z.ct; }
    }
    if (s !== null && s < bs) { bs = s; best = z; why = w; }
  });
  if (!best)
    tickets.forEach((z) => {
      if (!z.tk.includes(c) || !z.fe || z.fe >= v.d) return;
      const end = z.fs && z.fs >= z.fe ? z.fs : z.cl || "9999";
      if (end >= v.d && diff(v.d, z.fe) <= 120) {
        const s = diff(v.d, z.fe);
        if (s < bs) { bs = s; best = z; why = "ticket de la entrada del " + z.fe + ", aún abierto en esta fecha"; }
      }
    });
  return best ? { ...(best as Ticket), lw: why } : null;
}

// ---------- Comentarios de Zoho Desk ----------
const DELIV = /RECOG(E|EN|IDO|IDA|IO|IERON)\b|SE ADJUNTA(N)? (LA )?REMISION( ST)? DE SALIDA|^REMISION( ST)? (DE )?SALIDA\b|ENTREGAD[OA]S? AL CLIENTE|SE ENTREGA(N|RON)? (EL|LOS) EQUIPOS?\b|DESPACHAD[OA]/;
const EXTX = /METROLOG|METROLABOR|SERVICIO EXTERNO|ENVIAD[OA]S? A (CALIBRA|FABRICA)|CALIBRACION DE SENSORES/;

/** Lista de comentarios a partir de la respuesta de Zoho (directa, envuelta o en texto). */
export function cmtList(x: unknown): ComentarioZoho[] {
  if (typeof x === "string") {
    try { return cmtList(JSON.parse(x)); } catch { /* texto cortado */ }
    const out: ComentarioZoho[] = [];
    const re = /"content":"((?:[^"\\]|\\.)*)"[^{}]*?"commentedTime":"([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(x))) out.push({ content: m[1], commentedTime: m[2], attachments: [] });
    return out;
  }
  if (Array.isArray(x)) return x.filter((c): c is ComentarioZoho => esObj(c) && !!c.commentedTime);
  if (esObj(x)) {
    if (Array.isArray(x.data) && (!x.data.length || (esObj(x.data[0]) && x.data[0].commentedTime))) return x.data as ComentarioZoho[];
    for (const v of Object.values(x)) {
      const r = typeof v === "string" || esObj(v) ? cmtList(v) : null;
      if (r && r.length) return r;
    }
  }
  return [];
}

/**
 * Primera evidencia de entrega en comentarios: texto de recogida o PDF de salida escaneada adjunto.
 * No cuentan los envíos a servicio externo (Metrological, calibración de sensores, etc.).
 */
export function cmtEvidence(list: ComentarioZoho[], scanKeys: Set<string>, from: string, to: string | null): EvidenciaComentario | null {
  const ev = (list || [])
    .map((c) => {
      const d = day(c.commentedTime);
      const t = plain(c.content);
      const att = (c.attachments || []).map((a) => a.name).filter((n) => scanKeys.has(nkey(n)) && !EXT.test(key(n)));
      return { d, t, att };
    })
    .filter((c) => c.d >= from && (!to || c.d <= to) && !EXTX.test(c.t) && (DELIV.test(c.t) || c.att.length))
    .sort((a, b) => a.d.localeCompare(b.d));
  if (!ev.length) return null;
  const e = ev[0];
  return { d: e.d, q: (e.t.slice(0, 90) || "") + (e.att.length ? " [adjunto: " + e.att[0] + "]" : "") };
}

// ---------- Visitas (entradas) ----------
/** Una visita por serial y fecha (las carpetas repetidas cuentan una vez), con la fecha de la siguiente entrada. */
export function visits(entries: Entrada[]): Visita[] {
  const seen = new Map<string, Visita>();
  entries.forEach((e) => {
    const k = cls(e.sn) + "|" + e.d;
    const v = seen.get(k);
    if (!v) seen.set(k, { ...e, k: cls(e.sn), dup: [], next: null, sc: [], q: false, z: null });
    else v.dup.push(e.id);
  });
  const v = [...seen.values()];
  const by: Record<string, Visita[]> = {};
  v.forEach((x) => (by[x.k] = by[x.k] || []).push(x));
  Object.values(by).forEach((a) => {
    a.sort((p, q) => p.d.localeCompare(q.d));
    a.forEach((x, i) => (x.next = a[i + 1] ? a[i + 1].d : null));
  });
  return v;
}

/** Salidas escaneadas dentro de la ventana de la visita: después de la entrada y hasta la siguiente entrada del mismo S/N. */
export function scansFor(v: Pick<Visita, "d" | "next" | "k">, exits: Escaneo[]): EscaneoVisita[] {
  return exits
    .filter((x) => x.d > v.d && (!v.next || x.d <= v.next) && x.t.includes(v.k))
    .map((x) => {
      const it = (x.it || {})[v.k];
      return { id: x.id, n: x.n, d: x.d, ext: EXT.test(key(x.n)), part: !!it?.e && esParcial(it.e), e: it?.e || "", tkt: it?.k || "" };
    })
    .sort((a, b) => a.d.localeCompare(b.d) || Number(b.ext) - Number(a.ext));
}

export interface OpcionesClasificar {
  z: Ticket | null;
  scans: EscaneoVisita[];
  gen?: Entrada | null;
  ce?: EvidenciaComentario | null;
  age: number;
  zq: boolean;
}

/** Clasificación de una visita: dónde está físicamente el equipo y por qué. */
export function classify(v: Pick<Visita, "d" | "dup" | "next">, o: OpcionesClasificar): Clasificacion {
  const why = ["Entrada " + v.d + (v.dup.length ? " (carpeta duplicada, se cuenta una vez)" : "")];
  const z = o.z || null;
  const sc = o.scans || [];
  const full = sc.filter((s) => !s.part);
  const pa: SalidaParcial[] = sc.filter((s) => s.part).map((s) => ({ d: s.d, n: s.n, id: s.id, q: s.e, k: s.tkt }));
  if (z) {
    why.push("Ticket #" + z.n + " enlazado por " + z.lw);
    if (z.fs && z.fe && z.fs < z.fe) why.push("Dato a corregir en Zoho: Fecha Remisión de Salida " + z.fs + " es anterior a la Fecha Remisión Entrada " + z.fe);
  } else why.push(o.zq === false ? "Zoho no consultado (entrada antigua ya cerrada)" : "Sin ticket en Zoho para esta entrada");
  pa.forEach((p) => why.push("Salida parcial " + p.d + ": " + (p.q || "accesorio") + " (" + p.n + "); no cierra el equipo"));
  const last = full[full.length - 1];
  const R = (est: Estado, src: string, x?: Evidencia | null, xd?: string): Clasificacion => ({ est, src, why, x: x || null, z, pa, xd: xd || "" });
  if (last && !last.ext) {
    why.push("Remisión de salida escaneada " + last.d + ": " + last.n + (last.tkt ? " (ticket " + last.tkt + " en la remisión)" : ""));
    if (z && !closed(z) && !POST.test(key(z.st)))
      return R(EST.REVISAR, "escaneo", { n: last.n, id: last.id, q: "Hay salida escaneada pero el ticket sigue en «" + z.st + "»" }, last.d);
    return R(EST.ENTREGADO, "escaneo", { n: last.n, id: last.id }, last.d);
  }
  let extOut: EscaneoVisita | null = null;
  if (last && last.ext) {
    if (z && z.xi && z.xi >= last.d) why.push("Enviado a servicio externo " + last.d + " (" + last.n + "); regresó el " + z.xi + " según Zoho");
    else { why.push("Enviado a servicio externo " + last.d + ": " + last.n); extOut = last; }
  }
  if (o.ce) {
    why.push("Comentario " + o.ce.d + ": «" + o.ce.q + "»");
    return R(EST.ENTREGADO, "comentario", { n: "Comentario de entrega en Zoho (" + o.ce.d + ")" }, o.ce.d);
  }
  if (v.next) {
    why.push("El mismo S/N volvió a ingresar el " + v.next);
    return R(EST.ENTREGADO, "reingreso", { n: "Volvió a ingresar el " + v.next }, "");
  }
  if (z && closed(z)) {
    why.push("Ticket #" + z.n + " Finalizado" + (z.cl ? " el " + z.cl : "") + (z.fs ? "; Fecha Remisión de Salida " + z.fs : "") + ", pero no hay remisión de salida escaneada ni comentario de recogida");
    return R(EST.CERRADO, "zoho", { n: "Confirmar si el equipo ya salió", q: "El ticket se cerró sin evidencia de salida física" });
  }
  if (extOut) return R(EST.EXTERNO, "escaneo", { n: extOut.n, id: extOut.id }, extOut.d);
  if (z && z.xo && z.xo >= v.d && !(z.xi && z.xi >= z.xo)) {
    why.push("Zoho: salida a servicio externo " + z.xo + ", sin fecha de regreso");
    return R(EST.EXTERNO, "zoho", { n: "Servicio externo desde " + z.xo }, z.xo);
  }
  if (z && z.fs && z.fs >= v.d) {
    why.push("Zoho registra remisión de salida " + z.fs + " pero no hay escaneo ni comentario de entrega");
    return R(EST.REVISAR, "zoho", { n: "Confirmar si ya salió", q: "Zoho tiene Fecha Remisión de Salida " + z.fs });
  }
  if (!z && o.age > 30) return R(EST.REVISAR, "sin ticket", { n: "Sin ticket y sin salida", q: o.age + " días desde la entrada sin ticket ni salida" });
  const g = o.gen;
  if (g) why.push("Remisión de salida generada (n8n) " + g.d + ": falta el escaneo firmado");
  return R(EST.TALLER, g ? "esperando recogida" : "", g ? { n: "Salida generada, esperando recogida", fo: g.id } : null);
}
