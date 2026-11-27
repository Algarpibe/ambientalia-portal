import { CUALIDADES, EVENTO, MAX_CUALIDADES, PREFERENCIAS, type Preferencia } from './config.js';
import {
  CelebracionError,
  confirmacionesAbiertas,
  esUuid,
  parseConfirmacion,
  parseCualidades,
  top3,
  votosAbiertos,
  type CualidadVotada,
  type DatosConfirmacion,
} from './dominio.js';

export interface Miembro {
  userId: string;
  nombre: string;
  avatar: string | null;
}

export interface Confirmacion extends DatosConfirmacion {
  userId: string;
  actualizadoEn: Date;
}

export interface ConteoVotos {
  votadoId: string;
  cualidad: string;
  votos: number;
}

export interface VotoPropio {
  votadoId: string;
  cualidad: string;
}

/** Puerto del repositorio: lo implementan CelebracionRepository (SQL) y, en los tests, FakeStore. */
export interface CelebracionStore {
  /** Usuarios activos, ordenados por nombre. */
  listarEquipo(): Promise<Miembro[]>;
  esUsuarioActivo(userId: string): Promise<boolean>;
  /** Ids de las personas quitadas de la invitación a ese evento. */
  listarExcluidos(evento: string): Promise<string[]>;
  /** Quita a la persona de la invitación. Idempotente: repetirlo no cambia nada. */
  excluir(evento: string, userId: string, ahora: Date): Promise<void>;
  /** La devuelve a la invitación; sus respuestas y votos nunca se borraron. */
  readmitir(evento: string, userId: string): Promise<void>;
  /** Votos del evento por votado y cualidad. Solo cuentan los votantes activos y no excluidos. */
  contarVotos(evento: string): Promise<ConteoVotos[]>;
  votosDe(evento: string, votanteId: string): Promise<VotoPropio[]>;
  confirmacionDe(evento: string, userId: string): Promise<Confirmacion | null>;
  /** Todas las del evento, también las de cuentas inactivas (el servicio las filtra). */
  listarConfirmaciones(evento: string): Promise<Confirmacion[]>;
  /** Crea o reemplaza la respuesta de la persona. */
  guardarConfirmacion(evento: string, userId: string, datos: DatosConfirmacion, ahora: Date): Promise<void>;
  /** En una transacción: borra los votos de votante a votado y guarda los nuevos. */
  reemplazarVotos(evento: string, votanteId: string, votadoId: string, cualidades: string[], ahora: Date): Promise<void>;
}

export interface Sesion {
  userId: string;
  esAdmin: boolean;
}

export interface MiembroVista extends Miembro {
  cualidades: CualidadVotada[];
}

export interface Vista {
  evento: typeof EVENTO & {
    confirmacionesAbiertas: boolean;
    votosAbiertos: boolean;
    cualidades: readonly string[];
    preferencias: readonly Preferencia[];
    maxCualidades: number;
  };
  yo: string;
  esAdmin: boolean;
  equipo: MiembroVista[];
  miRespuesta: Omit<Confirmacion, 'userId'> | null;
  misVotos: Record<string, string[]>;
  /** Brindis por compañeros invitados distintos que llevo y los que hacen falta para responder. */
  brindis: { dados: number; minimo: number };
}

export interface MiEstado {
  respondido: boolean;
  confirmacionesAbiertas: boolean;
  invitado: boolean;
}

export type EstadoRespuesta = 'va' | 'no_va' | 'sin_responder';

export interface FilaResumen {
  userId: string;
  nombre: string;
  estado: EstadoRespuesta;
  preferencia: string | null;
  mensaje: string | null;
  actualizadoEn: Date | null;
}

export interface Resumen {
  totales: { van: number; noVan: number; sinResponder: number };
  porPreferencia: { codigo: string; texto: string; total: number }[];
  filas: FilaResumen[];
  /** Usuarios activos quitados de la invitación, en el orden del equipo. */
  excluidos: { userId: string; nombre: string }[];
}

export interface CelebracionDeps {
  store: CelebracionStore;
  now: () => Date;
}

