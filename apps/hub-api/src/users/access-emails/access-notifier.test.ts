import { describe, it, expect } from 'vitest';
import type { ResetLog } from '../password-reset/password-reset.service.js';
import { FakeMailer } from '../password-reset/test-fakes.js';
import type { UserStatus } from '../users.types.js';
import { AccessNotifier, toAccessUser, type AccessUser } from './access-notifier.js';

// Las reglas de los correos de acceso (spec 2026-11-20, §3 y §4.1) sin red: el
// mailer es el doble de la recuperación de contraseña (test-fakes.ts) y el log
// se apunta en una lista. Qué dice cada correo lo vigila access-emails.test.ts;
// aquí, cuándo sale, a quién y qué queda en el log.

const PORTAL = 'https://portal.ejemplo.test';

const cuenta = (status: UserStatus = 'active'): AccessUser => ({
  id: 'user-1',
  email: 'ana@ejemplo.test',
  fullName: 'Ana Ruiz',
  status,
});

function montar() {
  const mailer = new FakeMailer();
  const eventos: { event: string; data: Record<string, unknown> }[] = [];
  const log: ResetLog = (event, data = {}) => {
    eventos.push({ event, data });
  };
  return { mailer, eventos, notifier: new AccessNotifier({ mailer, portalUrl: PORTAL, log }) };
}

const omitido = (reason: string) => ({ event: 'user_access_email_skipped', data: { user_id: 'user-1', reason } });

describe('statusChanged', () => {
  it('desde pending → bienvenida a la propia cuenta, con sus apps', async () => {
    const { mailer, eventos, notifier } = montar();
    await notifier.statusChanged({ user: cuenta(), previousStatus: 'pending', apps: ['contabilidad'] });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].para).toBe('ana@ejemplo.test');
    expect(mailer.sent[0].asunto).toBe('Bienvenido al Portal Ambientalia');
    expect(mailer.sent[0].cuerpo).toContain(`<a href="${PORTAL}/contabilidad">Contabilidad</a>`);
    expect(eventos).toEqual([{ event: 'user_access_email_sent', data: { user_id: 'user-1', kind: 'welcome' } }]);
  });

  it('desde inactive → reactivación', async () => {
    const { mailer, eventos, notifier } = montar();
    await notifier.statusChanged({ user: cuenta(), previousStatus: 'inactive', apps: ['ausencias'] });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].asunto).toBe('Tu acceso al Portal Ambientalia está activo de nuevo');
    expect(mailer.sent[0].cuerpo).toContain(`<a href="${PORTAL}/ausencias">Vacaciones y Permisos</a>`);
    expect(eventos).toEqual([{ event: 'user_access_email_sent', data: { user_id: 'user-1', kind: 'reactivated' } }]);
  });

  it('desde active (el router lo trata como reactivación) → nada: no_transition', async () => {
    const { mailer, eventos, notifier } = montar();
    await notifier.statusChanged({ user: cuenta(), previousStatus: 'active', apps: ['ausencias'] });
    expect(mailer.sent).toEqual([]);
    expect(eventos).toEqual([omitido('no_transition')]);
  });

  it('lista solo las apps conocidas, en el orden del catálogo', async () => {
    const { mailer, notifier } = montar();
    await notifier.statusChanged({
      user: cuenta(),
      previousStatus: 'pending',
      apps: ['contabilidad', 'app-que-no-existe', 'payment-reconciliation'],
    });
    const { cuerpo } = mailer.sent[0];
    expect(cuerpo.indexOf('Conciliador de Pagos')).toBeGreaterThan(-1);
    expect(cuerpo.indexOf('Conciliador de Pagos')).toBeLessThan(cuerpo.indexOf('Contabilidad'));
    expect(cuerpo).not.toContain('app-que-no-existe');
  });

  it('sin apps, la bienvenida sale igual y dice que se le avisará', async () => {
    const { mailer, notifier } = montar();
    await notifier.statusChanged({ user: cuenta(), previousStatus: 'pending', apps: [] });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].cuerpo).toContain('Todavía no tienes aplicaciones asignadas');
  });
});

