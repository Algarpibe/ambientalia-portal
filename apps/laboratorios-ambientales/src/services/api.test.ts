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

  it('recorta metodo: optionsFor ofrece el valor trimeado y applyFilters compara exacto', () => {
    expect(mapRecord({ ...RAW, m_todo: '  SM 2320 B  ' }).metodo).toBe('SM 2320 B');
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

// Los tests corren en el entorno 'node' de vitest, donde localStorage no existe:
// sin este stub readCache lanza ReferenceError, su catch lo traga y devuelve
// null, así que el camino del cache no se ejecutaría ni una vez.
describe('fetchLaboratorios: cache de localStorage', () => {
  // La clave lleva versión: el esquema de Laboratorio cambió y un cache escrito
  // por la versión anterior no debe leerse con el nuevo. Ver el describe de
  // «migración del cache v1» más abajo.
  const CACHE_KEY_DATA = 'labs_cache_v2_data';
  const CACHE_KEY_TIMESTAMP = 'labs_cache_v2_timestamp';
  const CACHE_DURATION = 24 * 60 * 60 * 1000;

  // Doble en memoria: solo los métodos que api.ts usa. `store` queda expuesto
  // para sembrar el cache y para cotejar lo que se escribió.
  function stubLocalStorage(seed: Record<string, string> = {}) {
    const store = new Map(Object.entries(seed));
    const setItem = vi.fn((k: string, v: string) => void store.set(k, v));
    const removeItem = vi.fn((k: string) => void store.delete(k));
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem,
      removeItem,
    });
    return { store, setItem, removeItem };
  }

  const cacheDe = (labs: unknown[], edad = 0) => ({
    [CACHE_KEY_DATA]: JSON.stringify(labs),
    [CACHE_KEY_TIMESTAMP]: String(Date.now() - edad),
  });

  it('con cache fresco no toca la red y devuelve lo cacheado', async () => {
    stubLocalStorage(cacheDe([mapRecord(RAW)]));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const data = await fetchLaboratorios();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(data).toHaveLength(1);
    expect(data[0].metodo).toBe('SM 2320 B');
  });

  it('con cache caducado (>24 h) vuelve a descargar y lo refresca', async () => {
    const { store } = stubLocalStorage(cacheDe([mapRecord(RAW)], CACHE_DURATION + 1000));
    const antes = store.get(CACHE_KEY_TIMESTAMP);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => page(3) });
    vi.stubGlobal('fetch', fetchMock);

    const data = await fetchLaboratorios();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(data).toHaveLength(3);
    expect(JSON.parse(store.get(CACHE_KEY_DATA) as string)).toHaveLength(3);
    expect(store.get(CACHE_KEY_TIMESTAMP)).not.toBe(antes);
  });

  it('tras una descarga con éxito deja el cache escrito: datos y timestamp', async () => {
    const { store } = stubLocalStorage();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => page(2) }));

    const antes = Date.now();
    await fetchLaboratorios();

    expect(JSON.parse(store.get(CACHE_KEY_DATA) as string)).toHaveLength(2);
    const ts = parseInt(store.get(CACHE_KEY_TIMESTAMP) as string, 10);
    expect(ts).toBeGreaterThanOrEqual(antes);
    expect(ts).toBeLessThanOrEqual(Date.now());
  });

  // El fallback que hoy no se prueba: más vale servir datos rancios que dejar
  // la app en blanco porque datos.gov.co esté caído.
  it('si la red falla y el cache está caducado, lo devuelve rancio en vez de lanzar', async () => {
    stubLocalStorage(cacheDe([mapRecord(RAW)], CACHE_DURATION + 1000));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));

    const data = await fetchLaboratorios();

    expect(data).toHaveLength(1);
    expect(data[0].metodo).toBe('SM 2320 B');
  });

  it('si la red falla y no hay cache que servir, lanza', async () => {
    stubLocalStorage();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));

    await expect(fetchLaboratorios()).rejects.toThrow('503');
  });

  // El dataset ronda los 3 MB y comparte los ~5 MB del origen con el portal.
  it('si setItem lanza por cuota devuelve los datos igual y no deja una entrada a medias', async () => {
    const { store, setItem, removeItem } = stubLocalStorage();
    setItem.mockImplementation(() => {
      throw new DOMException('exceeded the quota', 'QuotaExceededError');
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => page(2) }));

    const data = await fetchLaboratorios();

    // Los datos ya están en memoria: la sesión sigue funcionando.
    expect(data).toHaveLength(2);
    // Y el cache queda limpio, no a medias: ninguna de las dos claves sobrevive.
    expect(removeItem).toHaveBeenCalledWith(CACHE_KEY_DATA);
    expect(removeItem).toHaveBeenCalledWith(CACHE_KEY_TIMESTAMP);
    expect(store.has(CACHE_KEY_DATA)).toBe(false);
    expect(store.has(CACHE_KEY_TIMESTAMP)).toBe(false);
  });

  // La versión anterior de la app cacheaba con OTRO esquema bajo las claves sin
  // versionar. Al desplegar, esos navegadores traen ese cache: readCache hace
  // `JSON.parse(data) as Laboratorio[]` —un cast a ciegas que nada valida en
  // runtime— así que leerlo daría undefined en cada columna durante 24 h.
  describe('migración del cache v1', () => {
    const V1_KEY_DATA = 'labs_cache_data';
    const V1_KEY_TIMESTAMP = 'labs_cache_timestamp';

    // Un registro tal y como lo guardaba la versión anterior.
    const REGISTRO_V1 = {
      nombre_laboratorio: 'Lab Viejo',
      parametro: 'pH',
      estado: 'VIGENTE',
      municipio: 'Medellín',
    };

    it('ignora el cache v1 y vuelve a descargar, en vez de leerlo con el esquema nuevo', async () => {
      stubLocalStorage({
        [V1_KEY_DATA]: JSON.stringify([REGISTRO_V1]),
        [V1_KEY_TIMESTAMP]: String(Date.now()),
      });
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => page(2) });
      vi.stubGlobal('fetch', fetchMock);

      const data = await fetchLaboratorios();

      expect(fetchMock).toHaveBeenCalled();
      expect(data[0].nombreLaboratorio).toBe(RAW.nombre_del_laboratorio);
      expect(data[0].estado).toBe('Activa');
    });

    it('borra las claves de la v1 para liberar su cuota', async () => {
      const { store } = stubLocalStorage({
        [V1_KEY_DATA]: JSON.stringify([REGISTRO_V1]),
        [V1_KEY_TIMESTAMP]: String(Date.now()),
      });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => page(2) }));

      await fetchLaboratorios();

      expect(store.has(V1_KEY_DATA)).toBe(false);
      expect(store.has(V1_KEY_TIMESTAMP)).toBe(false);
    });

    // Sin esto, los ~3 MB de la v1 no se liberarían nunca en quien ya tenga
    // cache nuevo, y ocupan buena parte de los ~5 MB del origen.
    it('borra la v1 aunque el cache v2 esté fresco y no se toque la red', async () => {
      const { store } = stubLocalStorage({
        ...cacheDe([mapRecord(RAW)]),
        [V1_KEY_DATA]: JSON.stringify([REGISTRO_V1]),
        [V1_KEY_TIMESTAMP]: String(Date.now()),
      });
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      await fetchLaboratorios();

      expect(fetchMock).not.toHaveBeenCalled();
      expect(store.has(V1_KEY_DATA)).toBe(false);
      expect(store.has(V1_KEY_TIMESTAMP)).toBe(false);
    });
  });
});
