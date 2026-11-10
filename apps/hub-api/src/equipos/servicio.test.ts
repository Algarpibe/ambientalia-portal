import { describe, expect, it } from 'vitest';
import { crearServicioEquipos, vigilarFuentes, type FuentesCorrida } from './servicio.js';
import { ErrorDrive, type FuenteDrive } from './fuente-drive.js';
import { SinDesk2, type FuenteDesk2 } from './fuente-desk2.js';
import { CV, EST, type CacheEscaneos, type Foto, type RemisionEntrada } from './nucleo/index.js';
import { CorridaCerrada, type RepoEquipos, type CorridaBuena } from './repo.js';
import type { Corrida, Incidente } from './contrato.js';
import type { DecisionIncidente } from './incidente.js';
import type { CanalAlerta, CorreoAlerta } from './alerta.js';

// Una corrida de punta a punta con un repositorio EN MEMORIA y fuentes simuladas:
// candado, Desk 2.0 → Drive → núcleo → foto, y el incidente con su alerta. El SQL del
// repositorio: repo.db.test.ts. Todo ficticio.
const FOTO_VIEJA: Foto = { at: '2026-11-08T11:35:00.000Z', hoy: '2026-11-08', rows: [], ilegibles: [] };

function repoEnMemoria() {
  const s = {
    foto: FOTO_VIEJA as Foto | null,
    exits: null as CacheEscaneos | null,
    cacheEnt: {} as Record<string, RemisionEntrada>,
    enCurso: false,
    corridas: [] as Corrida[],
    incidente: null as Incidente | null,
    correos: ['jefe@ambientalia.com.co'],
    alertas: [] as { id: number; ok: boolean }[],
  };
  let n = 0;
  const cerrar = (id: number, ok: boolean, causa: string | null, extra: Partial<Corrida> = {}) => {
    s.enCurso = false;
    const c = s.corridas.find((x) => x.id === id)!;
    Object.assign(c, { enCurso: false, ok, causa, fin: '2026-11-10T11:40:00.000Z', ...extra });
  };
  const repo: RepoEquipos = {
    iniciarCorrida: async (origen) => {
      if (s.enCurso) return null;
      s.enCurso = true;
      s.corridas.push({ id: ++n, origen, inicio: '', fin: null, enCurso: true, ok: null, causa: null, avisos: [], conteos: null });
      return n;
    },
    leerCaches: async () => ({ exits: s.exits, ent: s.cacheEnt }),
    terminarBien: async (id, r: CorridaBuena) => { s.foto = r.foto; s.exits = r.exits; s.cacheEnt = r.ent; cerrar(id, true, null, { avisos: r.avisos, conteos: r.conteos }); },
    terminarMal: async (id, causa, exits) => { if (exits) s.exits = exits; cerrar(id, false, causa); },
    leerFoto: async () => s.foto,
    leerAjustes: async () => ({}),
    guardarAjuste: async () => { throw new Error('no se usa'); },
    borrarAjuste: async () => {},
    ultimaCorrida: async () => s.corridas.at(-1) ?? null,
    ultimaCorridaBuena: async () => [...s.corridas].reverse().find((c) => c.ok) ?? null,
    ultimaCorridaTerminada: async () => [...s.corridas].reverse().find((c) => !c.enCurso) ?? null,
    incidenteAbierto: async () => s.incidente,
    aplicarIncidente: async (d: DecisionIncidente) => {
      if (d.accion === 'abrir') s.incidente = { id: 1, abiertoEn: '', fallosProgramados: d.fallosProgramados, alertaEnviadaEn: null, alertaUltimoError: null };
      else if (d.accion === 'cerrar') s.incidente = null;
      else if (d.accion === 'contar' && s.incidente) s.incidente.fallosProgramados = d.fallosProgramados;
      return s.incidente?.id ?? null;
    },
    marcarAlerta: async (id, r) => {
      s.alertas.push({ id, ok: r.ok });
      if (s.incidente) Object.assign(s.incidente, r.ok ? { alertaEnviadaEn: 'ya' } : { alertaUltimoError: r.error });
    },
    correosAlerta: async () => s.correos,
    llavesDe: async () => ({ editaAjustes: false, recibeAlertas: false }),
    listarLlaves: async () => [],
    guardarLlaves: async () => null,
  };
  return { repo, s };
}