describe('appsChanged', () => {
  it('gana una app conocida con la cuenta activa → correo solo con la nueva', async () => {
    const { mailer, eventos, notifier } = montar();
    await notifier.appsChanged({ user: cuenta(), before: ['contabilidad'], after: ['ausencias', 'contabilidad'], isSelf: false });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].para).toBe('ana@ejemplo.test');
    expect(mailer.sent[0].asunto).toBe('Ya tienes acceso a Vacaciones y Permisos en el Portal Ambientalia');
    expect(mailer.sent[0].cuerpo).toContain(`${PORTAL}/ausencias`);
    expect(mailer.sent[0].cuerpo).not.toContain(`${PORTAL}/contabilidad`);
    expect(eventos).toEqual([{ event: 'user_access_email_sent', data: { user_id: 'user-1', kind: 'new_apps' } }]);
  });

  it('gana varias → asunto en plural, y las lista todas', async () => {
    const { mailer, notifier } = montar();
    await notifier.appsChanged({ user: cuenta(), before: [], after: ['ausencias', 'contabilidad'], isSelf: false });
    expect(mailer.sent[0].asunto).toBe('Tienes acceso a nuevas aplicaciones del Portal Ambientalia');
    expect(mailer.sent[0].cuerpo).toContain(`${PORTAL}/ausencias`);
    expect(mailer.sent[0].cuerpo).toContain(`${PORTAL}/contabilidad`);
  });

  it.each<[string, string[], string[]]>([
    ['quitar apps', ['ausencias', 'contabilidad'], ['contabilidad']],
    ['guardar la misma lista, aunque sea en otro orden', ['ausencias', 'contabilidad'], ['contabilidad', 'ausencias']],
    ['dejarla vacía', ['ausencias'], []],
  ])('%s → nada: no_new_apps', async (_caso, before, after) => {
    const { mailer, eventos, notifier } = montar();
    await notifier.appsChanged({ user: cuenta(), before, after, isSelf: false });
    expect(mailer.sent).toEqual([]);
    expect(eventos).toEqual([omitido('no_new_apps')]);
  });

  it.each(['pending', 'inactive'] as const)('con la cuenta %s → nada: not_active (no puede entrar)', async (status) => {
    const { mailer, eventos, notifier } = montar();
    await notifier.appsChanged({ user: cuenta(status), before: [], after: ['ausencias'], isSelf: false });
    expect(mailer.sent).toEqual([]);
    expect(eventos).toEqual([omitido('not_active')]);
  });

  it('en la propia cuenta del admin → nada: self', async () => {
    const { mailer, eventos, notifier } = montar();
    await notifier.appsChanged({ user: cuenta(), before: [], after: ['ausencias'], isSelf: true });
    expect(mailer.sent).toEqual([]);
    expect(eventos).toEqual([omitido('self')]);
  });

  it('si las nuevas son todas desconocidas → nada: no_known_apps', async () => {
    const { mailer, eventos, notifier } = montar();
    await notifier.appsChanged({ user: cuenta(), before: ['contabilidad'], after: ['contabilidad', 'app-que-no-existe'], isSelf: false });
    expect(mailer.sent).toEqual([]);
    expect(eventos).toEqual([omitido('no_known_apps')]);
  });

  it('una nueva conocida y otra desconocida → correo solo con la conocida, en singular', async () => {
    const { mailer, notifier } = montar();
    await notifier.appsChanged({ user: cuenta(), before: [], after: ['app-que-no-existe', 'calibraciones'], isSelf: false });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].asunto).toBe('Ya tienes acceso a Calibraciones en el Portal Ambientalia');
    expect(mailer.sent[0].cuerpo).not.toContain('app-que-no-existe');
  });
});

