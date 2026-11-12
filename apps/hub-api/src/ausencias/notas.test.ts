import { describe, it, expect } from 'vitest';
import { detectarMimeImagen, validarCambioNota, validarNuevaNota } from './service.js';

// La validación de las notas personales, pura: sin base y sin HTTP.

const EMPLEADO = '11111111-1111-4111-8111-111111111111';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP')]);

const cuerpo = (over: Record<string, unknown> = {}) => ({
  empleadoId: EMPLEADO,
  categoria: 'retraso',
  fecha: '2026-11-12',
  comentario: '  Llega tarde por cita médica  ',
  ...over,
});
const imagen = (over: Record<string, unknown> = {}) => ({
  nombreArchivo: 'foto.jpg',
  mime: 'image/jpeg',
  contenidoBase64: JPEG.toString('base64'),
  ...over,
});
const falla = (f: () => unknown, code: string, status = 400) =>
  expect(f).toThrow(expect.objectContaining({ code, status }));

describe('detectarMimeImagen', () => {
  it('reconoce JPEG, PNG y WebP por sus primeros bytes', () => {
    expect(detectarMimeImagen(JPEG)).toBe('image/jpeg');
    expect(detectarMimeImagen(PNG)).toBe('image/png');
    expect(detectarMimeImagen(WEBP)).toBe('image/webp');
  });

  it('no reconoce un PDF, un SVG ni un fichero vacío', () => {
    expect(detectarMimeImagen(Buffer.from('%PDF-1.4'))).toBeNull();
    expect(detectarMimeImagen(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
    expect(detectarMimeImagen(Buffer.alloc(0))).toBeNull();
  });

  it('no reconoce lo que empieza como una firma real y no lo es', () => {
    const wave = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WAVE')]);
    expect(detectarMimeImagen(wave)).toBeNull();
    expect(detectarMimeImagen(Buffer.from([0xff, 0xd8, 0x00]))).toBeNull();
    expect(detectarMimeImagen(PNG.subarray(0, 7))).toBeNull();
  });
});

describe('validarNuevaNota', () => {
  it('devuelve la nota con el comentario recortado y sin imagen', () => {
    expect(validarNuevaNota(cuerpo())).toEqual({
      empleadoId: EMPLEADO,
      categoria: 'retraso',
      fecha: '2026-11-12',
      comentario: 'Llega tarde por cita médica',
      imagen: null,
    });
  });

  it('decodifica la imagen', () => {
    const n = validarNuevaNota(cuerpo({ imagen: imagen() }));
    expect(n.imagen?.mime).toBe('image/jpeg');
    expect(n.imagen?.contenido.equals(JPEG)).toBe(true);
  });

  it('un empleadoId que no es un UUID es un 404, como una ficha que no existe', () => {
    falla(() => validarNuevaNota(cuerpo({ empleadoId: 'e1' })), 'empleado_no_encontrado', 404);
  });

  it('un cuerpo que no es un objeto no revienta', () => {
    falla(() => validarNuevaNota(null), 'empleado_no_encontrado', 404);
  });

  it('rechaza una categoría desconocida', () => {
    falla(() => validarNuevaNota(cuerpo({ categoria: 'vacaciones' })), 'categoria_invalida');
  });

  it('rechaza una fecha imposible', () => {
    falla(() => validarNuevaNota(cuerpo({ fecha: '2026-02-30' })), 'fecha_invalida');
  });

  it('rechaza un comentario en blanco', () => {
    falla(() => validarNuevaNota(cuerpo({ comentario: '   ' })), 'comentario_vacio');
  });

  it('rechaza un comentario de más de 2000 caracteres', () => {
    falla(() => validarNuevaNota(cuerpo({ comentario: 'x'.repeat(2001) })), 'comentario_demasiado_largo');
  });

  it('rechaza una imagen sin nombre', () => {
    falla(() => validarNuevaNota(cuerpo({ imagen: imagen({ nombreArchivo: ' ' }) })), 'nombre_archivo_invalido');
  });

  // La lista de MIME no se puede aislar sin mocks: aquí cae ya por la firma de los bytes.
  it('rechaza un SVG declarado como imagen', () => {
    falla(() => validarNuevaNota(cuerpo({ imagen: imagen({ mime: 'image/svg+xml' }) })), 'imagen_no_admitida');
  });

  it('CANDADO: rechaza una imagen cuyos bytes no casan con el formato declarado', () => {
    falla(() => validarNuevaNota(cuerpo({ imagen: imagen({ mime: 'image/png' }) })), 'imagen_no_admitida');
  });

  it('rechaza una imagen que dice ser JPEG y está vacía', () => {
    falla(() => validarNuevaNota(cuerpo({ imagen: imagen({ contenidoBase64: '' }) })), 'imagen_no_admitida');
  });

  it('rechaza una imagen de más de 8 MB antes de mirar sus bytes', () => {
    const enorme = 'A'.repeat(12 * 1024 * 1024); // ~9 MB una vez decodificado
    falla(() => validarNuevaNota(cuerpo({ imagen: imagen({ contenidoBase64: enorme }) })), 'imagen_demasiado_grande');
  });

  it('una imagen que no es un objeto no se admite', () => {
    falla(() => validarNuevaNota(cuerpo({ imagen: 'foto.jpg' })), 'imagen_no_admitida');
  });

  it('una imagen null explícita es una nota sin imagen', () => {
    expect(validarNuevaNota(cuerpo({ imagen: null })).imagen).toBeNull();
  });

  it('rechaza un nombre de imagen de 201 caracteres', () => {
    falla(() => validarNuevaNota(cuerpo({ imagen: imagen({ nombreArchivo: 'a'.repeat(201) }) })), 'nombre_archivo_invalido');
  });

  it('rechaza un nombre de imagen que no es un texto', () => {
    falla(() => validarNuevaNota(cuerpo({ imagen: imagen({ nombreArchivo: {} }) })), 'nombre_archivo_invalido');
  });

  it('acepta un empleadoId en mayúsculas', () => {
    const id = EMPLEADO.toUpperCase();
    expect(validarNuevaNota(cuerpo({ empleadoId: id })).empleadoId).toBe(id);
  });

  it('rechaza un comentario con el carácter NUL', () => {
    falla(() => validarNuevaNota(cuerpo({ comentario: 'hola\u0000mundo' })), 'comentario_invalido');
  });

  it('rechaza un nombre de imagen con el carácter NUL', () => {
    falla(() => validarNuevaNota(cuerpo({ imagen: imagen({ nombreArchivo: 'fo\u0000to.jpg' }) })), 'nombre_archivo_invalido');
  });

  it('rechaza el año 0, que Postgres no tiene', () => {
    falla(() => validarNuevaNota(cuerpo({ fecha: '0000-01-01' })), 'fecha_invalida');
  });
});

describe('validarCambioNota', () => {
  it('sin ningún campo reconocido es sin_cambios', () => {
    falla(() => validarCambioNota({ nada: 1 }), 'sin_cambios');
  });

  it('admite cambiar solo el estado', () => {
    expect(validarCambioNota({ estado: 'resuelta' })).toEqual({ estado: 'resuelta' });
  });

  it('rechaza un estado desconocido', () => {
    falla(() => validarCambioNota({ estado: 'cerrada' }), 'estado_invalido');
  });

  it('imagen null significa quitarla, y viaja', () => {
    const c = validarCambioNota({ imagen: null });
    expect('imagen' in c).toBe(true);
    expect(c.imagen).toBeNull();
  });

  it('valida cada campo que trae', () => {
    expect(
      validarCambioNota({ empleadoId: EMPLEADO, categoria: 'otro', fecha: '2026-10-01', comentario: ' Otro ', imagen: imagen() }),
    ).toMatchObject({ empleadoId: EMPLEADO, categoria: 'otro', fecha: '2026-10-01', comentario: 'Otro' });
    falla(() => validarCambioNota({ comentario: '' }), 'comentario_vacio');
  });
});
