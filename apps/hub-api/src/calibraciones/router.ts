import { Router, type Request, type Response } from 'express';
import type { Pool } from '@algarpibe/zoho-sync';
import { requireAuth, requireApp, getPayload } from '../auth.js';
import { captureError } from '../sentry.js';
import { hoyEnColombia } from '../ausencias/saldo.js';
import { permissionsOf } from './roles.js';
import * as service from './service.js';
import { CalError, isIsoDate, type Actor } from './types.js';

// Router of the «Calibraciones» app (O3 transfer standards). Mounted under /api.
//
// No cached(): transactional data. Permissions are checked by the service
// (before any query) with the role resolved here from portal.cal_user_roles.

export const APP_ID = 'calibraciones';

/**
 * CalError travels as-is (status, code, Spanish message, field, detail); any
 * other error is ours: generic 500 and Sentry, never internal details.
 */
function sendError(res: Response, e: unknown, ctx: string): void {
  if (e instanceof CalError) {
    res.status(e.status).json({ error: e.code, message: e.messageEs, field: e.field, detail: e.detail });
    return;
  }
  console.error(`${ctx} error`, e);
  captureError(e, { endpoint: ctx });
  res.status(500).json({ error: 'internal error' });
}

async function actorOf(db: Pool, req: Request): Promise<Actor> {
  const p = getPayload(req);
  const userId = p?.user_id ? String(p.user_id) : '';
  return {
    userId,
    email: String(p?.sub ?? '').toLowerCase(),
    role: await service.roleOf(db, userId || null),
    isPortalAdmin: p?.role === 'admin',
  };
}

/** ?today=YYYY-MM-DD override (reports as of a date); defaults to today in Colombia. */
function todayOf(req: Request): string {
  const t = req.query.today;
  if (t === undefined) return hoyEnColombia();
  if (!isIsoDate(t)) throw new CalError('invalid_input', 400, 'La fecha «today» no es válida (AAAA-MM-DD).', 'today');
  return t;
}

type Handler = (actor: Actor, req: Request) => Promise<unknown>;

export function createCalibracionesRouter(db: Pool): Router {
  const router = Router();
  const gated = [requireAuth, requireApp(APP_ID)] as const;

  /** Wraps a handler: resolves the actor, runs it, maps errors. */
  const route = (ctx: string, fn: Handler, status = 200) => async (req: Request, res: Response) => {
    try {
      const actor = await actorOf(db, req);
      const out = await fn(actor, req);
      if (out === undefined) res.status(204).end();
      else res.status(status).json(out);
    } catch (e) {
      sendError(res, e, ctx);
    }
  };

  // ── Roles ────────────────────────────────────────────────────────────────
  router.get(
    '/calibraciones/roles/me',
    ...gated,
    route('cal_roles_me', async (a) => ({
      userId: a.userId,
      email: a.email,
      role: a.role,
      permissions: permissionsOf(a.role),
      canManageRoles: a.isPortalAdmin,
    })),
  );
  router.get('/calibraciones/roles', ...gated, route('cal_roles_list', (a) => service.listRoles(db, a, APP_ID)));
  router.put(
    '/calibraciones/roles/:userId',
    ...gated,
    route('cal_roles_set', (a, req) => service.setRole(db, a, req.params.userId, req.body?.role)),
  );

  // ── Equipment ────────────────────────────────────────────────────────────
  router.get('/calibraciones/equipment', ...gated, route('cal_equipment_list', (_a, req) => service.listEquipment(db, todayOf(req))));
  router.post('/calibraciones/equipment', ...gated, route('cal_equipment_create', (a, req) => service.createEquipment(db, a, req.body), 201));
  router.get(
    '/calibraciones/equipment/:id',
    ...gated,
    route('cal_equipment_detail', (_a, req) => service.getEquipmentDetail(db, req.params.id, todayOf(req))),
  );
  router.patch(
    '/calibraciones/equipment/:id',
    ...gated,
    route('cal_equipment_update', (a, req) => service.updateEquipment(db, a, req.params.id, req.body)),
  );
  router.get(
    '/calibraciones/downstream-impact/:equipmentId',
    ...gated,
    route('cal_downstream', (_a, req) => service.downstreamImpact(db, req.params.equipmentId)),
  );
  router.get('/calibraciones/expirations', ...gated, route('cal_expirations', (_a, req) => service.expirations(db, todayOf(req))));

  // ── Verifications ────────────────────────────────────────────────────────
  router.get(
    '/calibraciones/verifications',
    ...gated,
    route('cal_verifications_list', (_a, req) => service.listVerifications(db, req.query as Record<string, unknown>)),
  );
  router.post(
    '/calibraciones/verifications',
    ...gated,
    route('cal_verifications_create', (a, req) => service.createVerification(db, a, req.body), 201),
  );
  router.get(
    '/calibraciones/verifications/:id',
    ...gated,
    route('cal_verifications_get', (_a, req) => service.getVerification(db, req.params.id)),
  );
  router.put(
    '/calibraciones/verifications/:id',
    ...gated,
    route('cal_verifications_update', (a, req) => service.updateVerification(db, a, req.params.id, req.body)),
  );
  router.delete(
    '/calibraciones/verifications/:id',
    ...gated,
    route('cal_verifications_delete', async (a, req) => {
      await service.deleteVerification(db, a, req.params.id);
      return undefined;
    }),
  );
  router.post(
    '/calibraciones/verifications/:id/calculate',
    ...gated,
    route('cal_verifications_calculate', (a, req) => service.calculate(db, a, req.params.id)),
  );
  router.post(
    '/calibraciones/verifications/:id/approve',
    ...gated,
    route('cal_verifications_approve', (a, req) => service.approve(db, a, req.params.id)),
  );
  router.post(
    '/calibraciones/verifications/:id/reject',
    ...gated,
    route('cal_verifications_reject', (a, req) => service.reject(db, a, req.params.id, req.body?.reason)),
  );
  router.post(
    '/calibraciones/verifications/:id/new-version',
    ...gated,
    route('cal_verifications_new_version', (a, req) => service.newVersion(db, a, req.params.id, req.body?.reason), 201),
  );
  router.post(
    '/calibraciones/verifications/:id/recalculate-check',
    ...gated,
    route('cal_verifications_recalc', (_a, req) => service.recalculateCheck(db, req.params.id)),
  );

  // ── Limits, config, audit ────────────────────────────────────────────────
  router.get(
    '/calibraciones/limits',
    ...gated,
    route('cal_limits_get', async () => ({ active: await service.getLimits(db), history: await service.listLimitSets(db) })),
  );
  router.put('/calibraciones/limits', ...gated, route('cal_limits_put', (a, req) => service.putLimits(db, a, req.body)));
  router.get('/calibraciones/config', ...gated, route('cal_config_get', () => service.getConfig(db)));
  router.put('/calibraciones/config', ...gated, route('cal_config_put', (a, req) => service.putConfig(db, a, req.body)));
  router.get(
    '/calibraciones/audit',
    ...gated,
    route('cal_audit', (_a, req) =>
      service.auditLog(
        db,
        typeof req.query.entity === 'string' ? req.query.entity : undefined,
        typeof req.query.entityId === 'string' ? req.query.entityId : undefined,
      ),
    ),
  );

  return router;
}
