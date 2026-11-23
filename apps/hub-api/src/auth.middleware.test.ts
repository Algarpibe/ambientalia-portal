import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import fc from 'fast-check';
import jwt from 'jsonwebtoken';

// Property tests de los middlewares de autorización (tasks 7.4 y 7.5).
// requireAuth/requireOwnerOrAdmin consultan la BD vía getHubPool(); mockeamos
// ./db.js para controlar qué devuelve findById sin una BD real.

const SECRET = 'test-secret-middlewares';
process.env.JWT_SECRET = SECRET;
process.env.AUTH_USERS = '';

// Estado compartido con el mock (vi.hoisted para que exista al construir el mock).
// `consultas` cuenta las idas a la BD: es lo que mide que una ruta que encadena
// `requireAuth, requireAdmin` consulte UNA vez y no dos.
const state = vi.hoisted(() => ({
  findByIdResult: null as Record<string, unknown> | null,
  consultas: 0,
}));

vi.mock('./db.js', () => ({
  getHubPool: () => ({
    query: async () => {
      state.consultas++;
      return {
        rows: state.findByIdResult ? [state.findByIdResult] : [],
        rowCount: state.findByIdResult ? 1 : 0,
      };
    },
    on: () => {},
  }),
}));

let auth: typeof import('./auth.js');
beforeAll(async () => {
  auth = await import('./auth.js');
});
beforeEach(() => {
  state.findByIdResult = null;
  state.consultas = 0;
});

function mockReq(headers: Record<string, string> = {}, params: Record<string, string> = {}) {
  const lower: Record<string, string> = {};
  for (const k in headers) lower[k.toLowerCase()] = headers[k];
  return { header: (n: string) => lower[n.toLowerCase()], params } as any;
}
function mockRes() {
  const res: any = { statusCode: 200, body: null };
  res.status = (c: number) => {
    res.statusCode = c;
    return res;
  };
  res.json = (o: any) => {
    res.body = o;
    return res;
  };
  return res;
}
async function run(mw: any, req: any) {
  const res = mockRes();
  let passed = false;
  await mw(req, res, () => {
    passed = true;
  });
  return { passed, status: res.statusCode, body: res.body };
}

function activeUser(id: string, role: 'admin' | 'reader' = 'reader') {
  return {
    id,
    full_name: 'X',
    email: 'x@x.com',
    password_hash: 'h',
    role,
    status: 'active',
    created_at: '2025-01-01T00:00:00.000Z',
    // SEC-224: requireAuth lee las apps de la BD, no del token. El mock de
    // ./db.js devuelve esta fila tal cual, así que sin este campo todo
    // requireApp daría 403 (que es el lado seguro, pero no lo que se prueba).
    apps: [] as string[],
  };
}
function tokenFor(userId: string, role: 'admin' | 'reader' = 'reader') {
  return jwt.sign({ sub: 'x@x.com', user_id: userId, role, apps: [] }, SECRET, { expiresIn: '1h' });
}

describe('requireAuth — chequeo de estado (task 7.4)', () => {
  // Feature: user-management, Property 6: JWT de usuario inactivo es rechazado
  // Validates: Requirements 2.4, 2.8
  it('rechaza con 401 cualquier usuario no activo, aun con JWT válido y no expirado', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), fc.constantFrom('pending', 'inactive'), async (userId, status) => {
        state.findByIdResult = { ...activeUser(userId), status };
        const req = mockReq({ authorization: `Bearer ${tokenFor(userId)}` });
        const { passed, status: code } = await run(auth.requireAuth, req);
        expect(passed).toBe(false);
        expect(code).toBe(401);
      }),
      { numRuns: 100 },
    );
  });

  it('deja pasar a un usuario activo (control)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), async (userId) => {
        state.findByIdResult = activeUser(userId);
        const req = mockReq({ authorization: `Bearer ${tokenFor(userId)}` });
        const { passed, status: code } = await run(auth.requireAuth, req);
        expect(passed).toBe(true);
        expect(code).toBe(200);
      }),
      { numRuns: 100 },
    );
  });

  it('rechaza con 401 si el usuario ya no existe en BD', async () => {
    const userId = '00000000-0000-4000-8000-000000000000';
    state.findByIdResult = null; // findById → null
    const req = mockReq({ authorization: `Bearer ${tokenFor(userId)}` });
    const { passed, status } = await run(auth.requireAuth, req);
    expect(passed).toBe(false);
    expect(status).toBe(401);
  });
});