const block = (sn: string) => 'REMISIÓN DE SERVICIO TÉCNICO\n\n\\#S/N\n\nEDM180C\n\nGrimm\n\n' + sn + '\n';
function fuentes(
  o: {
    textoPdf?: (id: string) => Promise<string>;
    sonda?: () => Promise<{ total: number; conCf: number }>;
    tickets?: FuenteDesk2['tickets'];
    limpiarTemporal?: FuenteDrive['limpiarTemporal'];
    copiasSinBorrar?: () => number;
  } = {},
): FuentesCorrida {
  const drive: FuenteDrive = {
    entradas: async () => [{ id: 'E1', title: '261101 - CLIENTE A - 18A90001' }, { id: 'E2', title: '260901 - CLIENTE B - 18A90002' }],
    salidasGeneradas: async () => [],
    salidasEscaneadas: async () => [{ id: 'S1', title: '260915 - CLIENTE B.pdf' }, { id: 'S2', title: '261020 - CLIENTE C.pdf' }],
    textoPdf: o.textoPdf ?? (async (id) => (id === 'S1' ? block('18A90002') : '')),
    remisionEntrada: async () => '',
    limpiarTemporal: o.limpiarTemporal ?? (async () => ({ borradas: 0, fallidas: 0 })),
    copiasSinBorrar: o.copiasSinBorrar ?? (() => 0),
  };
  const desk2: FuenteDesk2 = {
    sonda: o.sonda ?? (async () => ({ total: 3, conCf: 3 })),
    tickets: o.tickets ?? (async () => []),
    ticketNumero: async () => [],
    comentarios: async () => [],
  };
  return { drive, desk2 };
}
function canalFalso(ok = true) {
  const enviados: { correo: CorreoAlerta; ref: number }[] = [];
  const canal: CanalAlerta = { encendido: true, enviar: async (correo, ref) => { enviados.push({ correo, ref }); return ok ? { ok: true } : { ok: false, error: 'n8n respondió 500' }; } };
  return { canal, enviados };
}
const crear = (f: () => FuentesCorrida, repo: RepoEquipos, canal = canalFalso().canal) =>
  crearServicioEquipos({ repo, fuentes: f, canal, reserva: 'comercial@ambientalia.com.co', log: () => {}, hoy: () => '2026-11-10' });

describe('una corrida buena', () => {
  it('escribe la foto con sus conteos y la caché de OCR', async () => {
    const { repo, s } = repoEnMemoria();
    const r = await crear(() => fuentes(), repo).ejecutar('boton', null);
    expect(r).toMatchObject({ estado: 'ok', conteos: { en_taller: 1, remisiones_ilegibles: 1 } });
    expect(s.foto?.rows.map((x) => x.sn + ':' + x.est).sort()).toEqual(['18A90001:' + EST.TALLER, '18A90002:' + EST.ENTREGADO]);
    expect(s.exits?.v).toBe(CV);
    expect(s.corridas[0]).toMatchObject({ ok: true, causa: null });
  });

  it('avisa (sin fallar) de los tickets de Desk 2.0 que no traen raw.cf', async () => {
    const { repo } = repoEnMemoria();
    const r = await crear(() => fuentes({ sonda: async () => ({ total: 10, conCf: 7 }) }), repo).ejecutar('boton', null);
    expect(r.estado === 'ok' && r.avisos).toContain('3 tickets de Desk 2.0 sin campos personalizados (raw.cf): se usan solo sus columnas');
  });
});

