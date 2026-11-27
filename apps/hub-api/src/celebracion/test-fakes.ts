import type { DatosConfirmacion } from './dominio.js';
import type { CelebracionStore, Confirmacion, ConteoVotos, Miembro, VotoPropio } from './service.js';

export interface FakeUsuario extends Miembro {
  activo: boolean;
}

interface FakeVoto {
  evento: string;
  votanteId: string;
  votadoId: string;
  cualidad: string;
  creadoEn: Date;
}

interface FakeConfirmacion extends Confirmacion {
  evento: string;
}

/** Store en memoria con la misma semántica que el SQL de CelebracionRepository. */
export class FakeStore implements CelebracionStore {
  usuarios: FakeUsuario[] = [];
  confirmaciones: FakeConfirmacion[] = [];
  votos: FakeVoto[] = [];
  excluidos: { evento: string; userId: string }[] = [];

  addUsuario(userId: string, nombre: string, opciones: { activo?: boolean; avatar?: string | null } = {}): void {
    this.usuarios.push({ userId, nombre, avatar: opciones.avatar ?? null, activo: opciones.activo ?? true });
  }

  private activo(userId: string): boolean {
    return this.usuarios.some((u) => u.userId === userId && u.activo);
  }

  private estaExcluido(evento: string, userId: string): boolean {
    return this.excluidos.some((x) => x.evento === evento && x.userId === userId);
  }

  async listarExcluidos(evento: string): Promise<string[]> {
    return this.excluidos.filter((x) => x.evento === evento).map((x) => x.userId);
  }

  async excluir(evento: string, userId: string, _ahora: Date): Promise<void> {
    if (!this.estaExcluido(evento, userId)) this.excluidos.push({ evento, userId });
  }

  async readmitir(evento: string, userId: string): Promise<void> {
    this.excluidos = this.excluidos.filter((x) => !(x.evento === evento && x.userId === userId));
  }

  async listarEquipo(): Promise<Miembro[]> {
    return this.usuarios
      .filter((u) => u.activo)
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
      .map((u) => ({ userId: u.userId, nombre: u.nombre, avatar: u.avatar }));
  }

  async esUsuarioActivo(userId: string): Promise<boolean> {
    return this.activo(userId);
  }

  async contarVotos(evento: string): Promise<ConteoVotos[]> {
    const mapa = new Map<string, ConteoVotos>();
    for (const v of this.votos) {
      if (v.evento !== evento || !this.activo(v.votanteId) || this.estaExcluido(evento, v.votanteId)) continue;
      const clave = `${v.votadoId}|${v.cualidad}`;
      const actual = mapa.get(clave) ?? { votadoId: v.votadoId, cualidad: v.cualidad, votos: 0 };
      actual.votos += 1;
      mapa.set(clave, actual);
    }
    return [...mapa.values()];
  }

  async votosDe(evento: string, votanteId: string): Promise<VotoPropio[]> {
    return this.votos
      .filter((v) => v.evento === evento && v.votanteId === votanteId)
      .map((v) => ({ votadoId: v.votadoId, cualidad: v.cualidad }));
  }

  async confirmacionDe(evento: string, userId: string): Promise<Confirmacion | null> {
    const c = this.confirmaciones.find((x) => x.evento === evento && x.userId === userId);
    return c ? sinEvento(c) : null;
  }

  async listarConfirmaciones(evento: string): Promise<Confirmacion[]> {
    return this.confirmaciones.filter((c) => c.evento === evento).map(sinEvento);
  }

  async guardarConfirmacion(evento: string, userId: string, datos: DatosConfirmacion, ahora: Date): Promise<void> {
    this.confirmaciones = this.confirmaciones.filter((c) => !(c.evento === evento && c.userId === userId));
    this.confirmaciones.push({ evento, userId, ...datos, actualizadoEn: ahora });
  }

  async reemplazarVotos(
    evento: string,
    votanteId: string,
    votadoId: string,
    cualidades: string[],
    ahora: Date,
  ): Promise<void> {
    // El CHECK de la BD (celebracion_votos_no_propio).
    if (votanteId === votadoId) throw new Error('check violation: celebracion_votos_no_propio');
    this.votos = this.votos.filter(
      (v) => !(v.evento === evento && v.votanteId === votanteId && v.votadoId === votadoId),
    );
    for (const cualidad of cualidades) this.votos.push({ evento, votanteId, votadoId, cualidad, creadoEn: ahora });
  }
}

function sinEvento(c: FakeConfirmacion): Confirmacion {
  return {
    userId: c.userId,
    asiste: c.asiste,
    preferencia: c.preferencia,
    mensaje: c.mensaje,
    actualizadoEn: c.actualizadoEn,
  };
}
