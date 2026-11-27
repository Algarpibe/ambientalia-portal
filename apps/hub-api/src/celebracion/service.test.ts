import { describe, it, expect, vi } from 'vitest';
import { CUALIDADES, EVENTO, PREFERENCIAS } from './config.js';
import { CelebracionService } from './service.js';
import { FakeStore } from './test-fakes.js';

const ANA = '00000000-0000-4000-8000-00000000000a';
const BRUNO = '00000000-0000-4000-8000-00000000000b';
const CARLA = '00000000-0000-4000-8000-00000000000c';
const DIANA = '00000000-0000-4000-8000-00000000000d'; // inactiva

const ANTES_DEL_CORTE = new Date('2026-12-01T15:00:00Z');
const TRAS_EL_CORTE = new Date('2026-12-10T15:00:00Z'); // confirmaciones cerradas, votos abiertos
const TRAS_EL_EVENTO = new Date('2026-12-18T18:00:00Z');

function montar(ahora = ANTES_DEL_CORTE) {
  const store = new FakeStore();
  store.addUsuario(ANA, 'Ana Ruiz');
  store.addUsuario(BRUNO, 'Bruno Díaz', { avatar: 'data:image/jpeg;base64,AAAA' });
  store.addUsuario(CARLA, 'Carla Gómez');
  store.addUsuario(DIANA, 'Diana Prieto', { activo: false });
  const reloj = { ahora };
  const service = new CelebracionService({ store, now: () => reloj.ahora });
  return { store, service, reloj };
}

const FOTO = 'data:image/jpeg;base64,AAAA';

/** Da un brindis (una cualidad) de `votante` a cada uno de `votados`, sin foto. */
async function brindarSinFoto(store: FakeStore, votante: string, ...votados: string[]): Promise<void> {
  for (const votado of votados) await store.reemplazarVotos(EVENTO.id, votante, votado, ['Empatía'], ANTES_DEL_CORTE);
}

/** Prepara a `votante` para responder: sus brindis y su foto graciosa (la confirmación exige las dos cosas). */
async function brindar(store: FakeStore, votante: string, ...votados: string[]): Promise<void> {
  await brindarSinFoto(store, votante, ...votados);
  await store.guardarFoto(EVENTO.id, votante, FOTO, ANTES_DEL_CORTE);
}

