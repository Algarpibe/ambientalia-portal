import { describe, it, expect } from 'vitest';
import { construirPayload, eventosDeAlta } from './notificaciones.js';
import { CALENDARIO_STAFF, CARPETA_DRIVE, HOJA_ID, PESTANA } from './config.js';
import type { Solicitud } from './types.js';

function solicitud(over: Partial<Solicitud> = {}): Solicitud {
  return {
    id: 's1',
    tipo: 'vacaciones',
    empleadoId: 'e1',
    empleadoNombre: 'Ana Ruiz',
    empleadoCargo: 'Analista',
    solicitanteEmail: 'ana.ruiz@ambientalia.com.co',
    fechaInicio: '2026-07-06',
    fechaFin: '2026-07-10',
    diasHabiles: 5,
    comentarios: 'Viaje familiar',
    observaciones: null,
    origen: 'portal',
    estado: 'pendiente',
    aprobadorCorreo: 'comercial@ambientalia.com.co',
    decididaAt: null,
    motivoRechazo: null,
    createdAt: '2026-06-01T10:00:00Z',
    adjunto: null,
    ...over,
  };
}

const pdf = {
  id: 'a1',
  nombreArchivo: 'Incapacidades_Ana_Ruiz_2026-07-06_1.pdf',
  mime: 'application/pdf',
  bytes: 10,
  driveFileId: null,
};

describe('eventosDeAlta', () => {
  it('una solicitud aprobable genera acuse y aviso, en ese orden', () => {
    // Dos eventos y no uno: cada evento de la cola es exactamente un correo, y
    // eso es lo que permite que el flujo de n8n sea una cadena lineal.
    expect(eventosDeAlta('vacaciones')).toEqual(['creada', 'aprobacion']);
    expect(eventosDeAlta('permiso')).toEqual(['creada', 'aprobacion']);
    expect(eventosDeAlta('compensatorio')).toEqual(['creada', 'aprobacion']);
  });

  it('la incapacidad genera un único evento: no hay a quién pedirle permiso', () => {
    expect(eventosDeAlta('incapacidad')).toEqual(['registrada']);
  });
});

