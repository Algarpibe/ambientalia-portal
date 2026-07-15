import { describe, it, expect, vi, afterEach } from 'vitest';
import { mapRecord, fetchLaboratorios, PAGE_SIZE } from './api';

// Registro real de la API, recortado a los campos que mapeamos.
const RAW = {
  c_digo_de_laboratorio: '1',
  estado_de_la_acreditaci_n: 'Activa',
  matriz: 'Agua',
  componente: 'Continental',
  actividad: 'Análisis',
  grupo: 'Fisicoquímicos',
  variable: 'Alcalinidad',
  t_cnica: 'Volumetría',
  m_todo: 'SM 2320 B',
  rango_de_trabajo: '5 mg CaCO3/L - 1 000 mg CaCO3/L',
  nombre_del_laboratorio: 'CORANTIOQUIA – LABORATORIO AMBIENTAL',
  nit: '811.000.231-7',
  contacto: 'Liliana María Taborda González',
  ciudad: 'Medellín',
  departamento: 'Antioquia',
  direcci_n: 'Carrera 65 No. 44A-32 Piso 4',
  tel_fono: '6044938888 Ext. 1807- 1800',
  correo: 'laboratorioaguas@corantioquia.gov.co',
  actos_administrativos_que: '0396 del 28 de marzo de 2022',
  desde: '2022-04-21T00:00:00.000',
  hasta: '---',
};

const page = (n: number) => Array.from({ length: n }, () => RAW);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('mapRecord', () => {
  it('mapea los nombres de campo reales de la API', () => {
    const lab = mapRecord(RAW);
    expect(lab.codigo).toBe('1');
    expect(lab.estado).toBe('Activa');
    expect(lab.variable).toBe('Alcalinidad');
    expect(lab.metodo).toBe('SM 2320 B');
    expect(lab.tecnica).toBe('Volumetría');
    expect(lab.rango).toBe('5 mg CaCO3/L - 1 000 mg CaCO3/L');
    expect(lab.nombreLaboratorio).toBe('CORANTIOQUIA – LABORATORIO AMBIENTAL');
    expect(lab.ciudad).toBe('Medellín');
    expect(lab.departamento).toBe('Antioquia');
    expect(lab.correo).toBe('laboratorioaguas@corantioquia.gov.co');
  });

  it('normaliza estado, matriz, componente y actividad al mapear', () => {
    const lab = mapRecord({ ...RAW, estado_de_la_acreditaci_n: 'ACTIVA', componente: 'Calidad del Aire' });
    expect(lab.estado).toBe('Activa');
    expect(lab.componente).toBe('Calidad del Aire');
  });

  it('NO altera la capitalización de variable: son nombres técnicos', () => {
    expect(mapRecord({ ...RAW, variable: 'pH' }).variable).toBe('pH');
    expect(mapRecord({ ...RAW, variable: 'Demanda Química de Oxígeno (DQO)' }).variable).toBe('Demanda Química de Oxígeno (DQO)');
    expect(mapRecord({ ...RAW, variable: '  n-Decano (C10)  ' }).variable).toBe('n-Decano (C10)');
  });

  it('convierte los campos ausentes en cadena vacía, no undefined', () => {
    const lab = mapRecord({ variable: 'pH' });
    expect(lab.nombreLaboratorio).toBe('');
    expect(lab.metodo).toBe('');
    expect(lab.estado).toBe('');
  });
});

describe('fetchLaboratorios', () => {
  it('pagina hasta agotar el dataset', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => page(PAGE_SIZE) })
      .mockResolvedValueOnce({ ok: true, json: async () => page(PAGE_SIZE) })
      .mockResolvedValueOnce({ ok: true, json: async () => page(37) });
    vi.stubGlobal('fetch', fetchMock);

    const data = await fetchLaboratorios();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(data).toHaveLength(PAGE_SIZE * 2 + 37);
  });

  it('pide offsets crecientes y ordena por :id para paginar estable', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => page(PAGE_SIZE) })
      .mockResolvedValueOnce({ ok: true, json: async () => page(1) });
    vi.stubGlobal('fetch', fetchMock);

    await fetchLaboratorios();

    expect(fetchMock.mock.calls[0][0]).toContain('$offset=0');
    expect(fetchMock.mock.calls[0][0]).toContain('$order=:id');
    expect(fetchMock.mock.calls[1][0]).toContain(`$offset=${PAGE_SIZE}`);
  });

  it('para en una sola petición si la primera página no está llena', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => page(10) });
    vi.stubGlobal('fetch', fetchMock);

    const data = await fetchLaboratorios();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(data).toHaveLength(10);
  });

  it('reporta el avance', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => page(PAGE_SIZE) })
      .mockResolvedValueOnce({ ok: true, json: async () => page(5) });
    vi.stubGlobal('fetch', fetchMock);
    const onProgress = vi.fn();

    await fetchLaboratorios(onProgress);

    expect(onProgress).toHaveBeenNthCalledWith(1, PAGE_SIZE);
    expect(onProgress).toHaveBeenNthCalledWith(2, PAGE_SIZE + 5);
  });

  it('lanza el error si la red falla y no hay cache, en vez de devolver vacío', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(fetchLaboratorios()).rejects.toThrow('503');
  });
});