describe('vista', () => {
  it('devuelve el evento con sus cierres, listas y topes, y quién soy', async () => {
    const { service } = montar();
    const vista = await service.vista({ userId: ANA, esAdmin: true });
    expect(vista.evento).toMatchObject({
      id: EVENTO.id,
      inicio: EVENTO.inicio,
      confirmacionesAbiertas: true,
      votosAbiertos: true,
      maxCualidades: 3,
    });
    expect(vista.evento.cualidades).toEqual(CUALIDADES);
    expect(vista.evento.preferencias).toEqual(PREFERENCIAS);
    expect(vista.yo).toBe(ANA);
    expect(vista.esAdmin).toBe(true);
  });

  it('el equipo son los usuarios activos por nombre, con su avatar', async () => {
    const { service } = montar();
    const { equipo } = await service.vista({ userId: ANA, esAdmin: false });
    expect(equipo.map((m) => m.nombre)).toEqual(['Ana Ruiz', 'Bruno Díaz', 'Carla Gómez']);
    expect(equipo[1].avatar).toBe('data:image/jpeg;base64,AAAA');
  });

  it('al admin, cada tarjeta le trae su top 3 con número, sin contar votos de cuentas inactivas', async () => {
    const { store, service } = montar();
    await store.reemplazarVotos(EVENTO.id, ANA, BRUNO, ['Empatía', 'Liderazgo'], ANTES_DEL_CORTE);
    await store.reemplazarVotos(EVENTO.id, CARLA, BRUNO, ['Empatía'], ANTES_DEL_CORTE);
    await store.reemplazarVotos(EVENTO.id, DIANA, BRUNO, ['Compromiso', 'Creatividad', 'Generosidad'], ANTES_DEL_CORTE);
    const { equipo } = await service.vista({ userId: ANA, esAdmin: true });
    expect(equipo.find((m) => m.userId === BRUNO)?.cualidades).toEqual([
      { cualidad: 'Empatía', votos: 2 },
      { cualidad: 'Liderazgo', votos: 1 },
    ]);
    expect(equipo.find((m) => m.userId === CARLA)?.cualidades).toEqual([]);
  });

  it('a quien no es admin no le llega ninguna cualidad, tampoco las suyas, y cualidadesOcultas lo dice', async () => {
    const { store, service } = montar();
    await store.reemplazarVotos(EVENTO.id, BRUNO, ANA, ['Empatía'], ANTES_DEL_CORTE);
    await store.reemplazarVotos(EVENTO.id, ANA, BRUNO, ['Liderazgo'], ANTES_DEL_CORTE);
    await store.reemplazarVotos(EVENTO.id, CARLA, BRUNO, ['Liderazgo'], ANTES_DEL_CORTE);
    const vista = await service.vista({ userId: ANA, esAdmin: false });
    expect(vista.cualidadesOcultas).toBe(true);
    expect(vista.equipo.map((m) => m.cualidades)).toEqual([[], [], []]);
    // Ni rastro de los conteos en la respuesta: se verían en las herramientas del navegador.
    expect(JSON.stringify(vista.equipo)).not.toContain('votos');
    expect(JSON.stringify(vista)).not.toMatch(/"votos":/);
    // Sus propios brindis sí le llegan, para poder cambiarlos.
    expect(vista.misVotos).toEqual({ [BRUNO]: ['Liderazgo'] });
  });

  it('solo consulta los conteos de votos cuando los va a enviar: la vista del admin sí, la de los demás no', async () => {
    const { store, service } = montar();
    const contar = vi.spyOn(store, 'contarVotos');
    await service.vista({ userId: ANA, esAdmin: false });
    expect(contar).not.toHaveBeenCalled();
    await service.vista({ userId: ANA, esAdmin: true });
    expect(contar).toHaveBeenCalledTimes(1);
  });

  it('el admin recibe cualidadesOcultas: false y también su propio top 3', async () => {
    const { store, service } = montar();
    await store.reemplazarVotos(EVENTO.id, BRUNO, ANA, ['Empatía'], ANTES_DEL_CORTE);
    const vista = await service.vista({ userId: ANA, esAdmin: true });
    expect(vista.cualidadesOcultas).toBe(false);
    expect(vista.equipo.find((m) => m.userId === ANA)?.cualidades).toEqual([{ cualidad: 'Empatía', votos: 1 }]);
  });

  it('trae mis votos por compañero y mi respuesta', async () => {
    const { store, service } = montar();
    await store.reemplazarVotos(EVENTO.id, ANA, BRUNO, ['Empatía'], ANTES_DEL_CORTE);
    await store.reemplazarVotos(EVENTO.id, CARLA, BRUNO, ['Liderazgo'], ANTES_DEL_CORTE);
    await brindar(store, ANA, CARLA);
    await service.confirmar(ANA, { asiste: true, preferencia: 'vegetariano', mensaje: '¡Allá estaré!' });
    const vista = await service.vista({ userId: ANA, esAdmin: false });
    expect(vista.misVotos).toEqual({ [BRUNO]: ['Empatía'], [CARLA]: ['Empatía'] });
    expect(vista.miRespuesta).toEqual({
      asiste: true,
      preferencia: 'vegetariano',
      mensaje: '¡Allá estaré!',
      actualizadoEn: ANTES_DEL_CORTE,
    });
  });

  it('sin respuesta, miRespuesta es null', async () => {
    const { service } = montar();
    expect((await service.vista({ userId: CARLA, esAdmin: false })).miRespuesta).toBeNull();
  });

  it('brindis cuenta compañeros distintos con el mínimo del equipo, sin contar a Diana inactiva', async () => {
    const { store, service } = montar();
    // Equipo invitado = Ana, Bruno y Carla: el mínimo baja a 2.
    expect((await service.vista({ userId: ANA, esAdmin: false })).brindis).toEqual({ dados: 0, minimo: 2 });
    await store.reemplazarVotos(EVENTO.id, ANA, BRUNO, ['Empatía', 'Liderazgo'], ANTES_DEL_CORTE);
    expect((await service.vista({ userId: ANA, esAdmin: false })).brindis).toEqual({ dados: 1, minimo: 2 });
    await brindar(store, ANA, DIANA);
    expect((await service.vista({ userId: ANA, esAdmin: false })).brindis).toEqual({ dados: 1, minimo: 2 });
  });

  it('el mínimo es todos los demás invitados: readmitir a alguien lo sube', async () => {
    const { service } = montar();
    await service.excluir(ANA, BRUNO);
    expect((await service.vista({ userId: ANA, esAdmin: false })).brindis.minimo).toBe(1);
    await service.readmitir(BRUNO);
    expect((await service.vista({ userId: ANA, esAdmin: false })).brindis.minimo).toBe(2);
  });

  it('los brindis a un excluido no cuentan', async () => {
    const { store, service } = montar();
    await brindar(store, ANA, BRUNO, CARLA);
    await service.excluir(ANA, BRUNO);
    expect((await service.vista({ userId: ANA, esAdmin: false })).brindis).toEqual({ dados: 1, minimo: 1 });
  });
});