describe('nunca lanza', () => {
  it('si el mailer falla en la bienvenida, no se propaga y queda user_access_email_failed', async () => {
    const { mailer, eventos, notifier } = montar();
    mailer.fail = true;
    await expect(notifier.statusChanged({ user: cuenta(), previousStatus: 'pending', apps: [] })).resolves.toBeUndefined();
    expect(eventos).toEqual([
      { event: 'user_access_email_failed', data: { user_id: 'user-1', kind: 'welcome', motivo: 'n8n caído' } },
    ]);
  });

  it('lo mismo con el correo de apps nuevas', async () => {
    const { mailer, eventos, notifier } = montar();
    mailer.fail = true;
    await expect(
      notifier.appsChanged({ user: cuenta(), before: [], after: ['ausencias'], isSelf: false }),
    ).resolves.toBeUndefined();
    expect(eventos).toEqual([
      { event: 'user_access_email_failed', data: { user_id: 'user-1', kind: 'new_apps', motivo: 'n8n caído' } },
    ]);
  });
});

describe('nunca lanza: envío que falla de golpe', () => {
  // Un send NO async que lanza de forma síncrona: no devuelve promesa rechazada.
  function montarSincrono() {
    const eventos: { event: string; data: Record<string, unknown> }[] = [];
    const log: ResetLog = (event, data = {}) => {
      eventos.push({ event, data });
    };
    const mailer = {
      send: (): Promise<void> => {
        throw new Error('boom');
      },
    };
    return { eventos, notifier: new AccessNotifier({ mailer, portalUrl: PORTAL, log }) };
  }

  it('statusChanged desde pending: resuelve y deja una línea failed', async () => {
    const { eventos, notifier } = montarSincrono();
    await expect(notifier.statusChanged({ user: cuenta(), previousStatus: 'pending', apps: [] })).resolves.toBeUndefined();
    expect(eventos).toEqual([
      { event: 'user_access_email_failed', data: { user_id: 'user-1', kind: 'welcome', motivo: 'boom' } },
    ]);
    expect(JSON.stringify(eventos)).not.toContain('@');
  });

  it('appsChanged con app nueva: resuelve y deja una línea failed', async () => {
    const { eventos, notifier } = montarSincrono();
    await expect(
      notifier.appsChanged({ user: cuenta(), before: [], after: ['ausencias'], isSelf: false }),
    ).resolves.toBeUndefined();
    expect(eventos).toEqual([
      { event: 'user_access_email_failed', data: { user_id: 'user-1', kind: 'new_apps', motivo: 'boom' } },
    ]);
    expect(JSON.stringify(eventos)).not.toContain('@');
  });
});

describe('el log', () => {
  it('cada llamada deja exactamente una línea, siempre con el user_id y nunca con el correo', async () => {
    const { mailer, eventos, notifier } = montar();
    const llamadas = [
      () => notifier.statusChanged({ user: cuenta(), previousStatus: 'pending', apps: ['contabilidad'] }),
      () => notifier.statusChanged({ user: cuenta(), previousStatus: 'active', apps: [] }),
      () => notifier.appsChanged({ user: cuenta(), before: [], after: ['ausencias'], isSelf: false }),
      () => notifier.appsChanged({ user: cuenta(), before: [], after: ['ausencias'], isSelf: true }),
      async () => {
        mailer.fail = true;
        await notifier.appsChanged({ user: cuenta(), before: [], after: ['ausencias'], isSelf: false });
      },
    ];
    for (const [i, llamar] of llamadas.entries()) {
      await llamar();
      expect(eventos).toHaveLength(i + 1);
    }
    expect(eventos.every((e) => e.data.user_id === 'user-1')).toBe(true);
    expect(JSON.stringify(eventos)).not.toContain('@');
  });
});

describe('toAccessUser', () => {
  it('saca de la cuenta pública lo que el notificador necesita', () => {
    expect(
      toAccessUser({
        id: 'user-1',
        full_name: 'Ana Ruiz',
        email: 'ana@ejemplo.test',
        role: 'reader',
        status: 'active',
        created_at: '2026-11-20T15:00:00.000Z',
      }),
    ).toEqual({ id: 'user-1', email: 'ana@ejemplo.test', fullName: 'Ana Ruiz', status: 'active' });
  });
});
