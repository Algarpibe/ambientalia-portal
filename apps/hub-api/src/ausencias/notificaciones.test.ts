import { describe, it, expect } from 'vitest';
import { construirPayload, eventosDeAlta } from './notificaciones.js';
import { CALENDARIO_STAFF, HOJA_ID, PESTANA } from './config.js';
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
    segundoAprobadorCorreo: null,
    informadoCorreo: null,
    primeraFirmaAt: null,
    decididaAt: null,
    motivoRechazo: null,
    createdAt: '2026-06-01T10:00:00Z',
    adjunto: null,
    // La migración 021 deja a toda la plantilla con este valor sembrado: un
    // helper con `null` describiría un estado que en producción no existe.
    copiaCorreo: 'administrativo@ambientalia.com.co',
    ...over,
  };
}

const SEGUNDO = 'gerencia@ambientalia.com.co';

const pdf = {
  id: 'a1',
  nombreArchivo: 'Incapacidades_Ana_Ruiz_2026-07-06_1.pdf',
  mime: 'application/pdf',
  bytes: 10,
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

  it('el correo de aprobado lleva también la copia de la ficha, además del aprobador', () => {
    // Ya no ejercita el dedup: con el modelo nuevo el aprobador por defecto
    // (comercial@) y la copia por defecto (administrativo@) son buzones
    // distintos. Esa cobertura la da «una copia que ya firma no se duplica»,
    // más abajo; este test solo fija que la copia se suma a la cadena.
    const p = construirPayload(solicitud({ estado: 'aprobada' }), 'aprobada');
    expect(p.correo.para).toBe(
      'ana.ruiz@ambientalia.com.co, comercial@ambientalia.com.co, administrativo@ambientalia.com.co',
    );
    expect(p.correo.asunto).toContain('✅');
    expect(p.correo.cuerpo).toContain('¡Disfrútalas!');
  });

  it('la decisión avisa a TODA la cadena que la firmó, no solo al final', () => {
    // El fallo real: el jefe inmediato daba su visto bueno y no volvía a saber en
    // qué acabó. Parecía funcionar porque el segundo firmante suele ser el mismo
    // buzón que ya iba en copia a administración.
    const p = construirPayload(
      solicitud({
        estado: 'aprobada',
        aprobadorCorreo: 'jefa.directa@ambientalia.com.co',
        segundoAprobadorCorreo: 'gerencia@ambientalia.com.co',
      }),
      'aprobada',
    );
    // `comercial@` ya no aparece aquí: era la mitad fija de la vieja constante,
    // pero en esta solicitud no es ni aprobador ni la copia de la ficha.
    expect(p.correo.para).toBe(
      'ana.ruiz@ambientalia.com.co, jefa.directa@ambientalia.com.co, gerencia@ambientalia.com.co, administrativo@ambientalia.com.co',
    );
  });

  it('el rechazo avisa a la misma cadena: el jefe tiene que enterarse', () => {
    const p = construirPayload(
      solicitud({
        estado: 'rechazada',
        motivoRechazo: 'coincide con el cierre',
        aprobadorCorreo: 'jefa.directa@ambientalia.com.co',
        segundoAprobadorCorreo: 'gerencia@ambientalia.com.co',
      }),
      'rechazada',
    );
    expect(p.correo.para).toContain('jefa.directa@ambientalia.com.co');
    expect(p.correo.para).toContain('gerencia@ambientalia.com.co');
  });

  it('no repite un correo que ya iba en la lista, aunque cambie la grafía', () => {
    const p = construirPayload(
      solicitud({ estado: 'aprobada', aprobadorCorreo: 'ANA.RUIZ@ambientalia.com.co', segundoAprobadorCorreo: null }),
      'aprobada',
    );
    // Sin `comercial@`: ya no es aprobador en esta solicitud ni la copia de la
    // ficha, así que la vieja constante de dos buzones no aplica.
    expect(p.correo.para).toBe('ana.ruiz@ambientalia.com.co, administrativo@ambientalia.com.co');
  });

  it('sin segunda firma no deja un hueco en la lista de destinatarios', () => {
    // `segundoAprobadorCorreo` es null en toda cadena de una sola firma, que hoy
    // es la mayoría: sin filtrar los vacíos saldría un «, ,» en medio.
    const p = construirPayload(
      solicitud({ estado: 'aprobada', aprobadorCorreo: 'jefa.directa@ambientalia.com.co', segundoAprobadorCorreo: null }),
      'aprobada',
    );
    // Sin `comercial@`: no es aprobador aquí ni la copia de la ficha.
    expect(p.correo.para).toBe(
      'ana.ruiz@ambientalia.com.co, jefa.directa@ambientalia.com.co, administrativo@ambientalia.com.co',
    );
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
      construirPayload(
        solicitud({ comentarios: null, estado: 'pendiente_2', segundoAprobadorCorreo: SEGUNDO }),
        'aprobacion_2',
      ),
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

describe('la segunda firma', () => {
  const enCascada = (over = {}) =>
    solicitud({ estado: 'pendiente_2', segundoAprobadorCorreo: SEGUNDO, ...over });

  it('el aviso va SOLO al segundo aprobador, sin copia a administración', () => {
    // A diferencia de los correos de decisión: esto es un trámite interno, no un
    // veredicto. Administración no necesita enterarse de cada escalón.
    const p = construirPayload(enCascada(), 'aprobacion_2');
    expect(p.correo.para).toBe(SEGUNDO);
  });

  it('dice que ya tiene el visto bueno del jefe y que falta la suya', () => {
    const p = construirPayload(enCascada(), 'aprobacion_2');
    expect(p.correo.cuerpo).toContain('visto bueno de su jefe inmediato');
    expect(p.correo.cuerpo).toContain('quede en firme');
  });

  it('el primer aviso sigue yendo al jefe inmediato aunque haya segundo', () => {
    const p = construirPayload(solicitud({ segundoAprobadorCorreo: SEGUNDO }), 'aprobacion');
    expect(p.correo.para).toBe('comercial@ambientalia.com.co');
  });

  it('el acuse anuncia las dos firmas solo cuando las hay', () => {
    expect(construirPayload(solicitud({ segundoAprobadorCorreo: SEGUNDO }), 'creada').correo.cuerpo).toContain(
      'dos aprobaciones',
    );
    expect(construirPayload(solicitud(), 'creada').correo.cuerpo).not.toContain('dos aprobaciones');
  });

  it('una incapacidad nunca anuncia dos firmas: no se aprueba', () => {
    const p = construirPayload(solicitud({ tipo: 'incapacidad', estado: 'registrada' }), 'registrada');
    expect(p.correo.cuerpo).not.toContain('dos aprobaciones');
  });
});

describe('efectos en Google, repartidos sin duplicar', () => {
  it('el payload no lleva campo `drive`, ni siquiera a null', () => {
    // `not.toHaveProperty` y no `toBeNull()`: la copia a Drive se retiró junto con
    // los nodos de n8n que la hacían, y el IF que los gobernaba comparaba
    // `payload.drive !== null`. Reintroducir el campo «por compatibilidad»
    // resucitaría una rama que ya no existe; dejarlo en `undefined` la activaría
    // para TODOS los eventos. Un `toBeNull()` no distinguiría ninguno de los dos.
    const p = construirPayload(solicitud({ tipo: 'permiso', adjunto: pdf }), 'aprobacion');
    expect(p).not.toHaveProperty('drive');
  });

  it('la creación no toca calendario ni hoja: aún no es firme', () => {
    const p = construirPayload(solicitud({ adjunto: pdf }), 'creada');
    expect(p.calendario).toBeNull();
    expect(p.hoja).toBeNull();
  });

  it('el aviso al aprobador es SOLO correo, aunque haya PDF', () => {
    // Mata el error de dedo de tocar `conCalendario` o `conHoja` al quitar
    // `conDrive`: una solicitud aún pendiente no puede crear el evento de
    // calendario ni la fila de la hoja de Nómina.
    const p = construirPayload(solicitud({ tipo: 'permiso', adjunto: pdf }), 'aprobacion');
    expect(p.calendario).toBeNull();
    expect(p.hoja).toBeNull();
  });

  it('la segunda firma tampoco toca calendario ni hoja', () => {
    const p = construirPayload(
      solicitud({ tipo: 'permiso', adjunto: pdf, estado: 'pendiente_2', segundoAprobadorCorreo: SEGUNDO }),
      'aprobacion_2',
    );
    expect(p.calendario).toBeNull();
    expect(p.hoja).toBeNull();
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

  it('la incapacidad hace calendario y hoja de una sola vez', () => {
    // Es su único evento: si algo no se hiciera aquí, no se haría nunca.
    const p = construirPayload(solicitud({ tipo: 'incapacidad', estado: 'registrada', adjunto: pdf }), 'registrada');
    expect(p.calendario).not.toBeNull();
    expect(p.hoja).not.toBeNull();
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

describe('la copia sale de la ficha del empleado', () => {
  it('entra en el correo de aprobada', () => {
    const p = construirPayload(solicitud({ estado: 'aprobada', copiaCorreo: 'copia@ambientalia.com.co' }), 'aprobada');
    expect(p.correo.para).toContain('copia@ambientalia.com.co');
  });

  it('entra en el correo de rechazada', () => {
    const p = construirPayload(solicitud({ estado: 'rechazada', copiaCorreo: 'copia@ambientalia.com.co' }), 'rechazada');
    expect(p.correo.para).toContain('copia@ambientalia.com.co');
  });

  it('entra en el acuse de una incapacidad', () => {
    const p = construirPayload(solicitud({ tipo: 'incapacidad', copiaCorreo: 'copia@ambientalia.com.co' }), 'registrada');
    expect(p.correo.para).toContain('copia@ambientalia.com.co');
  });

  it('gerencia sigue en copia de las incapacidades aunque la ficha diga otra cosa', () => {
    // Una incapacidad no genera evento de decisión, así que este buzón NO llega
    // por la cadena de firmas como en aprobada/rechazada: si no fuera fijo aquí,
    // gerencia dejaría de enterarse de las incapacidades.
    const p = construirPayload(solicitud({ tipo: 'incapacidad', copiaCorreo: 'copia@ambientalia.com.co' }), 'registrada');
    expect(p.correo.para).toContain('comercial@ambientalia.com.co');
    expect(p.correo.para).toContain('copia@ambientalia.com.co');
  });

  it('NO entra en el acuse de una solicitud normal', () => {
    // Este test existe para que la copia no se convierta en una ampliación
    // silenciosa: el acuse de vacaciones nunca ha llevado copia y no debe
    // empezar a llevarla ahora.
    const p = construirPayload(solicitud({ tipo: 'vacaciones', copiaCorreo: 'copia@ambientalia.com.co' }), 'creada');
    expect(p.correo.para).not.toContain('copia@ambientalia.com.co');
  });

  it('NO entra en el aviso al aprobador', () => {
    const p = construirPayload(solicitud({ copiaCorreo: 'copia@ambientalia.com.co' }), 'aprobacion');
    expect(p.correo.para).not.toContain('copia@ambientalia.com.co');
  });

  it('con `copiaCorreo: null` no deja un destinatario vacío', () => {
    // `destinatarios()` filtra nulos; sin eso saldría una coma suelta en el
    // `sendTo` de Gmail, que es un correo a nadie con pinta de correo válido.
    const p = construirPayload(solicitud({ estado: 'aprobada', copiaCorreo: null }), 'aprobada');
    expect(p.correo.para).not.toMatch(/,\s*,|,\s*$/);
  });

  it('una copia que ya firma no se duplica', () => {
    const s = solicitud({ estado: 'aprobada', aprobadorCorreo: 'jefe@ambientalia.com.co', copiaCorreo: 'jefe@ambientalia.com.co' });
    const p = construirPayload(s, 'aprobada');
    expect(p.correo.para.match(/jefe@ambientalia\.com\.co/g)).toHaveLength(1);
  });
});

describe('cuando la segunda firma está apagada', () => {
  const INFORMADO = 'gerencia@ambientalia.com.co';

  // Una solicitud de firma única con alguien de segundo nivel al que solo se le
  // informa: `segundo` en null e `informado` con valor, que es la invariante.
  const conInformado = (over = {}) =>
    solicitud({ segundoAprobadorCorreo: null, informadoCorreo: INFORMADO, ...over });

  it('la aprobación llega también a quien no firmó', () => {
    const p = construirPayload(conInformado({ estado: 'aprobada' }), 'aprobada');
    expect(p.correo.para).toBe(
      'ana.ruiz@ambientalia.com.co, comercial@ambientalia.com.co, gerencia@ambientalia.com.co, administrativo@ambientalia.com.co',
    );
  });

  it('el rechazo también: quien reorganiza el trabajo tiene que enterarse', () => {
    const p = construirPayload(conInformado({ estado: 'rechazada' }), 'rechazada');
    expect(p.correo.para).toContain(INFORMADO);
  });

  it('el acuse del alta NO lo lleva: solo el veredicto', () => {
    // Está informado del resultado, no metido en el trámite.
    const p = construirPayload(conInformado(), 'creada');
    expect(p.correo.para).toBe('ana.ruiz@ambientalia.com.co');
  });

  it('el aviso al aprobador NO lo lleva', () => {
    const p = construirPayload(conInformado(), 'aprobacion');
    expect(p.correo.para).toBe('comercial@ambientalia.com.co');
  });

  it('el acuse no anuncia dos aprobaciones, porque ya no las hay', () => {
    expect(construirPayload(conInformado(), 'creada').correo.cuerpo).not.toContain('dos aprobaciones');
  });

  it('no se duplica cuando el informado es además la copia de la ficha', () => {
    const p = construirPayload(
      conInformado({ estado: 'aprobada', copiaCorreo: INFORMADO }),
      'aprobada',
    );
    expect(p.correo.para).toBe(
      'ana.ruiz@ambientalia.com.co, comercial@ambientalia.com.co, gerencia@ambientalia.com.co',
    );
  });
});