describe('miEstado', () => {
  it('dice si he respondido y si las confirmaciones siguen abiertas', async () => {
    const { store, service, reloj } = montar();
    await brindar(store, ANA, BRUNO, CARLA);
    expect(await service.miEstado(ANA)).toEqual({ respondido: false, confirmacionesAbiertas: true, invitado: true });
    await service.confirmar(ANA, { asiste: false });
    expect(await service.miEstado(ANA)).toEqual({ respondido: true, confirmacionesAbiertas: true, invitado: true });
    reloj.ahora = TRAS_EL_CORTE;
    expect(await service.miEstado(CARLA)).toEqual({ respondido: false, confirmacionesAbiertas: false, invitado: true });
  });
});

describe('confirmar', () => {
  it('guarda y luego reemplaza mi respuesta', async () => {
    const { store, service } = montar();
    await brindar(store, ANA, BRUNO, CARLA);
    await service.confirmar(ANA, { asiste: true, preferencia: 'general' });
    await service.confirmar(ANA, { asiste: false, mensaje: 'Me surgió un viaje' });
    expect(store.confirmaciones).toHaveLength(1);
    expect(await store.confirmacionDe(EVENTO.id, ANA)).toMatchObject({
      asiste: false,
      preferencia: null,
      mensaje: 'Me surgió un viaje',
    });
  });

  it('después del corte es 409 confirmaciones_cerradas y no guarda nada', async () => {
    const { store, service } = montar(TRAS_EL_CORTE);
    await expect(service.confirmar(ANA, { asiste: false })).rejects.toMatchObject({
      code: 'confirmaciones_cerradas',
      status: 409,
    });
    expect(store.confirmaciones).toHaveLength(0);
  });

  it('un cuerpo inválido no guarda nada', async () => {
    const { store, service } = montar();
    await brindar(store, ANA, BRUNO, CARLA);
    await expect(service.confirmar(ANA, { asiste: true, preferencia: 'carne' })).rejects.toMatchObject({
      code: 'preferencia_invalida',
    });
    expect(store.confirmaciones).toHaveLength(0);
  });

  it('con menos brindis que el mínimo es 409 faltan_brindis y no guarda nada', async () => {
    const { store, service } = montar();
    await brindar(store, ANA, BRUNO);
    await expect(service.confirmar(ANA, { asiste: false })).rejects.toMatchObject({ code: 'faltan_brindis', status: 409 });
    expect(store.confirmaciones).toHaveLength(0);
  });

  it('al llegar al mínimo ya deja responder', async () => {
    const { store, service } = montar();
    await brindar(store, ANA, BRUNO, CARLA);
    await expect(service.confirmar(ANA, { asiste: false })).resolves.toBeUndefined();
  });

  it('los brindis a un inactivo o a un excluido no cuentan', async () => {
    const { store, service } = montar();
    await brindar(store, ANA, BRUNO, DIANA);
    await expect(service.confirmar(ANA, { asiste: false })).rejects.toMatchObject({ code: 'faltan_brindis' });
    await brindar(store, ANA, CARLA);
    await service.excluir(ANA, BRUNO);
    // Equipo invitado = Ana y Carla: el mínimo baja a 1 y el brindis a Carla basta.
    await expect(service.confirmar(ANA, { asiste: false })).resolves.toBeUndefined();
  });

  it('hay que brindar por todos: un invitado nuevo o readmitido vuelve a bloquear', async () => {
    const { store, service } = montar();
    await service.excluir(ANA, BRUNO);
    await brindar(store, ANA, CARLA);
    await expect(service.confirmar(ANA, { asiste: false })).resolves.toBeUndefined();
    await service.readmitir(BRUNO);
    await expect(service.confirmar(ANA, { asiste: false })).rejects.toMatchObject({ code: 'faltan_brindis' });
    const nuevo = '00000000-0000-4000-8000-0000000000e1';
    await brindar(store, ANA, BRUNO);
    store.addUsuario(nuevo, 'Elena Soto');
    await expect(service.confirmar(ANA, { asiste: false })).rejects.toMatchObject({ code: 'faltan_brindis' });
    await brindar(store, ANA, nuevo);
    await expect(service.confirmar(ANA, { asiste: false })).resolves.toBeUndefined();
  });

  it('sin foto graciosa es 409 falta_foto aunque los brindis estén completos, y no guarda nada', async () => {
    const { store, service } = montar();
    await brindarSinFoto(store, ANA, BRUNO, CARLA);
    await expect(service.confirmar(ANA, { asiste: false })).rejects.toMatchObject({ code: 'falta_foto', status: 409 });
    expect(store.confirmaciones).toHaveLength(0);
    await service.subirFoto(ANA, { foto: FOTO });
    await expect(service.confirmar(ANA, { asiste: false })).resolves.toBeUndefined();
  });

  it('la foto sola no basta: con la foto pero sin los brindis es faltan_brindis', async () => {
    const { store, service } = montar();
    await store.guardarFoto(EVENTO.id, ANA, FOTO, ANTES_DEL_CORTE);
    await expect(service.confirmar(ANA, { asiste: false })).rejects.toMatchObject({ code: 'faltan_brindis' });
  });

  it('la foto de otro no cuenta: cada quien sube la suya', async () => {
    const { store, service } = montar();
    await brindarSinFoto(store, ANA, BRUNO, CARLA);
    await store.guardarFoto(EVENTO.id, BRUNO, FOTO, ANTES_DEL_CORTE);
    await expect(service.confirmar(ANA, { asiste: false })).rejects.toMatchObject({ code: 'falta_foto' });
  });

  it('orden: excluido, cerradas, falta_foto, faltan_brindis y por último el cuerpo inválido', async () => {
    const cerradas = montar(TRAS_EL_CORTE);
    await expect(cerradas.service.confirmar(ANA, { asiste: false })).rejects.toMatchObject({ code: 'confirmaciones_cerradas' });
    const { store, service } = montar();
    await expect(service.confirmar(ANA, { asiste: 'x' })).rejects.toMatchObject({ code: 'falta_foto' });
    await store.guardarFoto(EVENTO.id, ANA, FOTO, ANTES_DEL_CORTE);
    await expect(service.confirmar(ANA, { asiste: 'x' })).rejects.toMatchObject({ code: 'faltan_brindis' });
    await brindarSinFoto(store, ANA, BRUNO, CARLA);
    await expect(service.confirmar(ANA, { asiste: 'x' })).rejects.toMatchObject({ code: 'asiste_invalido' });
  });
});