describe('una corrida fallida', () => {
  it('si falla Desk 2.0 no toca la foto ni lee Drive', async () => {
    const { repo, s } = repoEnMemoria();
    let leyoDrive = false;
    const f = fuentes({ sonda: async () => { throw new SinDesk2(); } });
    f.drive.entradas = async () => { leyoDrive = true; return []; };
    expect(await crear(() => f, repo).ejecutar('programada', null)).toEqual({ estado: 'error', causa: 'desk2: sin configurar' });
    expect(s.foto).toBe(FOTO_VIEJA);
    expect(leyoDrive).toBe(false);
  });

  it('si Desk 2.0 falla a mitad (un serial), la corrida falla aunque el núcleo siga', async () => {
    const { repo, s } = repoEnMemoria();
    const f = fuentes({ tickets: async () => { throw Object.assign(new Error('pg: host secreto'), { code: '57014' }); } });
    expect(await crear(() => f, repo).ejecutar('programada', null)).toEqual({ estado: 'error', causa: 'desk2: tiempo agotado' });
    expect(s.foto).toBe(FOTO_VIEJA);
  });

  it('si Drive falla de verdad (5xx) en un PDF, no toca la foto pero SÍ guarda el OCR que ya salió', async () => {
    const { repo, s } = repoEnMemoria();
    const f = fuentes({ textoPdf: async (id) => { if (id === 'S2') throw new ErrorDrive(500); return block('18A90002'); } });
    expect(await crear(() => f, repo).ejecutar('boton', null)).toEqual({ estado: 'error', causa: 'drive: HTTP 500' });
    expect(s.foto).toBe(FOTO_VIEJA);
    expect(s.exits?.list.map((x) => x.id)).toEqual(['S1']);
  });

  it('si TODOS los PDF intentados fallan al pasarlos a texto (2 o más), es un problema de Drive: la corrida falla', async () => {
    const { repo, s } = repoEnMemoria();
    const f = fuentes({ textoPdf: async () => { throw new ErrorDrive(403); } });
    expect(await crear(() => f, repo).ejecutar('boton', null)).toEqual({ estado: 'error', causa: 'drive: no se pudo convertir ningún PDF (HTTP 403)' });
    expect(s.foto).toBe(FOTO_VIEJA);
  });
});

describe('un PDF que Drive no puede convertir (A9)', () => {
  it('la corrida sigue; ese PDF va a ilegibles y NO entra en la caché (se reintenta en la siguiente)', async () => {
    const { repo, s } = repoEnMemoria();
    const f = fuentes({ textoPdf: async (id) => { if (id === 'S2') throw new ErrorDrive(400); return block('18A90002'); } });
    const r = await crear(() => f, repo).ejecutar('boton', null);
    expect(r).toMatchObject({ estado: 'ok', conteos: { remisiones_ilegibles: 1 } });
    expect(s.foto?.ilegibles).toContainEqual({
      id: 'S2',
      n: '261020 - CLIENTE C.pdf',
      d: '2026-10-20',
      m: 'sin texto legible',
      q: 'Google Drive no pudo convertir este PDF a texto (HTTP 400): revisar el archivo en Drive',
      p: [],
    });
    expect(s.exits?.list.map((x) => x.id)).toEqual(['S1']);
  });

  it('en la siguiente corrida se vuelve a intentar y, si ya sale, deja de ser ilegible por ese motivo', async () => {
    const { repo, s } = repoEnMemoria();
    let roto = true;
    const f = () => fuentes({ textoPdf: async (id) => { if (id === 'S2' && roto) throw new ErrorDrive(400); return block(id === 'S2' ? '18A90001' : '18A90002'); } });
    await crear(f, repo).ejecutar('boton', null);
    roto = false;
    await crear(f, repo).ejecutar('boton', null);
    expect(s.foto?.ilegibles?.some((x) => x.id === 'S2')).toBe(false);
    expect(s.exits?.list.map((x) => x.id).sort()).toEqual(['S1', 'S2']);
  });
});

