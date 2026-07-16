import { Router, type Request, type Response } from 'express';
import type { Pool } from '@algarpibe/zoho-sync';
import { requireAuth, requireApp, requireCronToken } from '../auth.js';
import { captureError } from '../sentry.js';
import { buildWorldOfficeCsv } from './builder.js';
import { buildWorldOfficeXlsx } from './xlsx.js';
import { createHubSalesOrderSource } from './hub.source.js';
import { DEFAULT_CONFIG } from './config.js';
import type { SalesOrderFiltro } from './source.js';
import type { Warning } from './types.js';
import { computarPendiente, confirmarEnvio } from './email.js';
import { listarDestinatarios, crearDestinatario, setActivo, borrarDestinatario } from './email.repo.js';

// Router de WO-sales, montado bajo `/api` (ver index.ts). Expone la vista previa y
// la descarga del CSV que World Office importa como pedidos.
//
// NO se usa cached() aquí, a diferencia del resto de endpoints de datos, y no es un
// olvido: el archivo tiene que reflejar la última OV. Una caché de 120s puede
// entregar un CSV desactualizado que alguien sube a World Office, reservando mal el
// inventario y bloqueando una facturación. No añadir caché.

const APP_ID = 'WO-sales';

/** La zona de la operación. El servidor corre en UTC; ver `hoyEnBogota`. */
const TZ = 'America/Bogota';

/** Traduce a HTTP. Igual que en users.router.ts: index.ts tiene su propio sendError
 *  pero es local al módulo (no exportado), así que cada router lleva el suyo. */
function sendError(res: Response, e: unknown, ctx: string): void {
  console.error(`${ctx} error`, e);
  captureError(e, { endpoint: ctx });
  res.status(500).json({ error: 'internal error' });
}

/**
 * "Hoy" en Colombia, YYYY-MM-DD. NO vale `new Date().getFullYear()` ni
 * `toISOString()`: el servidor corre en UTC y Colombia es UTC-5, así que a partir de
 * las 19:00 hora local ambos ya están en el día siguiente. Con el año eso no es
 * cosmético — el 31 de diciembre a las 19:00 el rango por defecto saltaría al año
 * entrante y el CSV saldría VACÍO (y todas las OV vivas se reportarían como
 * antiguas), justo el día en que se está cerrando la facturación del año.
 */
function hoyEnBogota(ahora: Date): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(ahora);
  const parte = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? '';
  return `${parte('year')}-${parte('month')}-${parte('day')}`;
}

/** Por defecto, el año actual: las OV de 2021/2025 que siguen "open" son casi seguro
 *  abandonadas, y un pedido obsoleto cargado en WO reserva inventario y puede
 *  bloquear una facturación urgente. Se pueden incluir ampliando el rango. */
function rangoPorDefecto(hoyIso: string): { desde: string; hasta: string } {
  const anio = hoyIso.slice(0, 4);
  return { desde: `${anio}-01-01`, hasta: `${anio}-12-31` };
}

/**
 * Fecha de calendario real, no solo con forma de fecha. El chequeo de forma por sí
 * solo deja pasar "2026-13-45" y "2026-02-30" hasta el `$2::date` del SQL, que
 * revienta la consulta y devuelve un 500 genérico por lo que en realidad es un error
 * del que llama.
 */