describe('subirFoto', () => {
  it('guarda la foto del evento y la reemplaza en la siguiente', async () => {
    const { store, service } = montar();
    await service.subirFoto(ANA, { foto: FOTO });
    await service.subirFoto(ANA, { foto: 'data:image/png;base64,BBBB' });
    expect(await store.listarFotos(EVENTO.id)).toEqual([{ userId: ANA, foto: 'data:image/png;base64,BBBB' }]);
  });

  it('una foto inválida es 400 foto_invalida y no guarda nada', async () => {
    const { store, service } = montar();
    await expect(service.subirFoto(ANA, { foto: 'hola' })).rejects.toMatchObject({ code: 'foto_invalida', status: 400 });
    expect(await store.listarFotos(EVENTO.id)).toEqual([]);
  });

  it('un excluido es 403 no_invitado, antes de mirar la foto', async () => {
    const { store, service } = montar();
    await service.excluir(ANA, BRUNO);
    await expect(service.subirFoto(BRUNO, { foto: 'hola' })).rejects.toMatchObject({ code: 'no_invitado', status: 403 });
    await expect(service.subirFoto(BRUNO, { foto: FOTO })).rejects.toMatchObject({ code: 'no_invitado' });
    expect(await store.listarFotos(EVENTO.id)).toEqual([]);
  });

  it('la vista trae la foto de cada miembro, o null si aún no la subió', async () => {
    const { service } = montar();
    await service.subirFoto(BRUNO, { foto: FOTO });
    const { equipo } = await service.vista({ userId: ANA, esAdmin: false });
    expect(equipo.map((m) => [m.nombre, m.foto])).toEqual([
      ['Ana Ruiz', null],
      ['Bruno Díaz', FOTO],
      ['Carla Gómez', null],
    ]);
  });
});