describe('copias temporales del OCR', () => {
  it('limpia la carpeta temporal tras la sonda y ANTES de leer Drive', async () => {
    const { repo } = repoEnMemoria();
    const orden: string[] = [];
    const f = fuentes({ sonda: async () => { orden.push('sonda'); return { total: 1, conCf: 1 }; }, limpiarTemporal: async () => { orden.push('limpiar'); return { borradas: 2, fallidas: 0 }; } });
    const entradas = f.drive.entradas;
    f.drive.entradas = async () => { orden.push('drive'); return entradas(); };
    await crear(() => f, repo).ejecutar('boton', null);
    expect(orden.slice(0, 3)).toEqual(['sonda', 'limpiar', 'drive']);
  });

  it('si el barrido falla, la corrida falla con «drive: <motivo>», sin leer Drive ni tocar la foto', async () => {
    const { repo, s } = repoEnMemoria();
    let leyoDrive = false;
    const f = fuentes({ limpiarTemporal: async () => { throw Object.assign(new ErrorDrive(403), { message: 'cuerpo secreto' }); } });
    f.drive.entradas = async () => { leyoDrive = true; return []; };
    expect(await crear(() => f, repo).ejecutar('boton', null)).toEqual({ estado: 'error', causa: 'drive: HTTP 403' });
    expect(leyoDrive).toBe(false);
    expect(s.foto).toBe(FOTO_VIEJA);
  });

  it('si el barrido no pudo borrar alguna, la corrida sigue y lo avisa', async () => {
    const { repo } = repoEnMemoria();
    const r = await crear(() => fuentes({ limpiarTemporal: async () => ({ borradas: 1, fallidas: 2 }) }), repo).ejecutar('boton', null);
    expect(r.estado === 'ok' && r.avisos).toContain('2 copias temporales del OCR no se pudieron borrar (carpeta temporal)');
  });

  it('si en esta corrida quedaron copias sin borrar, una corrida buena lo avisa', async () => {
    const { repo } = repoEnMemoria();
    const r = await crear(() => fuentes({ copiasSinBorrar: () => 3 }), repo).ejecutar('boton', null);
    expect(r.estado === 'ok' && r.avisos).toContain('3 copias temporales del OCR no se pudieron borrar; se reintentará en la próxima corrida');
  });
});

describe('candado', () => {
  it('con una corrida en curso, la segunda responde «ocupado»; al terminar, se suelta', async () => {
    const { repo } = repoEnMemoria();
    let soltar: () => void = () => {};
    const espera = new Promise<void>((r) => (soltar = r));
    const f = fuentes();
    const listar = f.drive.salidasEscaneadas;
    f.drive.salidasEscaneadas = async () => { await espera; return listar(); };
    const srv = crear(() => f, repo);
    expect(await srv.lanzar('boton', null)).toBe('iniciada');
    expect(srv.actualizando()).toBe(true);
    expect(await srv.lanzar('boton', null)).toBe('ocupado');
    expect(await srv.ejecutar('programada', null)).toEqual({ estado: 'ocupado' });
    soltar();
    await srv.enCurso();
    expect(srv.actualizando()).toBe(false);
    expect(await srv.lanzar('boton', null)).toBe('iniciada');
    await srv.enCurso();
  });

  it('sin Drive configurado, «sin_configurar» y no se registra ninguna corrida', async () => {
    const { repo, s } = repoEnMemoria();
    const srv = crearServicioEquipos({ repo, fuentes: null, canal: canalFalso().canal, reserva: 'x@ambientalia.com.co', log: () => {} });
    expect(srv.configurado()).toBe(false);
    expect(await srv.lanzar('boton', null)).toBe('sin_configurar');
    expect(s.corridas).toEqual([]);
  });
});