function esFechaValida(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

type FiltroResult =
  | { ok: true; filtro: SalesOrderFiltro }
  | { ok: false; error: string; field: string };

/**
 * Lee el filtro de la query. Un parámetro AUSENTE cae al rango por defecto (el que
 * llama no ha opinado); un parámetro PRESENTE pero inválido es un 400.
 *
 * La diferencia importa: si "from=ayer" cayera en silencio al año completo, el
 * usuario pediría un rango, recibiría otro y no se enteraría — creyendo que el
 * archivo cubre lo que pidió. Ese CSV se sube a World Office y reserva inventario de
 * pedidos que el usuario nunca quiso incluir. Un 400 se corrige en diez segundos; un
 * archivo que miente no se detecta hasta que el inventario ya está mal.
 */
function leerFiltro(q: Record<string, unknown>, hoyIso: string): FiltroResult {
  const def = rangoPorDefecto(hoyIso);

  const leerFecha = (v: unknown, campo: string): { valor?: string; error?: string } => {
    if (v === undefined) return {};
    if (typeof v !== 'string' || !esFechaValida(v)) return { error: campo };
    return { valor: v };
  };

  const from = leerFecha(q.from, 'from');
  if (from.error) return { ok: false, error: 'invalid_date', field: from.error };
  const to = leerFecha(q.to, 'to');
  if (to.error) return { ok: false, error: 'invalid_date', field: to.error };

  const desde = from.valor ?? def.desde;
  const hasta = to.valor ?? def.hasta;

  // Rango invertido: Postgres no falla, simplemente no devuelve filas. El usuario se
  // llevaría un CSV vacío y bien formado (y una lista enorme de "OV antiguas", porque
  // ordenesAntiguas solo mira `desde`) sin ninguna pista de que el rango está al
  // revés. Es un error del que llama y se dice como tal.
  if (desde > hasta) return { ok: false, error: 'invalid_range', field: 'to' };

  return {
    ok: true,
    filtro: {
      desde,
      hasta,
      cliente: typeof q.cliente === 'string' && q.cliente.trim() ? q.cliente.trim() : undefined,
    },
  };
}

function nombreArchivo(hoyIso: string, ext: 'csv' | 'xls'): string {
  return `DocumentosVentasEncabezadosMovimientoInventarioWO_${hoyIso}.${ext}`;
}

export function createWoSalesRouter(db: Pool): Router {
  const router = Router();
  const source = createHubSalesOrderSource(db, DEFAULT_CONFIG);

  router.get('/wo-sales/preview', requireAuth, requireApp(APP_ID), async (req: Request, res: Response) => {
    try {
      const leido = leerFiltro(req.query as Record<string, unknown>, hoyEnBogota(new Date()));
      if (!leido.ok) return void res.status(400).json({ error: leido.error, field: leido.field });
      const { filtro } = leido;

      const [ordenes, antiguas] = await Promise.all([
        source.ordenesVivas(filtro),
        source.ordenesAntiguas(filtro),
      ]);
      const { warnings, filas } = buildWorldOfficeCsv(ordenes, DEFAULT_CONFIG);
      // Las OV vivas anteriores al rango no entran al archivo, pero se listan: son
      // pedidos que llevan años sin cerrarse y alguien tiene que mirarlos.
      const avisosAntiguas: Warning[] = antiguas.map((o) => ({
        tipo: 'ov_antigua',
        orden: o.numero,
        mensaje: `Sigue viva desde ${o.fecha} (${o.clienteNombre ?? 'sin cliente'}) y quedó fuera del rango. ¿Abandonada en Zoho?`,
      }));
      res.json({ filtro, ordenes, warnings: [...warnings, ...avisosAntiguas], filas });
    } catch (e) {
      sendError(res, e, 'wo_sales_preview');
    }
  });

  router.get('/wo-sales/csv', requireAuth, requireApp(APP_ID), async (req: Request, res: Response) => {
    try {
      const hoyIso = hoyEnBogota(new Date());
      const leido = leerFiltro(req.query as Record<string, unknown>, hoyIso);
      if (!leido.ok) return void res.status(400).json({ error: leido.error, field: leido.field });

      const ordenes = await source.ordenesVivas(leido.filtro);
      const { csv, warnings } = buildWorldOfficeCsv(ordenes, DEFAULT_CONFIG);
      res.setHeader('Content-Type', 'text/csv; charset=windows-1252');
      res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo(hoyIso, 'csv')}"`);
      // El mismo motivo por el que no se usa cached(): un CSV desactualizado subido al
      // ERP reserva inventario mal. Sin esto, el navegador puede cachear este GET por
      // heurística y devolver el archivo de hace un rato.
      res.setHeader('Cache-Control', 'no-store');
      // Las advertencias son el cortafuegos entre un dato malo de Zoho y un pedido mal
      // cargado en el ERP, pero este endpoint es accesible sin pasar por /preview. No
      // se puede exigir "ya las viste" sin guardar estado, así que al menos el número
      // viaja con la descarga: la UI debe pasar por /preview y avisar si no es 0.
      // OJO: cuenta solo los avisos del builder, que son los del archivo. /preview
      // devuelve además los 'ov_antigua', que por definición NO están en el CSV — por
      // eso los dos números no coinciden, y es correcto que no coincidan.
      // Ambas cabeceras requieren exposedHeaders en el CORS de index.ts para que el
      // navegador deje leerlas desde JavaScript.
      res.setHeader('X-WO-Sales-Warnings', String(warnings.length));
      res.send(csv);
      // Fase 2: aquí engancha el envío por correo a Xiomara y Marcela, después del
      // build y sin tocarlo.
    } catch (e) {
      sendError(res, e, 'wo_sales_csv');
    }
  });

  // Mismo archivo que /csv pero como .xls binario real (BIFF8), que es lo que la
  // muestra de World Office usa: 57 columnas con celdas tipadas (fechas como serial,
  // importes como número). Se construye desde la MISMA matriz del builder, así que
  // .csv y .xls siempre coinciden en contenido.
  router.get('/wo-sales/xlsx', requireAuth, requireApp(APP_ID), async (req: Request, res: Response) => {
    try {
      const hoyIso = hoyEnBogota(new Date());
      const leido = leerFiltro(req.query as Record<string, unknown>, hoyIso);
      if (!leido.ok) return void res.status(400).json({ error: leido.error, field: leido.field });

      const ordenes = await source.ordenesVivas(leido.filtro);
      const { matriz, warnings } = buildWorldOfficeCsv(ordenes, DEFAULT_CONFIG);
      const xls = buildWorldOfficeXlsx(matriz);
      res.setHeader('Content-Type', 'application/vnd.ms-excel');
      res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo(hoyIso, 'xls')}"`);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-WO-Sales-Warnings', String(warnings.length));
      res.send(xls);
    } catch (e) {
      sendError(res, e, 'wo_sales_xlsx');
    }
  });

  const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

  // ── Para n8n (auth por token de cron, no JWT) ──
  router.get('/wo-sales/email/pendiente', requireCronToken, async (_req: Request, res: Response) => {
    try {
      const hoyIso = hoyEnBogota(new Date());
      const filtro: SalesOrderFiltro = { ...rangoPorDefecto(hoyIso) };
      const pendiente = await computarPendiente(db, source, DEFAULT_CONFIG, filtro, nombreArchivo(hoyIso, 'xls'));
      res.json(pendiente);
    } catch (e) {
      sendError(res, e, 'wo_sales_email_pendiente');
    }
  });

  router.post('/wo-sales/email/confirmado', requireCronToken, async (req: Request, res: Response) => {
    try {
      const token = (req.body as { token?: string } | undefined)?.token;
      if (!token) return void res.status(400).json({ error: 'missing token' });
      await confirmarEnvio(db, token);
      res.json({ ok: true });
    } catch (e) {
      sendError(res, e, 'wo_sales_email_confirmado');
    }
  });

  // ── CRUD de destinatarios (auth por app) ──
  router.get('/wo-sales/destinatarios', requireAuth, requireApp(APP_ID), async (_req, res) => {
    try {
      res.json(await listarDestinatarios(db));
    } catch (e) {
      sendError(res, e, 'wo_sales_destinatarios_list');
    }
  });

  router.post('/wo-sales/destinatarios', requireAuth, requireApp(APP_ID), async (req, res) => {
    try {
      const { email, nombre } = (req.body ?? {}) as { email?: string; nombre?: string };
      if (!email || !EMAIL.test(email)) return void res.status(400).json({ error: 'email inválido' });
      if (!nombre?.trim()) return void res.status(400).json({ error: 'falta el nombre' });
      res.status(201).json(await crearDestinatario(db, email.trim(), nombre.trim()));
    } catch (e) {
      sendError(res, e, 'wo_sales_destinatarios_create');
    }
  });

  router.patch('/wo-sales/destinatarios/:id', requireAuth, requireApp(APP_ID), async (req, res) => {
    try {
      const activo = (req.body as { activo?: unknown } | undefined)?.activo;
      if (typeof activo !== 'boolean') return void res.status(400).json({ error: 'activo debe ser boolean' });
      const r = await setActivo(db, req.params.id, activo);
      if (!r) return void res.status(404).json({ error: 'no existe' });
      res.json(r);
    } catch (e) {
      sendError(res, e, 'wo_sales_destinatarios_patch');
    }
  });

  router.delete('/wo-sales/destinatarios/:id', requireAuth, requireApp(APP_ID), async (req, res) => {
    try {
      const ok = await borrarDestinatario(db, req.params.id);
      if (!ok) return void res.status(404).json({ error: 'no existe' });
      res.status(204).end();
    } catch (e) {
      sendError(res, e, 'wo_sales_destinatarios_delete');
    }
  });

  return router;
}