describe('votar', () => {
  it('reemplaza mis votos a ese compañero, también por una lista vacía', async () => {
    const { store, service } = montar();
    await service.votar(ANA, BRUNO, { cualidades: ['Empatía', 'Liderazgo', 'Compromiso'] });
    await service.votar(ANA, BRUNO, { cualidades: ['Creatividad'] });
    expect(await store.votosDe(EVENTO.id, ANA)).toEqual([{ votadoId: BRUNO, cualidad: 'Creatividad' }]);
    await service.votar(ANA, BRUNO, { cualidades: [] });
    expect(await store.votosDe(EVENTO.id, ANA)).toEqual([]);
  });

  it('acepta el UUID en mayúsculas y lo guarda en minúsculas', async () => {
    const { store, service } = montar();
    await service.votar(ANA, BRUNO.toUpperCase(), { cualidades: ['Empatía'] });
    expect(await store.votosDe(EVENTO.id, ANA)).toEqual([{ votadoId: BRUNO, cualidad: 'Empatía' }]);
  });

  it('tras el corte de confirmaciones todavía se puede votar', async () => {
    const { service } = montar(TRAS_EL_CORTE);
    await expect(service.votar(ANA, BRUNO, { cualidades: ['Empatía'] })).resolves.toBeUndefined();
  });

  it('rechaza cada caso con su código y sin guardar', async () => {
    const { store, service } = montar();
    await expect(service.votar(ANA, ANA, { cualidades: ['Empatía'] })).rejects.toMatchObject({ code: 'voto_propio' });
    await expect(service.votar(ANA, 'no-es-uuid', { cualidades: ['Empatía'] })).rejects.toMatchObject({
      code: 'usuario_no_valido',
    });
    await expect(service.votar(ANA, DIANA, { cualidades: ['Empatía'] })).rejects.toMatchObject({
      code: 'usuario_no_valido',
    });
    await expect(
      service.votar(ANA, '00000000-0000-4000-8000-0000000000ff', { cualidades: ['Empatía'] }),
    ).rejects.toMatchObject({ code: 'usuario_no_valido' });
    await expect(
      service.votar(ANA, BRUNO, { cualidades: ['Empatía', 'Liderazgo', 'Compromiso', 'Creatividad'] }),
    ).rejects.toMatchObject({ code: 'demasiadas_cualidades' });
    await expect(service.votar(ANA, BRUNO, { cualidades: ['Puntualidad'] })).rejects.toMatchObject({
      code: 'cualidad_invalida',
    });
    expect(store.votos).toHaveLength(0);
  });

  it('después del inicio del evento es 409 votos_cerrados', async () => {
    const { service } = montar(TRAS_EL_EVENTO);
    await expect(service.votar(ANA, BRUNO, { cualidades: ['Empatía'] })).rejects.toMatchObject({
      code: 'votos_cerrados',
      status: 409,
    });
  });
});