describe('incidente y alerta', () => {
  const caida = () => fuentes({ sonda: async () => { throw Object.assign(new Error('x'), { code: 'ECONNREFUSED' }); } });
  it('1 fallo programado no avisa; el 2.º sí, a los correos con la llave; el 3.º ya no', async () => {
    const { repo, s } = repoEnMemoria();
    const { canal, enviados } = canalFalso();
    const srv = crear(caida, repo, canal);
    await srv.ejecutar('programada', null);
    expect(enviados).toHaveLength(0);
    await srv.ejecutar('programada', null);
    expect(enviados).toHaveLength(1);
    expect(enviados[0].correo.para).toEqual(['jefe@ambientalia.com.co']);
    expect(enviados[0].correo.cuerpo).toMatch(/desk2: sin conexión/);
    await srv.ejecutar('programada', null);
    expect(enviados).toHaveLength(1);
    expect(s.incidente?.fallosProgramados).toBe(3);
  });

  it('si el webhook falla, se apunta el error y la siguiente programada lo reintenta; una buena cierra', async () => {
    const { repo, s } = repoEnMemoria();
    s.correos = [];
    const malo = canalFalso(false);
    const srv = crear(caida, repo, malo.canal);
    await srv.ejecutar('programada', null);
    await srv.ejecutar('programada', null);
    expect(s.incidente?.alertaUltimoError).toBe('n8n respondió 500');
    expect(malo.enviados[0].correo.para).toEqual(['comercial@ambientalia.com.co']);
    await srv.ejecutar('programada', null);
    expect(malo.enviados).toHaveLength(2);
    await crear(() => fuentes(), repo, malo.canal).ejecutar('boton', null);
    expect(s.incidente).toBeNull();
  });
});

describe('vigilarFuentes', () => {
  it('apunta la primera causa de cada origen y Desk 2.0 manda sobre Drive', async () => {
    const f = fuentes({ tickets: async () => { throw Object.assign(new Error('x'), { code: '42501' }); } });
    f.drive.salidasEscaneadas = async () => { throw new ErrorDrive(403); };
    const v = vigilarFuentes(f);
    await v.fuentes.salidasEscaneadas().catch(() => {});
    expect(v.fallo()).toBe('drive: HTTP 403');
    await v.fuentes.tickets('18A90001').catch(() => {});
    expect(v.fallo()).toBe('desk2: consulta rechazada (permisos o esquema)');
  });

  it('un 4xx al convertir UN PDF es del archivo: no es fallo de la corrida y sale en pdfsSinTexto con su título', async () => {
    const f = fuentes({ textoPdf: async (id) => { if (id === 'S2') throw new ErrorDrive(403); return 'texto'; } });
    const v = vigilarFuentes(f);
    await v.fuentes.salidasEscaneadas();
    await v.fuentes.textoPdf('S1');
    await expect(v.fuentes.textoPdf('S2')).rejects.toBeInstanceOf(ErrorDrive);
    expect(v.fallo()).toBeNull();
    expect(v.pdfsSinTexto()).toEqual([{ id: 'S2', n: '261020 - CLIENTE C.pdf', status: 403 }]);
  });

  it('401 (token) y 429 (cuota) al convertir un PDF NO son del archivo: hacen fallar la corrida', async () => {
    for (const status of [401, 429]) {
      const f = fuentes({ textoPdf: async () => { throw new ErrorDrive(status); } });
      const v = vigilarFuentes(f);
      await v.fuentes.textoPdf('S1').catch(() => {});
      expect(v.fallo()).toBe('drive: HTTP ' + status);
      expect(v.pdfsSinTexto()).toEqual([]);
    }
  });
});

const ticketAbierto = async () => [
  { id: 'T1', ticketNumber: '1401', status: 'Open', statusType: 'Open', createdTime: '2026-11-02T10:00:00.000Z', modifiedTime: '2026-11-03T10:00:00.000Z', cf: { cf_serial: '18A90001' } },
];

describe('fallos de fuente a mitad de la corrida', () => {
  it('si fallan los comentarios de un ticket (Desk 2.0), la corrida falla con «desk2: …» y no toca la foto', async () => {
    const { repo, s } = repoEnMemoria();
    const f = fuentes({ tickets: ticketAbierto });
    f.desk2.comentarios = async () => { throw Object.assign(new Error('pg: host secreto'), { code: '42501' }); };
    expect(await crear(() => f, repo).ejecutar('boton', null)).toEqual({ estado: 'error', causa: 'desk2: consulta rechazada (permisos o esquema)' });
    expect(s.foto).toBe(FOTO_VIEJA);
  });

  it('si falla la remisión de entrada (Drive 5xx), la corrida falla con «drive: …»', async () => {
    const { repo, s } = repoEnMemoria();
    const f = fuentes();
    f.drive.remisionEntrada = async () => { throw new ErrorDrive(500); };
    expect(await crear(() => f, repo).ejecutar('boton', null)).toEqual({ estado: 'error', causa: 'drive: HTTP 500' });
    expect(s.foto).toBe(FOTO_VIEJA);
  });
});

