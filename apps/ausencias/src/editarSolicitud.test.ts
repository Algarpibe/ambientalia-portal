import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { editarSolicitud, type EdicionSolicitud } from './api';

// DATA-337 — hub-api rechaza con 409 `solicitud_cambiada` la corrección de una
// solicitud que alguien decidió mientras el admin tenía el formulario abierto.
// Sin traducirlo, la caja roja enseñaría el código crudo.

const campos: EdicionSolicitud = {
  empleadoId: '11111111-1111-4111-8111-111111111111',
  tipo: 'vacaciones',
  fechaInicio: '2026-11-02',
  fechaFin: '2026-11-06',
  dias: 5,
  estado: 'pendiente',
  estadoLeido: 'pendiente',
  comentarios: null,
  observaciones: null,
};

// `authHeaders()` lee el token de localStorage, que en Node no existe.
beforeEach(() => vi.stubGlobal('localStorage', { getItem: () => null }));
afterEach(() => vi.unstubAllGlobals());

describe('editarSolicitud', () => {
  it('manda el estado que vio el formulario', async () => {
    const fetchFalso = vi.fn(async () => new Response(JSON.stringify({ id: 's1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchFalso);
    await editarSolicitud('s1', campos);
    const init = (fetchFalso.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(init.body))).toMatchObject({ estado: 'pendiente', estadoLeido: 'pendiente' });
  });

  it('un 409 solicitud_cambiada se explica: alguien la decidió mientras se editaba', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'solicitud_cambiada', field: 'estado' }), { status: 409 })),
    );
    await expect(editarSolicitud('s1', campos)).rejects.toThrow(/cambió mientras la editabas/);
  });
});