describe('cualidadesEquipo', () => {
  const FOTO_DE_BRUNO = 'data:image/png;base64,BBBB';

  /** Carla recibe 5 cualidades distintas, 4 empatadas a 1 voto; Diana, inactiva, vota y no cuenta. */
  async function votosDePrueba(store: FakeStore): Promise<void> {
    await store.reemplazarVotos(EVENTO.id, ANA, CARLA, ['Compromiso', 'Empatía', 'Creatividad'], ANTES_DEL_CORTE);
    await store.reemplazarVotos(EVENTO.id, BRUNO, CARLA, ['Compromiso', 'Generosidad', 'Liderazgo'], ANTES_DEL_CORTE);
    await store.reemplazarVotos(EVENTO.id, DIANA, CARLA, ['Perseverancia'], ANTES_DEL_CORTE);
    await store.reemplazarVotos(EVENTO.id, CARLA, ANA, ['Empatía'], ANTES_DEL_CORTE);
    await store.guardarFoto(EVENTO.id, BRUNO, FOTO_DE_BRUNO, ANTES_DEL_CORTE);
  }

  it('trae a los invitados por nombre, con su avatar, su foto y TODAS sus cualidades, por votos y con el desempate de la lista', async () => {
    const { store, service } = montar();
    await votosDePrueba(store);
    expect(await service.cualidadesEquipo()).toEqual({
      equipo: [
        { userId: ANA, nombre: 'Ana Ruiz', avatar: null, foto: null, cualidades: [{ cualidad: 'Empatía', votos: 1 }] },
        { userId: BRUNO, nombre: 'Bruno Díaz', avatar: 'data:image/jpeg;base64,AAAA', foto: FOTO_DE_BRUNO, cualidades: [] },
        {
          userId: CARLA,
          nombre: 'Carla Gómez',
          avatar: null,
          foto: null,
          cualidades: [
            { cualidad: 'Compromiso', votos: 2 },
            { cualidad: 'Liderazgo', votos: 1 },
            { cualidad: 'Empatía', votos: 1 },
            { cualidad: 'Creatividad', votos: 1 },
            { cualidad: 'Generosidad', votos: 1 },
          ],
        },
      ],
    });
  });

  it('sus 3 primeras son el top 3 que el admin ve en el muro', async () => {
    const { store, service } = montar();
    await votosDePrueba(store);
    const muro = await service.vista({ userId: ANA, esAdmin: true });
    const { equipo } = await service.cualidadesEquipo();
    expect(equipo.map((p) => p.cualidades.slice(0, 3))).toEqual(muro.equipo.map((m) => m.cualidades));
  });

  it('deja fuera a los excluidos y no cuenta sus votos', async () => {
    const { store, service } = montar();
    await votosDePrueba(store);
    await service.excluir(ANA, BRUNO);
    const { equipo } = await service.cualidadesEquipo();
    expect(equipo.map((p) => p.nombre)).toEqual(['Ana Ruiz', 'Carla Gómez']);
    expect(equipo[1].cualidades).toEqual([
      { cualidad: 'Empatía', votos: 1 },
      { cualidad: 'Compromiso', votos: 1 },
      { cualidad: 'Creatividad', votos: 1 },
    ]);
  });
});

