// Equipos en Ambientalia — proceso de actualización (no depende de dónde vengan los datos).
// Recibe unas «fuentes» de solo lectura (Drive y Zoho) y el estado guardado de la ejecución anterior,
// y devuelve la foto nueva más los cachés para guardar.
import * as R from "./reglas.js";
import type {
  ComentariosCache,
  Entrada,
  Escaneo,
  EstadoModulo,
  EvidenciaComentario,
  Fila,
  Fuentes,
  Ilegible,
  OpcionesActualizar,
  Clasificacion,
  RemisionEntrada,
  Resultado,
  Ticket,
  TicketFila,
  Visita,
} from "./tipos.js";

/** Versión del caché de salidas escaneadas (cambia si cambia lo que se extrae de cada PDF). */
export const CV = 3;

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) || 1 }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}
export const hoyBogota = (): string => new Date(Date.now() - 5 * 36e5).toISOString().slice(0, 10);
const zlite = (z: Ticket | null): TicketFila | null =>
  z ? { n: z.n, id: z.id, st: z.st, stt: z.stt, u: z.u, m: z.m, enc: z.enc, eq: z.eq, srv: z.srv, fs: z.fs, cl: z.cl } : null;
const uniq = <T extends { id: string }>(a: T[] | null | undefined): T[] => [...new Map((a || []).map((f) => [f.id, f])).values()];
const mensaje = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export async function actualizar(fuentes: Fuentes, estado: Partial<EstadoModulo> | null, op: OpcionesActualizar = {}): Promise<Resultado> {
  const prog = op.prog || (() => {});
  const msg = op.msg || mensaje;
  const avisos: string[] = [];
  const hoy = op.hoy || hoyBogota();
  const est = estado || {};
  const prevSnap = est.snap || null;
  const cmt: Record<string, ComentariosCache> = { ...(est.cmt || {}) };
  const ent: Record<string, RemisionEntrada> = { ...(est.ent || {}) };
  const have = new Map<string, Escaneo>(((est.exits && est.exits.v === CV && est.exits.list) || []).map((x) => [x.id, x]));

  prog("Leyendo remisiones de entrada…");
  const rawE = uniq(await fuentes.entradas());
  const entries = rawE.map(R.parseF).filter((x): x is Entrada => !!x);
  rawE.filter((f) => !R.parseF(f)).forEach((f) => avisos.push("Carpeta de entrada con nombre no reconocido: " + f.title));
  prog("Leyendo salidas generadas…");
  const gen = uniq(await fuentes.salidasGeneradas()).map(R.parseF).filter((x): x is Entrada => !!x);
  prog("Listando salidas escaneadas…");
  const pdfs = uniq(await fuentes.salidasEscaneadas());
  const fresh = pdfs.filter((f) => !have.has(f.id));
  let n = 0;
  await pool(fresh, op.paralelo || 4, async (f) => {
    try {
      const s = R.scanParse(await fuentes.textoPdf(f.id));
      have.set(f.id, { id: f.id, n: f.title, d: R.iso((f.title.match(/^\d{6}/) || [""])[0]), ...s });
    } catch (e) {
      avisos.push("Salida escaneada " + f.title + ": " + msg(e));
    }
    n++;
    prog("Leyendo salidas escaneadas nuevas " + n + "/" + fresh.length);
  });
  const cache = pdfs.map((f) => have.get(f.id)).filter((x): x is Escaneo => !!x);
  // Para cruzar se usa la fecha real: nombre con fecha futura → fecha impresa en el documento; sin fecha → no se usa.
  const usar = cache
    .map((x) => { const d = R.fechaReal(x, hoy); return d === x.d ? x : { ...x, d }; })
    .filter((x) => x.d);
  const scanKeys = new Set(pdfs.map((f) => R.nkey(f.title)));
  const old = new Date(new Date(hoy).getTime() - 120 * 864e5).toISOString().slice(0, 10);
  const V = R.visits(entries);
  const prev = new Map((prevSnap?.rows || []).map((r) => [r.id, r]));
  V.forEach((v) => {
    v.sc = R.scansFor(v, usar);
    const f = v.sc.filter((s) => !s.part);
    const l = f[f.length - 1];
    v.q = !v.next && (!l || l.ext || l.d >= old);
  });

  // Zoho Desk: una búsqueda por serial, solo para entradas que pueden seguir abiertas o salieron hace poco.
  const sns = [...new Map(V.filter((v) => v.q).map((v) => [v.k, v.sn])).entries()];
  const T: Record<string, Ticket[] | null> = {};
  let k = 0;
  await pool(sns, op.paralelo ? Math.min(3, op.paralelo) : 3, async ([c, sn]) => {
    try {
      T[c] = (await fuentes.tickets(sn)).map(R.tnorm);
    } catch (e) {
      T[c] = null;
      avisos.push("Zoho Desk " + sn + ": " + msg(e));
    }
    k++;
    prog("Consultando tickets en Zoho Desk " + k + "/" + sns.length);
  });
  const genFor = (v: Visita): Entrada | null =>
    gen.filter((g) => R.cls(g.sn) === v.k && g.d >= v.d && (!v.next || g.d <= v.next)).sort((a, b) => a.d.localeCompare(b.d)).pop() || null;
  const run = (v: Visita, ce: EvidenciaComentario | null): Clasificacion => {
    const tk = T[v.k];
    v.z = v.q && tk ? R.linkTicket(v, tk.concat(v.extra || []), v.kRem) : null;
    return R.classify(v, { z: v.z, scans: v.sc, gen: genFor(v), ce, age: R.diff(hoy, v.d), zq: v.q });
  };
  let res: [Visita, Clasificacion][] = V.map((v) => [v, run(v, null)]);

  // Remisión de entrada: nombre del equipo y número de ticket, solo para equipos adentro sin ticket o sin nombre.
  if (fuentes.remisionEntrada) {
    const leer = fuentes.remisionEntrada.bind(fuentes);
    const needE = res.filter(([v, r]) => v.q && R.ADENTRO.includes(r.est) && (!v.z || !v.z.eq));
    let e = 0;
    await pool(needE, 3, async ([v]) => {
      if (!ent[v.id]) {
        try { ent[v.id] = R.parseRemisionEntrada(await leer(v.id), v.sn) || { eq: "", srv: "", k: "" }; }
        catch (x) { avisos.push("Remisión de entrada " + v.sn + ": " + msg(x)); }
      }
      const re = ent[v.id];
      const tk = T[v.k];
      if (re && re.k && !v.z && tk) {
        v.kRem = re.k;
        if (!tk.some((z) => z.n === re.k) && fuentes.ticketNumero) {
          try {
            v.extra = (await fuentes.ticketNumero(re.k)).map(R.tnorm).map((z) => ({ ...z, tk: z.tk.concat(v.k) }));
          } catch (x) {
            avisos.push("Zoho Desk ticket " + re.k + ": " + msg(x));
          }
        }
      }
      e++;
      prog("Leyendo remisiones de entrada " + e + "/" + needE.length);
    });
    res = res.map(([v, r]) => (v.kRem ? [v, run(v, null)] : [v, r]));
  }

  // Comentarios de Zoho: para los equipos que siguen figurando adentro (incluye ticket cerrado sin salida).
  const need = res.filter(([v, r]) => v.z && v.z.id && R.ADENTRO.includes(r.est));
  let m = 0;
  await pool(need, 3, async ([v]) => {
    const z = v.z as Ticket;
    const c = cmt[z.id];
    if (!c || c.m !== z.m) {
      try {
        const l = R.cmtList(await fuentes.comentarios(z.id));
        cmt[z.id] = { m: z.m, l: l.map((c) => ({ d: c.commentedTime, t: R.plain(c.content).slice(0, 240), a: (c.attachments || []).map((a) => a.name) })) };
      } catch (e) {
        avisos.push("Comentarios del ticket #" + z.n + ": " + msg(e));
      }
    }
    m++;
    prog("Revisando comentarios de tickets " + m + "/" + need.length);
  });
  res = res.map(([v, r]) => {
    const c = v.z && cmt[v.z.id];
    if (!c || !v.z || !R.ADENTRO.includes(r.est)) return [v, r];
    const from = v.z.xi && v.z.xi > v.d ? v.z.xi : v.d;
    const ce = R.cmtEvidence(
      c.l.map((x) => ({ commentedTime: x.d, content: x.t, attachments: (x.a || []).map((n) => ({ name: n })) })),
      scanKeys, from, v.next,
    );
    return ce ? [v, run(v, ce)] : [v, r];
  });

  const rows: Fila[] = res.map(([v, r]) => {
    if (v.q && T[v.k] === null) {
      const o = prev.get(v.id);
      if (o) return { ...o, why: (o.why || []).filter((w) => !/^Zoho no respondió/.test(w)).concat("Zoho no respondió: se conserva la clasificación anterior") };
    }
    const re = ent[v.id];
    return { id: v.id, d: v.d, c: v.c, sn: v.sn, est: r.est, src: r.src, why: r.why, x: r.x, z: zlite(r.z), zc: R.closed(r.z), pa: r.pa, xd: r.xd, eq: (re && re.eq) || "" };
  });

  // Remisiones escaneadas ilegibles o con fecha errada en el nombre (se muestran en «Revisar»).
  const ilegibles = buscarIlegibles(cache, entries, V, rows, hoy);
  return { snap: { at: new Date().toISOString(), hoy, rows, ilegibles }, exits: { v: CV, list: cache }, cmt, ent, avisos };
}