/** Casos de uso de la invitación. El reloj se inyecta: los cierres se prueban sin esperar a diciembre. */
export class CelebracionService {
  private readonly store: CelebracionStore;
  private readonly now: () => Date;

  constructor(deps: CelebracionDeps) {
    this.store = deps.store;
    this.now = deps.now;
  }

  /** El equipo invitado (activos menos los quitados) y el conjunto de quitados, en minúsculas. */
  private async invitados(): Promise<{ equipo: Miembro[]; excluidos: Set<string>; todos: Miembro[] }> {
    const [todos, ids] = await Promise.all([this.store.listarEquipo(), this.store.listarExcluidos(EVENTO.id)]);
    const excluidos = new Set(ids.map((id) => id.toLowerCase()));
    return { equipo: todos.filter((m) => !excluidos.has(m.userId.toLowerCase())), excluidos, todos };
  }

  /** Compañeros invitados distintos por los que `mios` brindó, frente a todos los demás invitados (hay que brindar por todos). */
  private brindis(equipo: readonly Miembro[], mios: readonly VotoPropio[], userId: string): { dados: number; minimo: number } {
    const yo = userId.toLowerCase();
    const invitados = new Set(equipo.map((m) => m.userId.toLowerCase()));
    const votados = new Set(mios.map((v) => v.votadoId.toLowerCase()).filter((id) => id !== yo && invitados.has(id)));
    return { dados: votados.size, minimo: Math.max(0, equipo.length - 1) };
  }

  async vista(sesion: Sesion): Promise<Vista> {
    const ahora = this.now();
    const [{ equipo, excluidos }, conteos, mios, confirmacion] = await Promise.all([
      this.invitados(),
      this.store.contarVotos(EVENTO.id),
      this.store.votosDe(EVENTO.id, sesion.userId),
      this.store.confirmacionDe(EVENTO.id, sesion.userId),
    ]);
    if (excluidos.has(sesion.userId.toLowerCase())) throw new CelebracionError('no_invitado');

    const porVotado = new Map<string, CualidadVotada[]>();
    for (const c of conteos) {
      const lista = porVotado.get(c.votadoId) ?? [];
      lista.push({ cualidad: c.cualidad, votos: c.votos });
      porVotado.set(c.votadoId, lista);
    }

    const misVotos: Record<string, string[]> = {};
    for (const v of mios) {
      const lista = misVotos[v.votadoId] ?? [];
      lista.push(v.cualidad);
      misVotos[v.votadoId] = lista;
    }

    return {
      evento: {
        ...EVENTO,
        confirmacionesAbiertas: confirmacionesAbiertas(ahora),
        votosAbiertos: votosAbiertos(ahora),
        cualidades: CUALIDADES,
        preferencias: PREFERENCIAS,
        maxCualidades: MAX_CUALIDADES,
      },
      yo: sesion.userId,
      esAdmin: sesion.esAdmin,
      equipo: equipo.map((m) => ({ ...m, cualidades: top3(porVotado.get(m.userId) ?? []) })),
      miRespuesta: confirmacion
        ? {
            asiste: confirmacion.asiste,
            preferencia: confirmacion.preferencia,
            mensaje: confirmacion.mensaje,
            actualizadoEn: confirmacion.actualizadoEn,
          }
        : null,
      misVotos,
      brindis: this.brindis(equipo, mios, sesion.userId),
    };
  }

  async miEstado(userId: string): Promise<MiEstado> {
    const [confirmacion, ids] = await Promise.all([
      this.store.confirmacionDe(EVENTO.id, userId),
      this.store.listarExcluidos(EVENTO.id),
    ]);
    return {
      respondido: confirmacion !== null,
      confirmacionesAbiertas: confirmacionesAbiertas(this.now()),
      invitado: !this.esta(ids, userId),
    };
  }

  private esta(ids: readonly string[], userId: string): boolean {
    return ids.some((id) => id.toLowerCase() === userId.toLowerCase());
  }