describe('resumen', () => {
  it('cuenta van, no van y sin responder entre los activos, con los menús de quienes van', async () => {
    const { store, service } = montar();
    await brindar(store, ANA, BRUNO, CARLA);
    await brindar(store, BRUNO, ANA, CARLA);
    await service.confirmar(ANA, { asiste: true, preferencia: 'vegetariano', mensaje: '¡Allá estaré!' });
    await service.confirmar(BRUNO, { asiste: false });
    // Diana está inactiva: su respuesta no cuenta.
    await store.guardarConfirmacion(EVENTO.id, DIANA, { asiste: true, preferencia: 'general', mensaje: null }, ANTES_DEL_CORTE);

    const resumen = await service.resumen();
    expect(resumen.totales).toEqual({ van: 1, noVan: 1, sinResponder: 1 });
    expect(resumen.porPreferencia).toEqual([
      { codigo: 'general', texto: 'Menú general (sin restricciones)', total: 0 },
      { codigo: 'vegetariano', texto: 'Opción vegetariana', total: 1 },
      { codigo: 'sin_gluten', texto: 'Sin gluten', total: 0 },
      { codigo: 'sin_mariscos', texto: 'Sin mariscos ni pescados', total: 0 },
    ]);
    expect(resumen.filas).toEqual([
      {
        userId: ANA,
        nombre: 'Ana Ruiz',
        estado: 'va',
        preferencia: 'vegetariano',
        mensaje: '¡Allá estaré!',
        actualizadoEn: ANTES_DEL_CORTE,
      },
      { userId: BRUNO, nombre: 'Bruno Díaz', estado: 'no_va', preferencia: null, mensaje: null, actualizadoEn: ANTES_DEL_CORTE },
      { userId: CARLA, nombre: 'Carla Gómez', estado: 'sin_responder', preferencia: null, mensaje: null, actualizadoEn: null },
    ]);
    expect(resumen.excluidos).toEqual([]);
  });
});