describe('alerta según el origen', () => {
  it('un fallo lanzado con el botón nunca envía la alerta, ni repetido', async () => {
    const { repo, s } = repoEnMemoria();
    const { canal, enviados } = canalFalso();
    const srv = crear(() => fuentes({ sonda: async () => { throw new SinDesk2(); } }), repo, canal);
    for (let i = 0; i < 3; i++) await srv.ejecutar('boton', null);
    expect(enviados).toHaveLength(0);
    expect(s.incidente?.fallosProgramados ?? 0).toBe(0);
  });
});

describe('corrida abandonada (el repositorio rechaza el cierre)', () => {
  const abandonar = (repo: RepoEquipos, que: 'bien' | 'mal' | 'ambas'): RepoEquipos => ({
    ...repo,
    terminarBien: que === 'mal' ? repo.terminarBien : async () => { throw new CorridaCerrada(); },
    terminarMal: que === 'bien' ? repo.terminarMal : async () => { throw new CorridaCerrada(); },
  });
  const caida = () => fuentes({ sonda: async () => { throw new SinDesk2(); } });

  it('una corrida buena que termina tarde se descarta: ni incidente ni alerta', async () => {
    const { repo, s } = repoEnMemoria();
    const { canal, enviados } = canalFalso();
    const srv = crear(() => fuentes(), abandonar(repo, 'bien'), canal);
    expect(await srv.ejecutar('programada', null)).toEqual({ estado: 'error', causa: 'abandonada' });
    expect(s.incidente).toBeNull();
    expect(enviados).toHaveLength(0);
  });

  it('una corrida fallida que termina tarde no cuenta para el incidente aunque sea programada', async () => {
    const { repo, s } = repoEnMemoria();
    const { canal, enviados } = canalFalso();
    const r = abandonar(repo, 'mal');
    const srv = crear(caida, r, canal);
    expect(await srv.ejecutar('programada', null)).toEqual({ estado: 'error', causa: 'abandonada' });
    s.enCurso = false;
    expect(await srv.ejecutar('programada', null)).toEqual({ estado: 'error', causa: 'abandonada' });
    expect(s.incidente).toBeNull();
    expect(enviados).toHaveLength(0);
  });
});

describe('robustez del candado y del registro', () => {
  it('si el repositorio falla al cerrar la corrida, el candado del proceso se suelta', async () => {
    const { repo } = repoEnMemoria();
    const roto: RepoEquipos = { ...repo, terminarBien: async () => { throw new Error('pg caído'); }, terminarMal: async () => { throw new Error('pg caído'); } };
    const srv = crear(() => fuentes(), roto);
    expect(await srv.ejecutar('boton', null)).toEqual({ estado: 'error', causa: 'interno: no se pudo guardar' });
    expect(srv.actualizando()).toBe(false);
  });

  it('un error inesperado se registra con su nombre y código, nunca con el mensaje', async () => {
    const { repo } = repoEnMemoria();
    const roto: RepoEquipos = { ...repo, leerCaches: async () => { throw Object.assign(new Error('pg: host secreto'), { code: 'ECONNRESET' }); } };
    const logs: string[] = [];
    const srv = crearServicioEquipos({ repo: roto, fuentes: () => fuentes(), canal: canalFalso().canal, reserva: 'x@ambientalia.com.co', log: (t) => logs.push(t), hoy: () => '2026-11-10' });
    expect(await srv.ejecutar('boton', null)).toEqual({ estado: 'error', causa: 'interno: error inesperado' });
    const texto = logs.join('\n');
    expect(texto).toMatch(/Error/);
    expect(texto).toMatch(/ECONNRESET/);
    expect(texto).not.toMatch(/secreto/);
  });

  it('lanzar no deja una promesa rechazada sin atender si el registro del incidente revienta', async () => {
    const { repo } = repoEnMemoria();
    const srv = crearServicioEquipos({ repo, fuentes: () => fuentes(), canal: canalFalso().canal, reserva: 'x@ambientalia.com.co', log: () => { throw new Error('log roto'); }, hoy: () => '2026-11-10' });
    const sin: unknown[] = [];
    const h = (e: unknown) => sin.push(e);
    process.on('unhandledRejection', h);
    expect(await srv.lanzar('boton', null)).toBe('iniciada');
    await new Promise((r) => setTimeout(r, 20));
    process.off('unhandledRejection', h);
    expect(sin).toEqual([]);
  });
});