/**
 * PDFs de salida que no se pudieron leer o cruzar con ningún equipo, y PDFs con fecha errada en el nombre.
 * Para cada uno se sugieren los equipos del mismo cliente que figuran adentro desde antes de esa fecha,
 * o el equipo cuyo serial termina en los dígitos que sí se leyeron.
 */
export function buscarIlegibles(cache: Escaneo[], entries: Entrada[], V: Visita[], rows: Fila[], hoy: string): Ilegible[] {
  const entrySet = new Set(entries.map((e) => R.cls(e.sn)));
  const used = new Set<string>();
  V.forEach((v) => v.sc.forEach((s) => used.add(s.id)));
  const w1 = (s: string) => R.nkey(s).replace(/[^A-Z ]/g, " ").split(" ").find((p) => p.length >= 3) || "";
  const posibles = (x: Escaneo, dg?: string) => {
    const cw = w1(String(x.n).replace(/^\d+\s*-?\s*/, "").replace(/\.PDF$/i, ""));
    return rows
      .filter((r) => (dg ? R.nrm(r.sn).endsWith(dg) : !!cw && w1(r.c) === cw && R.ADENTRO.includes(r.est) && (!x.d || r.d <= x.d)))
      .sort((a, b) => b.d.localeCompare(a.d))
      .filter((r, i, a) => a.findIndex((o) => R.cls(o.sn) === R.cls(r.sn)) === i)
      .map((r) => ({ sn: r.sn, d: r.d, est: r.est, c: r.c }))
      .slice(0, 8);
  };
  const out: Ilegible[] = [];
  cache.forEach((x) => {
    if (!x.d || x.d > hoy) {
      if (R.esComercial(x)) return; // remisión comercial: no aplica
      const d = R.fechaReal(x, hoy);
      out.push({
        id: x.id, n: x.n, d: x.d || "", m: "fecha errada en el nombre",
        q: (x.d ? "El nombre del archivo trae la fecha " + x.d + ", posterior a hoy. " : "El nombre del archivo no trae una fecha AAMMDD válida. ") +
          (d ? "El documento dice " + d + "; se usó esa fecha para cruzar. " : "No se pudo cruzar con ningún equipo. ") + "Corregir el nombre del archivo en Drive.",
        p: [],
      });
      return;
    }
    if (used.has(x.id)) return;
    const r = R.scanIlegible(x, entrySet);
    if (r) out.push({ id: x.id, n: x.n, d: x.d, m: r.m, q: r.q, p: posibles(x, r.dg) });
  });
  return out.sort((a, b) => b.d.localeCompare(a.d));
}