describe('personas quitadas de la invitación', () => {
  const ADMIN = ANA;

  async function sinBruno() {
    const m = montar();
    await m.service.excluir(ADMIN, BRUNO);
    return m;
  }

  it('excluir y readmitir validan el UUID y la persona', async () => {
    const { store, service } = montar();
    await expect(service.excluir(ADMIN, 'no-es-uuid')).rejects.toMatchObject({ code: 'usuario_no_valido', status: 400 });
    await expect(service.excluir(ADMIN, undefined)).rejects.toMatchObject({ code: 'usuario_no_valido' });
    await expect(service.excluir(ADMIN, ADMIN)).rejects.toMatchObject({ code: 'exclusion_propia', status: 400 });
    await expect(service.excluir(ADMIN, ADMIN.toUpperCase())).rejects.toMatchObject({ code: 'exclusion_propia' });
    await expect(service.excluir(ADMIN, DIANA)).rejects.toMatchObject({ code: 'usuario_no_valido' });
    await expect(service.excluir(ADMIN, '00000000-0000-4000-8000-0000000000ff')).rejects.toMatchObject({
      code: 'usuario_no_valido',
    });
    await expect(service.readmitir('no-es-uuid')).rejects.toMatchObject({ code: 'usuario_no_valido' });
    expect(await store.listarExcluidos(EVENTO.id)).toEqual([]);
  });

  it('excluir guarda el id en minúsculas, es idempotente y readmitir lo devuelve', async () => {
    const { store, service } = montar();
    await service.excluir(ADMIN, BRUNO.toUpperCase());
    await service.excluir(ADMIN, BRUNO);
    expect(await store.listarExcluidos(EVENTO.id)).toEqual([BRUNO]);
    await service.readmitir(BRUNO.toUpperCase());
    expect(await store.listarExcluidos(EVENTO.id)).toEqual([]);
    await service.readmitir(BRUNO);
  });

  it('el excluido no ve la invitación: la vista es 403 no_invitado', async () => {
    const { service } = await sinBruno();
    await expect(service.vista({ userId: BRUNO, esAdmin: false })).rejects.toMatchObject({ code: 'no_invitado', status: 403 });
  });

  it('el equipo de la vista no incluye a los excluidos', async () => {
    const { service } = await sinBruno();
    const { equipo } = await service.vista({ userId: ANA, esAdmin: false });
    expect(equipo.map((m) => m.nombre)).toEqual(['Ana Ruiz', 'Carla Gómez']);
  });

  it('miEstado dice invitado: false al excluido', async () => {
    const { service } = await sinBruno();
    expect((await service.miEstado(BRUNO)).invitado).toBe(false);
    expect((await service.miEstado(ANA)).invitado).toBe(true);
  });

  it('confirmar es 403 no_invitado, también con las confirmaciones cerradas', async () => {
    const { store, service, reloj } = await sinBruno();
    await expect(service.confirmar(BRUNO, { asiste: false })).rejects.toMatchObject({ code: 'no_invitado', status: 403 });
    reloj.ahora = TRAS_EL_CORTE;
    await expect(service.confirmar(BRUNO, { asiste: false })).rejects.toMatchObject({ code: 'no_invitado' });
    expect(store.confirmaciones).toEqual([]);
  });

  it('votar: el excluido es 403 no_invitado; votar a un excluido es usuario_no_valido', async () => {
    const { store, service, reloj } = await sinBruno();
    await expect(service.votar(BRUNO, ANA, { cualidades: ['Empatía'] })).rejects.toMatchObject({
      code: 'no_invitado',
      status: 403,
    });
    await expect(service.votar(ANA, BRUNO, { cualidades: ['Empatía'] })).rejects.toMatchObject({
      code: 'usuario_no_valido',
      status: 400,
    });
    expect(store.votos).toEqual([]);
    // Tras el inicio sigue mandando el cierre.
    reloj.ahora = TRAS_EL_EVENTO;
    await expect(service.votar(BRUNO, ANA, { cualidades: [] })).rejects.toMatchObject({ code: 'votos_cerrados' });
  });

  it('los votos de un excluido no cuentan, y al readmitirlo vuelven (nada se borra)', async () => {
    const { store, service } = montar();
    await service.votar(BRUNO, CARLA, { cualidades: ['Empatía'] });
    await service.votar(ANA, CARLA, { cualidades: ['Empatía'] });
    await service.excluir(ADMIN, BRUNO);
    const durante = await service.vista({ userId: ANA, esAdmin: true });
    expect(durante.equipo.find((m) => m.userId === CARLA)?.cualidades).toEqual([{ cualidad: 'Empatía', votos: 1 }]);
    expect(await store.votosDe(EVENTO.id, BRUNO)).toHaveLength(1);
    await service.readmitir(BRUNO);
    const despues = await service.vista({ userId: ANA, esAdmin: true });
    expect(despues.equipo.find((m) => m.userId === CARLA)?.cualidades).toEqual([{ cualidad: 'Empatía', votos: 2 }]);
  });

  it('el resumen deja fuera a los excluidos de filas y totales y los lista aparte; su respuesta se conserva', async () => {
    const { store, service } = montar();
    await brindar(store, ANA, BRUNO, CARLA);
    await brindar(store, BRUNO, ANA, CARLA);
    await service.confirmar(ANA, { asiste: true, preferencia: 'general' });
    await service.confirmar(BRUNO, { asiste: true, preferencia: 'vegetariano' });
    await service.excluir(ADMIN, BRUNO);
    const resumen = await service.resumen();
    expect(resumen.filas.map((f) => f.userId)).toEqual([ANA, CARLA]);
    expect(resumen.totales).toEqual({ van: 1, noVan: 0, sinResponder: 1 });
    expect(resumen.porPreferencia.find((p) => p.codigo === 'vegetariano')?.total).toBe(0);
    expect(resumen.excluidos).toEqual([{ userId: BRUNO, nombre: 'Bruno Díaz' }]);

    await service.readmitir(BRUNO);
    const de_nuevo = await service.resumen();
    expect(de_nuevo.excluidos).toEqual([]);
    expect(de_nuevo.totales).toEqual({ van: 2, noVan: 0, sinResponder: 1 });
    expect(de_nuevo.filas.find((f) => f.userId === BRUNO)?.preferencia).toBe('vegetariano');
  });

  it('los excluidos inactivos no salen en excluidos', async () => {
    const { store, service } = montar();
    await store.excluir(EVENTO.id, DIANA, ANTES_DEL_CORTE);
    expect((await service.resumen()).excluidos).toEqual([]);
  });
});
