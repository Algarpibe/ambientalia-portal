import { describe, it, expect } from 'vitest';
import type { Nota } from './api';
import {
  MAX_IMAGEN_BYTES,
  errorDeImagen,
  fechaCorta,
  filtrarNotas,
  ordenarNotas,
  textoDeErrorDeNota,
} from './notas';

const nota = (over: Partial<Nota> = {}): Nota => ({
  id: 'n1',
  empleadoId: 'e1',
  empleadoNombre: 'Ana Ruiz',
  categoria: 'retraso',
  fecha: '2026-11-12',
  comentario: 'Llega tarde',
  estado: 'abierta',
  resueltaAt: null,
  createdAt: '2026-11-12T10:00:00.000Z',
  updatedAt: '2026-11-12T10:00:00.000Z',
  imagen: null,
  ...over,
});

describe('filtrarNotas', () => {
  const notas = [
    nota({ id: 'a' }),
    nota({ id: 'b', estado: 'resuelta', categoria: 'otro' }),
    nota({ id: 'c', categoria: 'solicitud', empleadoNombre: 'Beto Díaz' }),
  ];
  const ids = (f: Parameters<typeof filtrarNotas>[1]) => filtrarNotas(notas, f).map((n) => n.id);

  it('por estado', () => {
    expect(ids({ categoria: '', estado: 'abierta', empleadoNombre: '' })).toEqual(['a', 'c']);
    expect(ids({ categoria: '', estado: 'resuelta', empleadoNombre: '' })).toEqual(['b']);
    expect(ids({ categoria: '', estado: 'todas', empleadoNombre: '' })).toEqual(['a', 'b', 'c']);
  });

  it('por categoría y por persona', () => {
    expect(ids({ categoria: 'solicitud', estado: 'todas', empleadoNombre: '' })).toEqual(['c']);
    expect(ids({ categoria: '', estado: 'todas', empleadoNombre: 'Ana Ruiz' })).toEqual(['a', 'b']);
  });
});

describe('ordenarNotas', () => {
  it('por fecha descendente y, a igual fecha, la última escrita primero', () => {
    const r = ordenarNotas([
      nota({ id: 'vieja', fecha: '2026-11-01' }),
      nota({ id: 'temprano', fecha: '2026-11-12', createdAt: '2026-11-12T08:00:00.000Z' }),
      nota({ id: 'tarde', fecha: '2026-11-12', createdAt: '2026-11-12T18:00:00.000Z' }),
    ]);
    expect(r.map((n) => n.id)).toEqual(['tarde', 'temprano', 'vieja']);
  });
});

describe('fechaCorta', () => {
  it('pasa YYYY-MM-DD a DD/MM/YYYY', () => {
    expect(fechaCorta('2026-11-02')).toBe('02/11/2026');
  });
});

describe('errorDeImagen', () => {
  // Literales y no `MIMES_IMAGEN`: iterar la propia lista haría desaparecer el
  // test de un formato si alguien lo quitara de ella.
  it.each(['image/jpeg', 'image/png', 'image/webp'])('admite %s', (type) => {
    expect(errorDeImagen({ type, size: 1000 })).toBeNull();
  });

  it('el tope de 8 MB es inclusivo: justo 8 MB vale y un byte más no', () => {
    expect(errorDeImagen({ type: 'image/png', size: MAX_IMAGEN_BYTES })).toBeNull();
    expect(errorDeImagen({ type: 'image/png', size: MAX_IMAGEN_BYTES + 1 })).toMatch(/8 MB/);
  });

  it('rechaza otros formatos', () => {
    expect(errorDeImagen({ type: 'image/gif', size: 1000 })).toMatch(/JPG, PNG o WebP/);
  });

  it('rechaza más de 8 MB y dice cuánto pesa', () => {
    expect(errorDeImagen({ type: 'image/jpeg', size: 9 * 1024 * 1024 })).toMatch(/9\.0 MB/);
  });
});

describe('textoDeErrorDeNota', () => {
  it('traduce los códigos de hub-api y deja pasar el resto', () => {
    expect(textoDeErrorDeNota('imagen_no_admitida')).toMatch(/JPG, PNG o WebP/);
    expect(textoDeErrorDeNota('Tu sesión ha caducado.')).toBe('Tu sesión ha caducado.');
  });

  // Los 10 códigos de 400 y los 3 de 404 que puede devolver hub-api: ninguno
  // puede llegar a pantalla tal cual.
  it.each([
    'categoria_invalida',
    'estado_invalido',
    'fecha_invalida',
    'comentario_vacio',
    'comentario_invalido',
    'comentario_demasiado_largo',
    'nombre_archivo_invalido',
    'imagen_no_admitida',
    'imagen_demasiado_grande',
    'sin_cambios',
    'nota_no_encontrada',
    'empleado_no_encontrado',
    'imagen_no_encontrada',
  ])('traduce %s', (codigo) => {
    expect(textoDeErrorDeNota(codigo)).not.toBe(codigo);
  });
});