describe('requireOwnerOrAdmin — límite propio/ajeno (task 7.5)', () => {
  // Feature: user-management, Property 11: Autorización lector respeta límite propio/ajeno
  // Validates: Requirements 3.5, 3.6
  it('reader: permite el recurso propio y bloquea (403) el ajeno', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), fc.uuid(), async (ownerId, otherId) => {
        fc.pre(ownerId !== otherId);
        state.findByIdResult = activeUser(ownerId, 'reader');
        const auth401Header = { authorization: `Bearer ${tokenFor(ownerId, 'reader')}` };

        // Recurso propio → permitido.
        const own = await run(auth.requireOwnerOrAdmin, mockReq(auth401Header, { id: ownerId }));
        expect(own.passed).toBe(true);

        // Recurso ajeno → 403.
        const other = await run(auth.requireOwnerOrAdmin, mockReq(auth401Header, { id: otherId }));
        expect(other.passed).toBe(false);
        expect(other.status).toBe(403);
      }),
      { numRuns: 100 },
    );
  });

  it('admin: permite acceder a un recurso ajeno', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), fc.uuid(), async (adminId, otherId) => {
        fc.pre(adminId !== otherId);
        state.findByIdResult = activeUser(adminId, 'admin');
        const req = mockReq({ authorization: `Bearer ${tokenFor(adminId, 'admin')}` }, { id: otherId });
        const { passed } = await run(auth.requireOwnerOrAdmin, req);
        expect(passed).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

describe('SEC-224 — el rol y las apps mandan desde la BD, no desde el JWT', () => {
  // El JWT dice QUIÉN eres y se firma una sola vez, en el login, con 30 días de
  // vida. Lo que puedes HACER tiene que salir de la fila de `portal.users` en
  // cada petición: si no, degradar a alguien o retirarle una app no surte
  // efecto hasta que el token expira. Los tres casos cubren las dos
  // direcciones del cambio, no solo la restrictiva.
  const USER_ID = '11111111-1111-1111-1111-111111111111';

  /** Token firmado con lo que el usuario ERA; la BD dirá lo que ES. */
  function tokenViejo(role: 'admin' | 'reader', apps: string[]) {
    return jwt.sign({ sub: 'x@x.com', user_id: USER_ID, role, apps }, SECRET, { expiresIn: '30d' });
  }

  it('CANDADO: un JWT con role admin cuyo usuario ya es reader recibe 403', async () => {
    state.findByIdResult = { ...activeUser(USER_ID, 'reader'), apps: [] };
    const req = mockReq({ authorization: `Bearer ${tokenViejo('admin', [])}` });
    const { passed, status } = await run(auth.requireAdmin, req);
    expect(passed).toBe(false);
    expect(status).toBe(403);
  });

  it('CANDADO: un JWT con la app contabilidad cuyo usuario ya no la tiene recibe 403', async () => {
    state.findByIdResult = { ...activeUser(USER_ID, 'reader'), apps: [] };
    const req = mockReq({ authorization: `Bearer ${tokenViejo('reader', ['contabilidad'])}` });

    // requireApp asume que requireAuth ya adjuntó req.user (así se montan las rutas).
    const previo = await run(auth.requireAuth, req);
    expect(previo.passed).toBe(true);

    const { passed, status } = await run(auth.requireApp('contabilidad'), req);
    expect(passed).toBe(false);
    expect(status).toBe(403);
  });

  it('CANDADO: un usuario ASCENDIDO a admin pasa requireAdmin con su token viejo', async () => {
    // La otra dirección: leer de la BD no puede significar "denegar más".
    state.findByIdResult = { ...activeUser(USER_ID, 'admin'), apps: [] };
    const req = mockReq({ authorization: `Bearer ${tokenViejo('reader', [])}` });
    const { passed } = await run(auth.requireAdmin, req);
    expect(passed).toBe(true);
  });

  it('CANDADO: una app CONCEDIDA después del login funciona con el token viejo', async () => {
    state.findByIdResult = { ...activeUser(USER_ID, 'reader'), apps: ['contabilidad'] };
    const req = mockReq({ authorization: `Bearer ${tokenViejo('reader', [])}` });

    const previo = await run(auth.requireAuth, req);
    expect(previo.passed).toBe(true);

    const { passed } = await run(auth.requireApp('contabilidad'), req);
    expect(passed).toBe(true);
  });
});

describe('SEC-220 — una sesión se puede invalidar antes de que expire el token', () => {
  // Hasta aquí nada podía matar un JWT: cambiar la contraseña no tocaba las
  // sesiones y el logout solo borraba localStorage, así que un token robado
  // sobrevivía a la reacción de la víctima durante todo el TTL. `token_version`
  // viaja firmada y se compara contra la fila que requireAuth ya lee.
  const USER_ID = '22222222-2222-4222-8222-222222222222';

  function tokenCon(token_version?: number) {
    const payload: Record<string, unknown> = { sub: 'x@x.com', user_id: USER_ID, role: 'reader', apps: [] };
    if (token_version !== undefined) payload.token_version = token_version;
    return mockReq({ authorization: `Bearer ${jwt.sign(payload, SECRET, { expiresIn: '7d' })}` });
  }

  it('CANDADO: un token con token_version antigua recibe 401', async () => {
    // La víctima cambió la contraseña (o cerró sesión): la fila va por la 1.
    state.findByIdResult = { ...activeUser(USER_ID), token_version: 1 };
    const { passed, status } = await run(auth.requireAuth, tokenCon(0));
    expect(passed).toBe(false);
    expect(status).toBe(401);
  });

  it('el token emitido DESPUÉS del cambio sigue funcionando', async () => {
    state.findByIdResult = { ...activeUser(USER_ID), token_version: 1 };
    const { passed, status } = await run(auth.requireAuth, tokenCon(1));
    expect(passed).toBe(true);
    expect(status).toBe(200);
  });

  // Compatibilidad hacia atrás: desplegar la migración 034 no puede desloguear
  // a nadie. Los tokens anteriores no llevan el campo y la columna vale 0 para
  // todo el mundo hasta el primer cambio de contraseña o logout.
  it('CANDADO: un token SIN token_version (anterior a la 034) sigue valiendo si la fila está en 0', async () => {
    state.findByIdResult = { ...activeUser(USER_ID), token_version: 0 };
    const { passed, status } = await run(auth.requireAuth, tokenCon(undefined));
    expect(passed).toBe(true);
    expect(status).toBe(200);
  });

  it('CANDADO: pero ese token viejo deja de valer en cuanto la fila avanza', async () => {
    state.findByIdResult = { ...activeUser(USER_ID), token_version: 1 };
    const { passed, status } = await run(auth.requireAuth, tokenCon(undefined));
    expect(passed).toBe(false);
    expect(status).toBe(401);
  });

  it('CANDADO: la comprobación es de igualdad, no de "mayor o igual" — una versión FUTURA tampoco pasa', async () => {
    // Un atacante que pudiera firmar tokens no debe poder saltarse la
    // invalidación futura poniendo un número alto.
    state.findByIdResult = { ...activeUser(USER_ID), token_version: 1 };
    const { passed, status } = await run(auth.requireAuth, tokenCon(99));
    expect(passed).toBe(false);
    expect(status).toBe(401);
  });
});

/**
 * Pasa la petición por varios middlewares como lo hace Express: cada uno recibe
 * como `next` la llamada al siguiente. Express no espera a los middlewares
 * asíncronos, así que aquí se guardan las promesas y se esperan todas: sin eso,
 * `requireAdmin` seguiría consultando cuando el test ya estuviera afirmando.
 */
async function encadenar(req: any, ...mws: any[]) {
  const res = mockRes();
  let passed = false;
  const pendientes: Promise<unknown>[] = [];
  const paso = (i: number): void => {
    if (i === mws.length) {
      passed = true;
      return;
    }
    pendientes.push(Promise.resolve(mws[i](req, res, () => paso(i + 1))));
  };
  paso(0);
  while (pendientes.length) await pendientes.shift();
  return { passed, status: res.statusCode, body: res.body };
}

describe('UNA consulta por petición aunque la ruta encadene requireAuth y requireAdmin', () => {
  // Las rutas de admin se declaran `requireAuth, requireAdmin`, y `requireAdmin`
  // vuelve a llamar a `requireAuth` por dentro para poder usarse también a
  // solas. Sin memoria por petición, cada una de esas rutas verificaba el JWT y
  // consultaba `portal.users` dos veces para decidir lo mismo.
  const USER_ID = '33333333-3333-4333-8333-333333333333';
  const conToken = (role: 'admin' | 'reader') =>
    mockReq({ authorization: `Bearer ${tokenFor(USER_ID, role)}` }, { id: USER_ID });

  it('requireAuth seguido de requireAdmin consulta la BD una sola vez y el admin pasa', async () => {
    state.findByIdResult = activeUser(USER_ID, 'admin');
    const { passed, status } = await encadenar(conToken('admin'), auth.requireAuth, auth.requireAdmin);
    expect(passed).toBe(true);
    expect(status).toBe(200);
    expect(state.consultas).toBe(1);
  });

  it('la misma cadena con alguien que ya no es admin da 403, también con una sola consulta', async () => {
    // El token aún dice admin; la fila dice reader. El segundo paso tiene que
    // decidir con lo que leyó el primero de la BD, no con lo firmado (SEC-224).
    state.findByIdResult = activeUser(USER_ID, 'reader');
    const { passed, status } = await encadenar(conToken('admin'), auth.requireAuth, auth.requireAdmin);
    expect(passed).toBe(false);
    expect(status).toBe(403);
    expect(state.consultas).toBe(1);
  });

  it('requireAuth seguido de requireOwnerOrAdmin también consulta una sola vez', async () => {
    state.findByIdResult = activeUser(USER_ID, 'reader');
    const { passed } = await encadenar(conToken('reader'), auth.requireAuth, auth.requireOwnerOrAdmin);
    expect(passed).toBe(true);
    expect(state.consultas).toBe(1);
  });

  it('CANDADO: dos peticiones distintas con el mismo token consultan cada una la suya', async () => {
    // Es memoria de UNA petición, no una caché: la siguiente vuelve a la BD y
    // ve lo que haya cambiado entre medias.
    const cabecera = { authorization: `Bearer ${tokenFor(USER_ID, 'admin')}` };
    state.findByIdResult = activeUser(USER_ID, 'admin');
    const primera = await encadenar(mockReq(cabecera), auth.requireAuth, auth.requireAdmin);
    expect(primera.passed).toBe(true);
    expect(state.consultas).toBe(1);

    // Entre una y otra, el admin desactiva la cuenta.
    state.findByIdResult = { ...activeUser(USER_ID, 'admin'), status: 'inactive' };
    const segunda = await encadenar(mockReq(cabecera), auth.requireAuth, auth.requireAdmin);
    expect(segunda.passed).toBe(false);
    expect(segunda.status).toBe(401);
    expect(state.consultas).toBe(2);
  });

  it('CANDADO: requireAdmin a solas sigue consultando y rechaza con 401 a un usuario inactivo', async () => {
    state.findByIdResult = { ...activeUser(USER_ID, 'admin'), status: 'inactive' };
    const { passed, status } = await run(auth.requireAdmin, conToken('admin'));
    expect(passed).toBe(false);
    expect(status).toBe(401);
    expect(state.consultas).toBe(1);
  });

  it('CANDADO: requireAdmin a solas rechaza con 401 una token_version que ya no es la de la fila', async () => {
    // El token no trae token_version (se lee como 0) y la fila ya va por la 1.
    state.findByIdResult = { ...activeUser(USER_ID, 'admin'), token_version: 1 };
    const { passed, status } = await run(auth.requireAdmin, conToken('admin'));
    expect(passed).toBe(false);
    expect(status).toBe(401);
    expect(state.consultas).toBe(1);
  });

  it('CANDADO: un req.user puesto por otro código no cuenta como petición verificada', async () => {
    // La marca de «ya verificada» no puede deducirse de `req.user`: cualquier
    // código puede escribirlo. Sin token, ni requireAuth ni requireAdmin dejan
    // pasar, por mucho que `req.user` diga admin.
    state.findByIdResult = activeUser(USER_ID, 'admin');
    const falsa = () => {
      const req = mockReq({}, { id: USER_ID });
      req.user = { sub: 'x@x.com', user_id: USER_ID, role: 'admin', apps: [] };
      return req;
    };
    const sinAuth = await run(auth.requireAuth, falsa());
    expect(sinAuth.passed).toBe(false);
    expect(sinAuth.status).toBe(401);
    const sinAdmin = await run(auth.requireAdmin, falsa());
    expect(sinAdmin.passed).toBe(false);
    expect(sinAdmin.status).toBe(401);
    const sinDueno = await run(auth.requireOwnerOrAdmin, falsa());
    expect(sinDueno.passed).toBe(false);
    expect(sinDueno.status).toBe(401);
  });

  it.each([
    ['el usuario está inactivo', { ...activeUser(USER_ID, 'admin'), status: 'inactive' }],
    ['la token_version ya no coincide', { ...activeUser(USER_ID, 'admin'), token_version: 1 }],
    ['el usuario ya no existe', null],
  ])('CANDADO: si el primer requireAuth falló porque %s, la petición no queda marcada', async (_causa, fila) => {
    // Solo se marca tras pasar TODAS las comprobaciones. Si la marca se pusiera
    // antes, una segunda llamada sobre la misma petición se saltaría la BD y
    // dejaría pasar lo que la primera rechazó.
    state.findByIdResult = fila;
    const req = conToken('admin');
    const primera = await run(auth.requireAuth, req);
    expect(primera.passed).toBe(false);
    expect(primera.status).toBe(401);
    expect(state.consultas).toBe(1);

    state.findByIdResult = activeUser(USER_ID, 'admin');
    const segunda = await run(auth.requireAuth, req);
    expect(segunda.passed).toBe(true);
    expect(state.consultas).toBe(2);
  });
});