describe('ilegibles', () => {
  it('tras añadir los PDF sin texto, siguen de más reciente a más antiguo', async () => {
    const { repo, s } = repoEnMemoria();
    const f = fuentes({ textoPdf: async (id) => { if (id === 'S1') throw new ErrorDrive(400); return ''; } });
    await crear(() => f, repo).ejecutar('boton', null);
    const d = (s.foto?.ilegibles ?? []).map((x) => x.d);
    expect(d).toEqual([...d].sort((a, b) => b.localeCompare(a)));
    expect(d.length).toBeGreaterThan(1);
  });
});

describe('una remisión de entrada que Drive no puede exportar (A9 extendido)', () => {
  const entradaRota = (rota: Set<string>, status = 400) => (id: string) => {
    if (rota.has(id)) throw new ErrorDrive(status);
    return Promise.resolve('');
  };

  it('4xx en UNA: la corrida sigue, la entrada figura, hay aviso sin secretos y no entra en la caché', async () => {
    const { repo, s } = repoEnMemoria();
    const f = fuentes();
    f.drive.remisionEntrada = async (id) => entradaRota(new Set(['E1']))(id);
    const r = await crear(() => f, repo).ejecutar('boton', null);
    expect(r.estado).toBe('ok');
    expect(s.foto?.rows.map((x) => x.sn)).toContain('18A90001');
    expect(r.estado === 'ok' && r.avisos.some((a) => a === 'Remisión de entrada 18A90001: Drive HTTP 400')).toBe(true);
    expect(s.cacheEnt?.E1).toBeUndefined();
  });

  it('en la siguiente corrida, arreglada la remisión, se lee y se guarda en la caché', async () => {
    const { repo, s } = repoEnMemoria();
    const rotas = new Set(['E1']);
    const f = () => { const x = fuentes(); x.drive.remisionEntrada = async (id) => entradaRota(rotas)(id); return x; };
    await crear(f, repo).ejecutar('boton', null);
    rotas.clear();
    await crear(f, repo).ejecutar('boton', null);
    expect(s.cacheEnt?.E1).toBeDefined();
  });

  it('2 o más fallan y ninguna sale: es de Drive y la corrida falla', async () => {
    const { repo, s } = repoEnMemoria();
    const f = fuentes();
    f.drive.entradas = async () => [{ id: 'E1', title: '261101 - CLIENTE A - 18A90001' }, { id: 'E3', title: '261102 - CLIENTE D - 18A90003' }];
    f.drive.remisionEntrada = async (id) => entradaRota(new Set(['E1', 'E3']), 403)(id);
    expect(await crear(() => f, repo).ejecutar('boton', null)).toEqual({ estado: 'error', causa: 'drive: no se pudo leer ninguna remisión de entrada (HTTP 403)' });
    expect(s.foto).toBe(FOTO_VIEJA);
  });

  it('un 5xx en una sola hace fallar la corrida', async () => {
    const { repo } = repoEnMemoria();
    const f = fuentes();
    f.drive.remisionEntrada = async (id) => entradaRota(new Set(['E1']), 503)(id);
    expect(await crear(() => f, repo).ejecutar('boton', null)).toEqual({ estado: 'error', causa: 'drive: HTTP 503' });
  });
});