  async confirmar(userId: string, body: unknown): Promise<void> {
    const ahora = this.now();
    if (this.esta(await this.store.listarExcluidos(EVENTO.id), userId)) throw new CelebracionError('no_invitado');
    if (!confirmacionesAbiertas(ahora)) throw new CelebracionError('confirmaciones_cerradas');
    const [{ equipo }, mios] = await Promise.all([this.invitados(), this.store.votosDe(EVENTO.id, userId)]);
    const { dados, minimo } = this.brindis(equipo, mios, userId);
    if (dados < minimo) throw new CelebracionError('faltan_brindis');
    await this.store.guardarConfirmacion(EVENTO.id, userId, parseConfirmacion(body), ahora);
  }

  /**
   * Orden de las comprobaciones (decisión D3): cierre, votante invitado, UUID, voto propio,
   * cualidades, compañero activo e invitado.
   */
  async votar(votanteId: string, votadoId: unknown, body: unknown): Promise<void> {
    const ahora = this.now();
    if (!votosAbiertos(ahora)) throw new CelebracionError('votos_cerrados');
    const excluidos = await this.store.listarExcluidos(EVENTO.id);
    if (this.esta(excluidos, votanteId)) throw new CelebracionError('no_invitado');
    if (!esUuid(votadoId)) throw new CelebracionError('usuario_no_valido');
    const votado = votadoId.toLowerCase();
    if (votado === votanteId.toLowerCase()) throw new CelebracionError('voto_propio');
    const cualidades = parseCualidades(body);
    if (this.esta(excluidos, votado) || !(await this.store.esUsuarioActivo(votado))) {
      throw new CelebracionError('usuario_no_valido');
    }
    await this.store.reemplazarVotos(EVENTO.id, votanteId, votado, cualidades, ahora);
  }

  /** Quita a una persona activa de la invitación (el admin no puede quitarse a sí mismo). */
  async excluir(adminId: string, userId: unknown): Promise<void> {
    if (!esUuid(userId)) throw new CelebracionError('usuario_no_valido');
    const id = userId.toLowerCase();
    if (id === adminId.toLowerCase()) throw new CelebracionError('exclusion_propia');
    if (!(await this.store.esUsuarioActivo(id))) throw new CelebracionError('usuario_no_valido');
    await this.store.excluir(EVENTO.id, id, this.now());
  }

  async readmitir(userId: unknown): Promise<void> {
    if (!esUuid(userId)) throw new CelebracionError('usuario_no_valido');
    await this.store.readmitir(EVENTO.id, userId.toLowerCase());
  }

  async resumen(): Promise<Resumen> {
    const [{ equipo, excluidos, todos }, confirmaciones] = await Promise.all([
      this.invitados(),
      this.store.listarConfirmaciones(EVENTO.id),
    ]);
    const porUsuario = new Map(confirmaciones.map((c) => [c.userId, c] as const));
    const filas = equipo.map((m): FilaResumen => {
      const c = porUsuario.get(m.userId);
      if (!c) {
        return { userId: m.userId, nombre: m.nombre, estado: 'sin_responder', preferencia: null, mensaje: null, actualizadoEn: null };
      }
      return {
        userId: m.userId,
        nombre: m.nombre,
        estado: c.asiste ? 'va' : 'no_va',
        preferencia: c.preferencia,
        mensaje: c.mensaje,
        actualizadoEn: c.actualizadoEn,
      };
    });
    const cuantos = (estado: EstadoRespuesta) => filas.filter((f) => f.estado === estado).length;
    return {
      totales: { van: cuantos('va'), noVan: cuantos('no_va'), sinResponder: cuantos('sin_responder') },
      porPreferencia: PREFERENCIAS.map((p) => ({
        codigo: p.codigo,
        texto: p.texto,
        total: filas.filter((f) => f.estado === 'va' && f.preferencia === p.codigo).length,
      })),
      filas,
      excluidos: todos
        .filter((m) => excluidos.has(m.userId.toLowerCase()))
        .map((m) => ({ userId: m.userId, nombre: m.nombre })),
    };
  }
}
