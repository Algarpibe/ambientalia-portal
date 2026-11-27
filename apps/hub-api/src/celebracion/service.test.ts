import { describe, it, expect } from 'vitest';
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

  it('cada tarjeta trae su top 3 con número, sin contar votos de cuentas inactivas', async () => {
    const { store, service } = montar();
    await store.reemplazarVotos(EVENTO.id, ANA, BRUNO, ['Empatía', 'Liderazgo'], ANTES_DEL_CORTE);
    await store.reemplazarVotos(EVENTO.id, CARLA, BRUNO, ['Empatía'], ANTES_DEL_CORTE);
    await store.reemplazarVotos(EVENTO.id, DIANA, BRUNO, ['Compromiso', 'Creatividad', 'Generosidad'], ANTES_DEL_CORTE);
    const { equipo } = await service.vista({ userId: ANA, esAdmin: false });
    expect(equipo.find((m) => m.userId === BRUNO)?.cualidades).toEqual([
      { cualidad: 'Empatía', votos: 2 },
      { cualidad: 'Liderazgo', votos: 1 },
    ]);
    expect(equipo.find((m) => m.userId === CARLA)?.cualidades).toEqual([]);
  });

  it('trae mis votos por compañero y mi respuesta', async () => {
    const { store, service } = montar();
    await store.reemplazarVotos(EVENTO.id, ANA, BRUNO, ['Empatía'], ANTES_DEL_CORTE);
    await store.reemplazarVotos(EVENTO.id, CARLA, BRUNO, ['Liderazgo'], ANTES_DEL_CORTE);
    await service.confirmar(ANA, { asiste: true, preferencia: 'vegetariano', mensaje: '¡Allá estaré!' });
    const vista = await service.vista({ userId: ANA, esAdmin: false });
    expect(vista.misVotos).toEqual({ [BRUNO]: ['Empatía'] });
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
});

describe('miEstado', () => {
  it('dice si he respondido y si las confirmaciones siguen abiertas', async () => {
    const { service, reloj } = montar();
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
    await expect(service.confirmar(ANA, { asiste: true, preferencia: 'carne' })).rejects.toMatchObject({
      code: 'preferencia_invalida',
    });
    expect(store.confirmaciones).toHaveLength(0);
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

describe('resumen', () => {
  it('cuenta van, no van y sin responder entre los activos, con los menús de quienes van', async () => {
    const { store, service } = montar();
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
    const durante = await service.vista({ userId: ANA, esAdmin: false });
    expect(durante.equipo.find((m) => m.userId === CARLA)?.cualidades).toEqual([{ cualidad: 'Empatía', votos: 1 }]);
    expect(await store.votosDe(EVENTO.id, BRUNO)).toHaveLength(1);
    await service.readmitir(BRUNO);
    const despues = await service.vista({ userId: ANA, esAdmin: false });
    expect(despues.equipo.find((m) => m.userId === CARLA)?.cualidades).toEqual([{ cualidad: 'Empatía', votos: 2 }]);
  });

  it('el resumen deja fuera a los excluidos de filas y totales y los lista aparte; su respuesta se conserva', async () => {
    const { service } = montar();
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