describe('correos', () => {
  it('el acuse va solo al solicitante y le dice que espere respuesta', () => {
    const p = construirPayload(solicitud(), 'creada');
    expect(p.correo.para).toBe('ana.ruiz@ambientalia.com.co');
    expect(p.correo.asunto).toContain('registrada exitosamente');
    expect(p.correo.cuerpo).toContain('Ana Ruiz');
    expect(p.correo.cuerpo).toContain('5 días hábiles');
    expect(p.correo.cuerpo).toContain('Te informaremos');
  });

  it('el aviso al aprobador lleva el enlace al portal, no un formulario de correo', () => {
    // El cambio de fondo frente al flujo viejo: nada de sendAndWait dejando la
    // ejecución de n8n colgada esperando una respuesta.
    const p = construirPayload(solicitud(), 'aprobacion');
    expect(p.correo.para).toBe('comercial@ambientalia.com.co');
    expect(p.correo.asunto).toBe('Solicitud de vacaciones de Ana Ruiz');
    expect(p.correo.cuerpo).toContain('/ausencias');
    expect(p.correo.cuerpo).toContain('aprobarla o rechazarla');
  });

  it('el correo de aprobado va también a administración', () => {
    const p = construirPayload(solicitud({ estado: 'aprobada' }), 'aprobada');
    expect(p.correo.para).toBe(
      'ana.ruiz@ambientalia.com.co, comercial@ambientalia.com.co, administrativo@ambientalia.com.co',
    );
    expect(p.correo.asunto).toContain('✅');
    expect(p.correo.cuerpo).toContain('¡Disfrútalas!');
  });

  it('un compensatorio aprobado no dice «¡Disfrútalas!»', () => {
    const p = construirPayload(solicitud({ tipo: 'compensatorio', estado: 'aprobada' }), 'aprobada');
    expect(p.correo.cuerpo).not.toContain('Disfrútalas');
  });

  it('el rechazo explica el motivo — el correo viejo no lo decía', () => {
    const p = construirPayload(
      solicitud({ estado: 'rechazada', motivoRechazo: 'Coincide con el cierre contable' }),
      'rechazada',
    );
    expect(p.correo.asunto).toContain('❌');
    expect(p.correo.cuerpo).toContain('Motivo: Coincide con el cierre contable');
  });

  it('sin motivo, el rechazo no deja un «Motivo:» vacío colgando', () => {
    const p = construirPayload(solicitud({ estado: 'rechazada' }), 'rechazada');
    expect(p.correo.cuerpo).not.toContain('Motivo:');
  });

  it('el acuse de incapacidad va con copia a administración y desea recuperación', () => {
    const p = construirPayload(solicitud({ tipo: 'incapacidad', estado: 'registrada', adjunto: pdf }), 'registrada');
    expect(p.correo.para).toContain('administrativo@ambientalia.com.co');
    expect(p.correo.cuerpo).toContain('pronta recuperación');
  });

  it('menciona el adjunto solo si existe', () => {
    expect(construirPayload(solicitud({ adjunto: pdf }), 'creada').correo.cuerpo).toContain(
      'Incapacidades_Ana_Ruiz_2026-07-06_1.pdf',
    );
    // El flujo viejo escribía «undefined» en el correo cuando no había adjunto.
    expect(construirPayload(solicitud(), 'creada').correo.cuerpo).not.toContain('undefined');
    expect(construirPayload(solicitud(), 'creada').correo.cuerpo).not.toContain('Documento adjunto');
  });

  it('nunca deja un «undefined» ni un «null» en ningún correo', () => {
    const casos = [
      construirPayload(solicitud({ comentarios: null }), 'creada'),
      construirPayload(solicitud({ comentarios: null }), 'aprobacion'),
      construirPayload(solicitud({ comentarios: null, estado: 'aprobada' }), 'aprobada'),
      construirPayload(solicitud({ comentarios: null, estado: 'rechazada' }), 'rechazada'),
      construirPayload(solicitud({ tipo: 'incapacidad', comentarios: null, estado: 'registrada' }), 'registrada'),
    ];
    for (const p of casos) {
      expect(p.correo.cuerpo).not.toMatch(/undefined|null|\[object/);
      expect(p.correo.asunto).not.toMatch(/undefined|null/);
      expect(p.correo.para).toBeTruthy();
    }
  });

  it('escribe «1 día hábil» en singular', () => {
    const p = construirPayload(solicitud({ diasHabiles: 1 }), 'creada');
    expect(p.correo.cuerpo).toContain('1 día hábil');
    expect(p.correo.cuerpo).not.toContain('1 días');
  });
});

describe('efectos en Google, repartidos sin duplicar', () => {
  it('la creación no toca calendario, hoja ni Drive: aún no es firme', () => {
    const p = construirPayload(solicitud({ adjunto: pdf }), 'creada');
    expect(p.calendario).toBeNull();
    expect(p.hoja).toBeNull();
    expect(p.drive).toBeNull();
  });

  it('el aviso al aprobador sube el PDF, para que pueda verlo antes de decidir', () => {
    const p = construirPayload(solicitud({ tipo: 'permiso', adjunto: pdf }), 'aprobacion');
    expect(p.drive).toEqual({
      adjuntoId: 'a1',
      nombreArchivo: 'Incapacidades_Ana_Ruiz_2026-07-06_1.pdf',
      driveId: expect.any(String),
      carpetaId: CARPETA_DRIVE.permiso,
    });
  });

  it('la aprobación crea el evento de calendario con el fin exclusivo de Google', () => {
    // Sin el +1, el último día de las vacaciones no se pinta en el calendario.
    const p = construirPayload(solicitud({ estado: 'aprobada' }), 'aprobada');
    expect(p.calendario).toEqual({
      calendarId: CALENDARIO_STAFF,
      resumen: 'Vacaciones Ana Ruiz',
      inicio: '2026-07-06',
      fin: '2026-07-11',
    });
  });

  it('un rechazo va a la hoja pero NO al calendario: no hay ausencia que pintar', () => {
    const p = construirPayload(solicitud({ estado: 'rechazada' }), 'rechazada');
    expect(p.calendario).toBeNull();
    expect(p.hoja?.columnas['Aprobado?']).toBe('No');
  });

  it('cada tipo escribe en su pestaña de siempre', () => {
    expect(construirPayload(solicitud({ estado: 'aprobada' }), 'aprobada').hoja).toMatchObject({
      documentId: HOJA_ID,
      pestana: PESTANA.vacaciones,
    });
    expect(
      construirPayload(solicitud({ tipo: 'compensatorio', estado: 'aprobada' }), 'aprobada').hoja?.pestana,
    ).toBe(PESTANA.compensatorio);
    expect(construirPayload(solicitud({ tipo: 'permiso', estado: 'aprobada' }), 'aprobada').hoja?.pestana).toBe(
      PESTANA.permiso,
    );
  });

  it('la pestaña de incapacidades tiene «Adjunto?» y no «Aprobado?»', () => {
    const p = construirPayload(solicitud({ tipo: 'incapacidad', estado: 'registrada', adjunto: pdf }), 'registrada');
    expect(p.hoja?.pestana).toBe(PESTANA.incapacidad);
    expect(p.hoja?.columnas['Adjunto?']).toBe(pdf.nombreArchivo);
    expect(p.hoja?.columnas['Aprobado?']).toBeUndefined();
  });

  it('la incapacidad hace calendario, hoja y Drive de una sola vez', () => {
    // Es su único evento: si algo no se hiciera aquí, no se haría nunca.
    const p = construirPayload(solicitud({ tipo: 'incapacidad', estado: 'registrada', adjunto: pdf }), 'registrada');
    expect(p.calendario).not.toBeNull();
    expect(p.hoja).not.toBeNull();
    expect(p.drive).not.toBeNull();
  });

  it('sin adjunto no hay subida a Drive', () => {
    expect(construirPayload(solicitud({ tipo: 'permiso' }), 'aprobacion').drive).toBeNull();
  });

  it('vacaciones y compensatorios no tienen carpeta de Drive, así que nunca suben nada', () => {
    expect(construirPayload(solicitud({ adjunto: pdf }), 'aprobacion').drive).toBeNull();
    expect(construirPayload(solicitud({ tipo: 'compensatorio', adjunto: pdf }), 'aprobacion').drive).toBeNull();
  });

  it('la fila de la hoja lleva los encabezados literales de la hoja actual', () => {
    // Nómina consulta estas pestañas: si un encabezado cambia, la columna se
    // crea en blanco al final y el dato se pierde de vista.
    const p = construirPayload(solicitud({ estado: 'aprobada' }), 'aprobada');
    expect(Object.keys(p.hoja!.columnas).sort()).toEqual(
      ['Aprobado?', 'Comentarios', 'Días', 'Fecha Fin', 'Fecha Inicio', 'Nombre y Apellidos', 'Tipo'].sort(),
    );
    expect(p.hoja!.columnas.Tipo).toBe('Vacaciones');
    expect(p.hoja!.columnas['Días']).toBe(5);
  });
});
