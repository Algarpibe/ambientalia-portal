import { describe, it, expect } from 'vitest';
import {
  construirPayload,
  construirPayloadBorrado,
  construirPayloadCorreccion,
  construirPayloadModificacion,
  eventosDeAlta,
  idDeEventoCalendario,
} from './notificaciones.js';
import { CALENDARIO_STAFF, COPIA_POR_DEFECTO, HOJA_ID, PESTANA } from './config.js';
import type { Modificacion, Solicitud } from './types.js';

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
    modificacionPendiente: null,
    anuladaAt: null,
    // `null` porque esta solicitud base esta `pendiente`: no ha creado ningun
    // evento. Los tests que prueban la correccion automatica lo ponen a mano,
    // igual que ponen `estado: 'aprobada'`.
    eventoCalendarioId: null,
    ...over,
  };
}

/**
 * Una propuesta de cambio de fechas, tipada. Nada de `as any`: el correo se
 * redacta sobre estos campos, y un fixture sin tipo dejaría pasar un renombrado
 * que solo se vería en el buzón de un jefe.
 */
function modificacion(over: Partial<Modificacion> = {}): Modificacion {
  return {
    id: 'm1',
    solicitudId: 's1',
    clase: 'fechas',
    estadoPrevio: 'aprobada',
    fechaInicioPrevia: '2026-07-06',
    fechaFinPrevia: '2026-07-10',
    diasHabilesPrevios: 5,
    fechaInicioNueva: '2026-07-13',
    fechaFinNueva: '2026-07-15',
    diasHabilesNuevos: 3,
    motivo: 'Me han adelantado la cita del especialista',
    estado: 'pendiente',
    aprobadorCorreo: 'comercial@ambientalia.com.co',
    solicitanteEmail: 'ana.ruiz@ambientalia.com.co',
    decididaAt: null,
    motivoRechazo: null,
    createdAt: '2026-06-20T10:00:00Z',
    ...over,
  };
}

/** La anulación: los tres campos de lo propuesto van en null (CHECK de la 024). */
const anulacion = (over: Partial<Modificacion> = {}) =>
  modificacion({
    clase: 'anulacion',
    fechaInicioNueva: null,
    fechaFinNueva: null,
    diasHabilesNuevos: null,
    ...over,
  });

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
      // El id se IMPONE al crear: es lo único que permite volver a este evento
      // para corregirlo o borrarlo cuando la ausencia cambie.
      eventId: 's1',
      accion: 'crear',
      resumen: 'Vacaciones Ana Ruiz',
      inicio: '2026-07-06',
      fin: '2026-07-11',
    });
  });

  it('la incapacidad registrada también nace con su id impuesto', () => {
    // `registrada` es el otro evento que crea calendario, y se le olvida con
    // facilidad porque no pasa por la bandeja de nadie.
    const p = construirPayload(solicitud({ tipo: 'incapacidad', estado: 'registrada', adjunto: pdf }), 'registrada');
    expect(p.calendario).toMatchObject({ eventId: 's1', accion: 'crear' });
  });

  it('CANDADO: el id del evento cumple el alfabeto que exige Google', () => {
    // Google solo acepta base32hex —de 5 a 1024 caracteres de [0-9a-v]— y un
    // uuid sin guiones cae dentro. Este candado NO es decorativo: una derivación
    // que se salga del alfabeto no falla en ningún test de forma, falla contra
    // Google y solo en producción, y el correo ya habría dicho que el calendario
    // estaba corregido.
    const uuid = '9f2c1e40-7b3a-4d51-8e6f-0a1b2c3d4e5f';
    const id = idDeEventoCalendario(uuid);
    expect(id).toBe('9f2c1e407b3a4d518e6f0a1b2c3d4e5f');
    expect(id).toMatch(/^[0-9a-v]{5,1024}$/);
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

describe('el aviso de que se pide un cambio', () => {
  const aviso = (s = solicitud(), m = modificacion()) =>
    construirPayloadModificacion(s, m, 'modificacion_solicitada');

  it('va SOLO al decisor, sin la cadena ni la copia de la ficha', () => {
    // Mismo criterio que `aprobacion_2`: es un trámite interno, no un veredicto.
    // El solicitante ya sabe lo que ha pedido y administración no pinta nada
    // hasta que haya decisión.
    const p = aviso(
      solicitud({ estado: 'aprobada', copiaCorreo: 'administrativo@ambientalia.com.co' }),
      modificacion({ aprobadorCorreo: 'jefa.directa@ambientalia.com.co' }),
    );
    expect(p.correo.para).toBe('jefa.directa@ambientalia.com.co');
  });

  it('el destinatario sale de la MODIFICACIÓN, no de recalcular el turno', () => {
    // La copia congelada en el satélite manda. Si esto mirara el estado de la
    // solicitud, una que subiera de nivel entre el alta de la propuesta y el
    // envío mandaría el aviso a alguien que no puede decidirla.
    const p = aviso(
      solicitud({ estado: 'pendiente_2', segundoAprobadorCorreo: SEGUNDO }),
      modificacion({ aprobadorCorreo: 'la.que.congelo@ambientalia.com.co' }),
    );
    expect(p.correo.para).toBe('la.que.congelo@ambientalia.com.co');
  });

  it('dice las fechas actuales, las propuestas y el motivo', () => {
    // Sin esto el correo no sirve para decidir y solo repite lo que ya dice el
    // portal, que es como se entrena a la gente a no abrirlo.
    const p = aviso();
    expect(p.correo.asunto).toContain('Cambio pedido');
    expect(p.correo.cuerpo).toContain('2026-07-06 a 2026-07-10');
    expect(p.correo.cuerpo).toContain('2026-07-13 a 2026-07-15');
    expect(p.correo.cuerpo).toContain('5 días hábiles');
    expect(p.correo.cuerpo).toContain('3 días hábiles');
    expect(p.correo.cuerpo).toContain('Motivo: Me han adelantado la cita del especialista');
  });

  it('una anulación dice que se pide ANULAR, y no deja las fechas nuevas en «null»', () => {
    const p = aviso(solicitud({ estado: 'aprobada' }), anulacion());
    expect(p.correo.cuerpo).toContain('ANULAR');
    expect(p.correo.cuerpo).toContain('2026-07-06 a 2026-07-10');
    expect(p.correo.cuerpo).not.toMatch(/undefined|null|\[object/);
  });

  it('sin motivo no deja un «Motivo:» vacío colgando', () => {
    const p = aviso(solicitud(), modificacion({ motivo: null }));
    expect(p.correo.cuerpo).not.toContain('Motivo:');
    expect(p.correo.cuerpo).not.toMatch(/undefined|null/);
  });

  it('avisa de que la solicitud NO cambia todavía', () => {
    expect(aviso().correo.cuerpo).toContain('NO cambia hasta que apruebes');
  });

  it('CANDADO: el payload lleva `calendario` y `hoja` en null', () => {
    // PEDIR un cambio no cambia nada todavía: la solicitud sigue con sus fechas
    // y su evento sigue siendo correcto. Tocar Google aquí adelantaría en el
    // calendario un cambio que el jefe todavía puede rechazar.
    //
    // Con `eventoCalendarioId` puesto, que es el caso en el que SÍ se sabría
    // corregir: lo que lo impide es el momento, no la capacidad.
    const s = solicitud({ estado: 'aprobada', eventoCalendarioId: 'ev0deadbeef' });
    for (const m of [modificacion(), anulacion()]) {
      const p = construirPayloadModificacion(s, m, 'modificacion_solicitada');
      expect(p.calendario).toBeNull();
      expect(p.hoja).toBeNull();
    }
  });

  it('no estrena ningún campo en el payload: el contrato con n8n es el de siempre', () => {
    // Un campo nuevo con `undefined` activaría para TODOS los eventos el IF que
    // lo leyera (`undefined !== null` es `true`). Es literalmente el bug del
    // `drive`, y por eso se compara el juego de claves entero.
    const p = construirPayloadModificacion(solicitud(), modificacion(), 'modificacion_solicitada');
    expect(Object.keys(p).sort()).toEqual(
      Object.keys(construirPayload(solicitud(), 'creada')).sort(),
    );
  });

  it('el estado que viaja es el de la SOLICITUD, que no ha cambiado', () => {
    // La propuesta vive en su tabla: la fila de la solicitud no se toca hasta
    // que hay decisión, y el payload no puede insinuar lo contrario.
    const p = aviso(solicitud({ estado: 'aprobada' }), modificacion());
    expect(p.estado).toBe('aprobada');
  });
});

describe('la decisión del cambio', () => {
  const PRIMERO = 'jefa.directa@ambientalia.com.co';
  const INFORMADO = 'informado@ambientalia.com.co';

  /**
   * Una solicitud APROBADA con la cadena entera poblada: solicitante, los dos
   * firmantes, el informado y la copia de la ficha. Los cinco correos son
   * distintos a propósito — con alguno repetido, un destinatario que faltara
   * pasaría desapercibido detrás de otro.
   *
   * `segundoAprobadorCorreo` e `informadoCorreo` no coexisten en producción
   * (`aprobadoresDe` los deriva excluyentes), pero aquí van los dos para que un
   * solo test cubra las dos formas de la cadena.
   */
  const conCadena = (over: Partial<Solicitud> = {}) =>
    solicitud({
      estado: 'aprobada',
      solicitanteEmail: 'ana.ruiz@ambientalia.com.co',
      aprobadorCorreo: PRIMERO,
      segundoAprobadorCorreo: SEGUNDO,
      informadoCorreo: INFORMADO,
      copiaCorreo: 'administrativo@ambientalia.com.co',
      ...over,
    });

  const aprobada = (s = conCadena(), m = modificacion()) => construirPayloadModificacion(s, m, 'modificacion_aprobada');
  const rechazada = (s = conCadena(), m = modificacion()) =>
    construirPayloadModificacion(s, m, 'modificacion_rechazada');

  it('los dos avisos van a la cadena de decisión ENTERA, no solo al solicitante', () => {
    // El primer firmante avaló unas fechas concretas: si cambian —o si el cambio
    // se rechaza y siguen en pie— tiene que enterarse, porque es quien
    // reorganiza el trabajo. Mismo argumento que el correo de rechazo de la
    // solicitud.
    for (const p of [aprobada(), rechazada()]) {
      expect(p.correo.para).toBe(
        'ana.ruiz@ambientalia.com.co, jefa.directa@ambientalia.com.co, gerencia@ambientalia.com.co, informado@ambientalia.com.co, administrativo@ambientalia.com.co',
      );
    }
  });

  it('sin repetir a quien sale dos veces en la cadena', () => {
    const s = conCadena({ copiaCorreo: SEGUNDO, informadoCorreo: null });
    for (const p of [aprobada(s), rechazada(s)]) {
      expect(p.correo.para.match(/gerencia@ambientalia\.com\.co/g)).toHaveLength(1);
    }
  });

  it('CANDADO: el cuerpo de la aprobación lleva las CUATRO fechas y los dos recuentos', () => {
    // Redactado desde la PROPUESTA y no desde la solicitud ya actualizada: desde
    // la solicitud diría «cambiada a 13-15 jul» sin decir desde qué, y ese
    // «desde qué» es lo único que permite encontrar el evento en el calendario
    // para corregirlo a mano.
    const cuerpo = aprobada().correo.cuerpo;
    expect(cuerpo).toContain('2026-07-06');
    expect(cuerpo).toContain('2026-07-10');
    expect(cuerpo).toContain('2026-07-13');
    expect(cuerpo).toContain('2026-07-15');
    expect(cuerpo).toContain('5 días hábiles');
    expect(cuerpo).toContain('3 días hábiles');
  });

  it('las cuatro fechas siguen ahí aunque la solicitud ya lleve las nuevas', () => {
    // Es el caso real: al notificar, la fila YA está actualizada. Si el cuerpo se
    // redactara desde ella, las fechas de antes desaparecerían del correo sin que
    // ningún otro test lo notara.
    const yaActualizada = conCadena({ fechaInicio: '2026-07-13', fechaFin: '2026-07-15', diasHabiles: 3 });
    const cuerpo = aprobada(yaActualizada).correo.cuerpo;
    expect(cuerpo).toContain('2026-07-06 a 2026-07-10');
    expect(cuerpo).toContain('2026-07-13 a 2026-07-15');
  });

  it('CANDADO: el ⚠️ de Google aparece si la solicitud estaba APROBADA', () => {
    // Solo entonces hay un evento de calendario y una fila de hoja que corregir.
    const cuerpo = aprobada(conCadena(), modificacion({ estadoPrevio: 'aprobada' })).correo.cuerpo;
    expect(cuerpo).toContain('⚠️');
    expect(cuerpo).toContain('calendario');
    expect(cuerpo).toContain('a mano');
  });

  it('CANDADO: y NO aparece si la solicitud seguía PENDIENTE', () => {
    // La otra mitad, que es la que de verdad rinde: si la original nunca llegó a
    // Google, el ⚠️ manda a alguien a buscar un evento que no existe. Un solo
    // test del caso positivo no detecta ese falso positivo, y entrenar a la
    // gente a ignorar el ⚠️ es la forma segura de que el día que importe no lo
    // lean.
    for (const estadoPrevio of ['pendiente', 'pendiente_2'] as const) {
      const cuerpo = aprobada(conCadena({ estado: estadoPrevio }), modificacion({ estadoPrevio })).correo.cuerpo;
      expect(cuerpo).not.toContain('⚠️');
      expect(cuerpo).not.toContain('a mano');
    }
  });

  it('el ⚠️ de una anulación manda a BORRAR, no a ajustar', () => {
    const cuerpo = aprobada(conCadena(), anulacion({ estadoPrevio: 'aprobada' })).correo.cuerpo;
    expect(cuerpo).toContain('⚠️');
    expect(cuerpo).toContain('borrar');
  });

  it('el rechazo NO lleva el ⚠️ ni sobre una aprobada: no ha cambiado nada', () => {
    // Un ⚠️ que no pide ninguna acción es exactamente lo que enseña a no leerlos.
    const cuerpo = rechazada(conCadena(), modificacion({ estadoPrevio: 'aprobada' })).correo.cuerpo;
    expect(cuerpo).not.toContain('⚠️');
  });

  it('la anulación aprobada dice qué fechas dejan de estar reservadas', () => {
    const p = aprobada(conCadena(), anulacion());
    expect(p.correo.asunto).toContain('Anulada');
    expect(p.correo.cuerpo).toContain('2026-07-06 a 2026-07-10');
    expect(p.correo.cuerpo).toContain('5 días hábiles');
    expect(p.correo.cuerpo).not.toMatch(/undefined|null|\[object/);
  });

  it('el rechazo dice el motivo del jefe y que la solicitud sigue como estaba', () => {
    const p = rechazada(conCadena(), modificacion({ motivoRechazo: 'Ya está cubierto el turno' }));
    expect(p.correo.asunto).toContain('rechazado');
    expect(p.correo.cuerpo).toContain('Motivo del rechazo: Ya está cubierto el turno');
    // Las fechas de la SOLICITUD, que es lo que queda en pie.
    expect(p.correo.cuerpo).toContain('2026-07-06 a 2026-07-10');
  });

  it('CANDADO: el rechazo dice QUÉ se pidió, no solo lo que queda en pie', () => {
    // Sin esto, el segundo firmante y administración leen un rechazo sin saber
    // qué se tumbó, y dos rechazos seguidos sobre la misma solicitud producen
    // correos idénticos byte a byte.
    const p = rechazada(conCadena(), modificacion({ fechaInicioNueva: '2026-07-13', fechaFinNueva: '2026-07-15' }));
    expect(p.correo.cuerpo).toContain('2026-07-13 a 2026-07-15');
    expect(p.correo.cuerpo).toContain('2026-07-06 a 2026-07-10');
  });

  it('dos rechazos de propuestas distintas NO producen el mismo correo', () => {
    // La consecuencia observable del candado de arriba.
    const a = rechazada(conCadena(), modificacion({ fechaInicioNueva: '2026-07-13', fechaFinNueva: '2026-07-15' }));
    const b = rechazada(conCadena(), modificacion({ fechaInicioNueva: '2026-08-03', fechaFinNueva: '2026-08-05' }));
    expect(a.correo.cuerpo).not.toBe(b.correo.cuerpo);
  });

  it('el rechazo de una ANULACIÓN no repite lo pedido: ya lo dice la primera línea', () => {
    const p = rechazada(conCadena(), anulacion());
    expect(p.correo.cuerpo).toContain('Tu petición de anular tu solicitud');
    expect(p.correo.cuerpo).not.toContain('Fechas propuestas');
    expect(p.correo.cuerpo).not.toMatch(/undefined|null/);
  });

  it('un rechazo sin motivo no deja un «Motivo:» vacío colgando', () => {
    const p = rechazada(conCadena(), modificacion({ motivoRechazo: null }));
    expect(p.correo.cuerpo).not.toContain('Motivo');
    expect(p.correo.cuerpo).not.toMatch(/undefined|null/);
  });

  it('CANDADO: sobre una solicitud EN TRÁMITE, el ✅ avisa de que sigue sin conceder', () => {
    // El ✅ es del CAMBIO, no de las vacaciones. Quien viene del acuse del alta
    // —que le prometió informarle «del estado de aprobación»— lee un ✅ con sus
    // fechas nuevas, y ese es el correo que acaba en un vuelo comprado.
    for (const estadoPrevio of ['pendiente', 'pendiente_2'] as const) {
      const cuerpo = aprobada(conCadena({ estado: estadoPrevio }), modificacion({ estadoPrevio })).correo.cuerpo;
      expect(cuerpo).toContain('sigue pendiente de aprobación');
    }
  });

  it('y NO lo dice cuando la solicitud ya estaba aprobada', () => {
    // La otra mitad: ahí las vacaciones sí están concedidas, y decir que siguen
    // pendientes sería la mentira contraria.
    expect(aprobada(conCadena(), modificacion({ estadoPrevio: 'aprobada' })).correo.cuerpo).not.toContain(
      'sigue pendiente de aprobación',
    );
  });

  it('una ANULACIÓN aprobada sobre una pendiente no dice que siga pendiente', () => {
    // Queda `rechazada`: decirle que «sigue pendiente de aprobación» sería falso
    // justo al revés. Por eso la línea es solo para el cambio de fechas.
    const cuerpo = aprobada(conCadena({ estado: 'pendiente' }), anulacion({ estadoPrevio: 'pendiente' })).correo.cuerpo;
    expect(cuerpo).not.toContain('sigue pendiente de aprobación');
  });

  it('CANDADO: el asunto avisa cuando hay que tocar Google, y solo entonces', () => {
    // Es el único correo de la app que obliga a alguien a ir a editar el
    // calendario a mano. Sin el prefijo, administración —que lo recibe por
    // `copiaCorreo`— no ve la señal hasta abrirlo.
    const conAviso = aprobada(conCadena(), modificacion({ estadoPrevio: 'aprobada' })).correo;
    expect(conAviso.asunto).toContain('⚠️ Ajustar calendario y hoja');
    // Y el párrafo nombra a quien tiene que actuar: escrito sin destinatario, se
    // lee como una tarea para el trabajador.
    expect(conAviso.cuerpo).toContain('Administración:');

    const sinAviso = aprobada(conCadena({ estado: 'pendiente' }), modificacion({ estadoPrevio: 'pendiente' })).correo;
    expect(sinAviso.asunto).not.toContain('⚠️');
    // El rechazo tampoco lo lleva: no hay nada que ajustar.
    expect(rechazada(conCadena(), modificacion({ estadoPrevio: 'aprobada' })).correo.asunto).not.toContain('⚠️');
  });

  it('ningún cuerpo deja dos líneas en blanco seguidas', () => {
    // Los opcionales (`motivo`, el aviso de Google, la nota de trámite) aportan
    // su propio salto: si se dejaran como cadenas vacías dentro del array, el
    // `join` sumaría el suyo y saldría un hueco doble antes de la firma.
    const casos = [
      aprobada(conCadena(), modificacion({ motivo: null, estadoPrevio: 'aprobada' })),
      aprobada(conCadena({ estado: 'pendiente' }), modificacion({ motivo: null, estadoPrevio: 'pendiente' })),
      aprobada(conCadena(), anulacion({ motivo: null, estadoPrevio: 'aprobada' })),
      rechazada(conCadena(), modificacion({ motivoRechazo: null })),
      rechazada(conCadena(), anulacion({ motivoRechazo: 'No procede' })),
    ];
    for (const p of casos) expect(p.correo.cuerpo).not.toMatch(/\n\n\n/);
  });

  // El id que dejó anotado la aprobación. A propósito distinto del que saldría
  // de derivar `s.id`: el payload tiene que usar el id GUARDADO y no volver a
  // derivarlo. Si alguien «simplifica» eso, este valor sale rojo.
  const EV = 'ev0deadbeef';

  it('CANDADO: aprobar un cambio de fechas manda CORREGIR el evento, no crear otro', () => {
    // Las fechas salen de la solicitud, que a estas alturas ya está actualizada
    // (`aplicarALaSolicitud` corre en la misma transacción). Y el fin lleva el
    // +1 de siempre: un evento movido sin él pierde su último día.
    const s = conCadena({ eventoCalendarioId: EV, fechaInicio: '2026-07-13', fechaFin: '2026-07-15' });
    const p = construirPayloadModificacion(s, modificacion(), 'modificacion_aprobada');
    expect(p.calendario).toEqual({
      calendarId: CALENDARIO_STAFF,
      eventId: EV,
      accion: 'actualizar',
      resumen: 'Vacaciones Ana Ruiz',
      inicio: '2026-07-13',
      fin: '2026-07-16',
    });
    // La hoja NO: n8n hace `append` y no queda constancia de en qué fila cayó.
    expect(p.hoja).toBeNull();
  });

  it('CANDADO: aprobar una anulación manda BORRAR el evento', () => {
    // Aquí las fechas de la solicitud NO se tocaron —anular no las cambia—, así
    // que describen el evento que está a punto de desaparecer.
    const p = construirPayloadModificacion(
      conCadena({ eventoCalendarioId: EV }),
      anulacion(),
      'modificacion_aprobada',
    );
    expect(p.calendario).toMatchObject({ eventId: EV, accion: 'borrar', inicio: '2026-07-06', fin: '2026-07-11' });
    expect(p.hoja).toBeNull();
  });

  it('CANDADO: rechazar el cambio no toca Google, ni con evento anotado', () => {
    // La solicitud queda exactamente como estaba: no hay nada que corregir, y un
    // `calendario` aquí reescribiría el evento con las fechas que se acaban de
    // denegar.
    for (const m of [modificacion({ estadoPrevio: 'aprobada' }), anulacion({ estadoPrevio: 'aprobada' })]) {
      const p = construirPayloadModificacion(conCadena({ eventoCalendarioId: EV }), m, 'modificacion_rechazada');
      expect(p.calendario).toBeNull();
      expect(p.hoja).toBeNull();
    }
  });

  it('CANDADO: si la original no estaba aprobada no hay nada que corregir', () => {
    // Nunca se mandó nada al calendario, así que un `actualizar` daría un 404 y
    // el correo habría anunciado una corrección que no ocurrió. Con el id
    // anotado a propósito: lo que decide es `estadoPrevio`, no tener id.
    for (const previo of ['pendiente', 'pendiente_2'] as const) {
      const p = construirPayloadModificacion(
        conCadena({ estado: previo, eventoCalendarioId: EV }),
        modificacion({ estadoPrevio: previo }),
        'modificacion_aprobada',
      );
      expect(p.calendario).toBeNull();
      expect(p.correo.asunto).not.toContain('Ajustar');
    }
  });

  it('CANDADO: una aprobada SIN evento anotado no se corrige sola', () => {
    // Es la cola de solicitudes aprobadas antes de la 026: su evento lleva el id
    // que inventó Google, que nadie apuntó, y no se puede localizar. El aviso a
    // mano tiene que seguir saliendo entero.
    for (const m of [modificacion(), anulacion()]) {
      const p = construirPayloadModificacion(conCadena({ eventoCalendarioId: null }), m, 'modificacion_aprobada');
      expect(p.calendario).toBeNull();
      expect(p.correo.asunto).toContain('Ajustar calendario y hoja —');
      expect(p.correo.cuerpo).toContain('el evento del calendario y la fila de la hoja');
    }
  });

  it('CANDADO: el aviso nombra SOLO lo que queda por hacer a mano', () => {
    // Un aviso que manda al calendario cuando el calendario ya está corregido es
    // exactamente lo que entrena a la gente a no leerlos. El texto y el payload
    // salen los dos de `correccionDeCalendario`, así que no pueden discrepar.
    const s = conCadena({ eventoCalendarioId: EV });
    const cambio = construirPayloadModificacion(s, modificacion(), 'modificacion_aprobada');
    expect(cambio.correo.asunto).toContain('Ajustar la hoja —');
    expect(cambio.correo.cuerpo).toContain('ya se ha corregido solo');
    expect(cambio.correo.cuerpo).toContain('La fila de la hoja no');
    expect(cambio.correo.cuerpo).not.toContain('hay que ajustar a mano el evento del calendario');

    const anula = construirPayloadModificacion(s, anulacion(), 'modificacion_aprobada');
    expect(anula.correo.asunto).toContain('Ajustar la hoja —');
    expect(anula.correo.cuerpo).toContain('ya se ha borrado solo');
    expect(anula.correo.cuerpo).not.toContain('hay que borrar a mano el evento del calendario');
  });

  it('tampoco estrenan ningún campo del payload', () => {
    for (const evento of ['modificacion_aprobada', 'modificacion_rechazada'] as const) {
      const p = construirPayloadModificacion(conCadena(), modificacion(), evento);
      expect(Object.keys(p).sort()).toEqual(Object.keys(construirPayload(solicitud(), 'creada')).sort());
    }
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

describe('el payload de una corrección del registro', () => {
  const ADMIN = 'comercial@ambientalia.com.co';
  const EVENT_ID = '2993c29668a94bf38708574110cde669';

  const aprobadaConEvento = (over: Partial<Solicitud> = {}) =>
    solicitud({ estado: 'aprobada', eventoCalendarioId: EVENT_ID, ...over });

  it('mueve el evento cuando cambian las fechas', () => {
    const previa = aprobadaConEvento();
    const actual = aprobadaConEvento({ fechaInicio: '2026-07-13', fechaFin: '2026-07-17' });
    const p = construirPayloadCorreccion(previa, actual, ADMIN);

    expect(p.calendario).toMatchObject({
      calendarId: CALENDARIO_STAFF,
      eventId: EVENT_ID,
      accion: 'actualizar',
      inicio: '2026-07-13',
      // Fin EXCLUSIVO: Google no pinta el último día si no se le suma uno.
      fin: '2026-07-18',
    });
    expect(p.correo.asunto).toContain('⚠️ Ajustar la hoja —');
    expect(p.correo.cuerpo).toContain('ya se ha corregido solo');
  });

  it('borra el evento cuando la solicitud sale del calendario', () => {
    const previa = aprobadaConEvento();
    const actual = aprobadaConEvento({ estado: 'rechazada' });
    const p = construirPayloadCorreccion(previa, actual, ADMIN);

    expect(p.calendario).toMatchObject({ eventId: EVENT_ID, accion: 'borrar' });
    expect(p.correo.cuerpo).toContain('ya se ha borrado solo');
  });

  // CANDADO. Sin él, corregir el recuento de días manda a Google un update
  // idéntico al evento que ya hay y un correo diciendo que se corrigió algo.
  it('CANDADO: corregir solo los días no toca el calendario, pero sí avisa de la hoja', () => {
    const previa = aprobadaConEvento();
    const actual = aprobadaConEvento({ diasHabiles: 4 });
    const p = construirPayloadCorreccion(previa, actual, ADMIN);

    expect(p.calendario).toBeNull();
    expect(p.correo.asunto).toContain('⚠️ Ajustar la hoja —');
    expect(p.correo.cuerpo).toContain('el evento del calendario no cambia');
    expect(p.correo.cuerpo).not.toContain('se ha corregido solo');
  });

  // CANDADO. Las aprobadas ANTERIORES a la migración 026 llevan en Google un id
  // que inventó Google y que nadie apuntó: existen, pero no se pueden localizar.
  it('CANDADO: sin id no se corrige nada y el aviso pide las dos cosas a mano', () => {
    const previa = solicitud({ estado: 'aprobada', eventoCalendarioId: null });
    const actual = solicitud({ estado: 'aprobada', eventoCalendarioId: null, fechaInicio: '2026-07-13' });
    const p = construirPayloadCorreccion(previa, actual, ADMIN);

    expect(p.calendario).toBeNull();
    expect(p.correo.asunto).toContain('⚠️ Ajustar calendario y hoja —');
  });

  it('la hoja va a null SIEMPRE: n8n hace append y a esa fila no se puede volver', () => {
    const previa = aprobadaConEvento();
    const actual = aprobadaConEvento({ fechaInicio: '2026-07-13' });
    expect(construirPayloadCorreccion(previa, actual, ADMIN).hoja).toBeNull();
  });

  it('el correo va a la copia de la ficha y nombra al admin que lo hizo', () => {
    const previa = aprobadaConEvento();
    const actual = aprobadaConEvento({ fechaInicio: '2026-07-13' });
    const p = construirPayloadCorreccion(previa, actual, ADMIN);

    expect(p.correo.para).toBe('administrativo@ambientalia.com.co');
    expect(p.correo.cuerpo).toContain(ADMIN);
  });

  // CANDADO. Este es el ÚNICO correo de la app con una sola fuente de
  // destinatario: en los demás la cadena de firmas rellena la lista. Un `para`
  // vacío no degrada el aviso, deja una fila del outbox que Gmail rechaza y n8n
  // reintenta cada diez minutos para siempre.
  it('CANDADO: una ficha sin copia cae en el valor por defecto, nunca en vacío', () => {
    const previa = aprobadaConEvento({ copiaCorreo: null });
    const actual = aprobadaConEvento({ copiaCorreo: null, fechaInicio: '2026-07-13' });
    const p = construirPayloadCorreccion(previa, actual, ADMIN);

    expect(p.correo.para).toBe(COPIA_POR_DEFECTO);
    expect(p.correo.para).not.toBe('');
  });

  it('el cuerpo enseña el antes y el después, con estado y recuento', () => {
    const previa = aprobadaConEvento();
    const actual = aprobadaConEvento({ estado: 'rechazada' });
    const cuerpo = construirPayloadCorreccion(previa, actual, ADMIN).correo.cuerpo;

    expect(cuerpo).toContain('2026-07-06 a 2026-07-10');
    expect(cuerpo).toContain('aprobada');
    expect(cuerpo).toContain('rechazada');
  });

  // CANDADO. El candado que cierra el resto: `calendario` y `correo.cuerpo`
  // salen de la MISMA `situacionDelCalendario`, así que no pueden discrepar.
  // Antes de esa refactorización, tres sitios recalculaban la misma condición
  // por separado, y nada impedía que uno divergiera del otro sin que ningún
  // test se enterara.
  it('CANDADO: el calendario del payload y el texto del correo cuentan la misma historia', () => {
    const casos = [
      // no_cambia: no se toca el calendario, y el correo no dice que se arregló.
      { previa: aprobadaConEvento(), actual: aprobadaConEvento({ diasHabiles: 4 }) },
      // a_mano: tampoco se toca, y tampoco se dice que se arregló solo (sin id).
      {
        previa: solicitud({ estado: 'aprobada', eventoCalendarioId: null }),
        actual: solicitud({ estado: 'aprobada', eventoCalendarioId: null, fechaInicio: '2026-07-13' }),
      },
      // actualizado: SÍ se toca, y el correo SÍ dice que se arregló solo.
      { previa: aprobadaConEvento(), actual: aprobadaConEvento({ fechaInicio: '2026-07-13' }) },
      // borrado: SÍ se toca, y el correo SÍ dice que se arregló solo.
      { previa: aprobadaConEvento(), actual: aprobadaConEvento({ estado: 'rechazada' }) },
    ];

    for (const { previa, actual } of casos) {
      const p = construirPayloadCorreccion(previa, actual, ADMIN);
      const diceQueSeArregloSolo = p.correo.cuerpo.includes('ya se ha');
      // Coinciden SIEMPRE: hay algo que ejecutar en el calendario exactamente
      // cuando el correo dice que ya se arregló solo.
      expect(p.calendario !== null).toBe(diceQueSeArregloSolo);
    }
  });
});

describe('el payload del borrado de una solicitud', () => {
  const ADMIN = 'comercial@ambientalia.com.co';
  const EVENT_ID = '2993c29668a94bf38708574110cde669';

  it('borra el evento cuando la solicitud tiene uno localizable', () => {
    const borrada = solicitud({ estado: 'aprobada', eventoCalendarioId: EVENT_ID });
    const p = construirPayloadBorrado(borrada, ADMIN);

    expect(p.calendario).toMatchObject({
      calendarId: CALENDARIO_STAFF,
      eventId: EVENT_ID,
      accion: 'borrar',
    });
    expect(p.correo.asunto).toContain('⚠️ Ajustar la hoja —');
    expect(p.correo.cuerpo).toContain('ya se ha borrado solo');
  });

  // CANDADO. Las aprobadas anteriores a la migración 026 llevan en Google un id
  // que inventó Google y que nadie apuntó: existen, pero no se pueden localizar.
  it('CANDADO: sin id no se borra nada y el aviso pide las dos cosas a mano', () => {
    const borrada = solicitud({ estado: 'aprobada', eventoCalendarioId: null });
    const p = construirPayloadBorrado(borrada, ADMIN);

    expect(p.calendario).toBeNull();
    expect(p.correo.asunto).toContain('⚠️ Ajustar calendario y hoja —');
    expect(p.correo.cuerpo).not.toContain('ya se ha borrado solo');
  });

  // CANDADO. El verbo importa: en una corrección la fila de la hoja se AJUSTA, y
  // aquí hay que BORRARLA. Reutilizar el texto de la corrección mandaría a
  // administración a ajustar a unas fechas nuevas una fila que ya no existe.
  it('CANDADO: el aviso dice borrar la fila de la hoja, no ajustarla', () => {
    const borrada = solicitud({ estado: 'aprobada', eventoCalendarioId: EVENT_ID });
    const cuerpo = construirPayloadBorrado(borrada, ADMIN).correo.cuerpo;

    expect(cuerpo).toContain('borrarla a mano');
    expect(cuerpo).not.toContain('ajustarla a mano');
  });

  it('la hoja va a null SIEMPRE: n8n hace append y a esa fila no se puede volver', () => {
    const borrada = solicitud({ estado: 'aprobada', eventoCalendarioId: EVENT_ID });
    expect(construirPayloadBorrado(borrada, ADMIN).hoja).toBeNull();
  });

  it('el correo va a la copia de la ficha y nombra al admin que lo borró', () => {
    const borrada = solicitud({ estado: 'aprobada', eventoCalendarioId: EVENT_ID });
    const p = construirPayloadBorrado(borrada, ADMIN);

    expect(p.correo.para).toBe('administrativo@ambientalia.com.co');
    expect(p.correo.cuerpo).toContain(ADMIN);
  });

  // CANDADO. Único correo de la app con una sola fuente de destinatario: en los
  // demás la cadena de firmas rellena la lista. Un `para` vacío no degrada el
  // aviso, deja una fila que n8n reintenta cada diez minutos para siempre.
  it('CANDADO: una ficha sin copia cae en el valor por defecto, nunca en vacío', () => {
    const borrada = solicitud({ estado: 'aprobada', eventoCalendarioId: EVENT_ID, copiaCorreo: null });
    const p = construirPayloadBorrado(borrada, ADMIN).correo;

    expect(p.para).toBe(COPIA_POR_DEFECTO);
    expect(p.para).not.toBe('');
  });

  it('el cuerpo enseña qué se borró: tipo, fechas, recuento y estado', () => {
    const borrada = solicitud({ estado: 'aprobada', eventoCalendarioId: EVENT_ID });
    const cuerpo = construirPayloadBorrado(borrada, ADMIN).correo.cuerpo;

    expect(cuerpo).toContain('2026-07-06 a 2026-07-10');
    expect(cuerpo).toContain('aprobada');
    expect(cuerpo).toContain('Ana Ruiz');
  });
});

describe('el otorgamiento no llega a Google', () => {
  // EL CANDADO DE LA NOMINA. `construirPayload` decidia que llega a Google
  // mirando SOLO el evento, y bastaba porque los cuatro tipos eran ausencias. Un
  // otorgamiento aprobado emite `aprobada` igual que unas vacaciones: sin el
  // corte por tipo crearia un evento en el calendario de Staff por unos dias que
  // nadie se toma, y una fila en la pestaña con la que se paga la nomina.
  //
  // Va sobre los CUATRO eventos y no solo sobre `aprobada`: `rechazada` tambien
  // escribe en la hoja, y es el que se olvida.
  const otorgamiento = (over: Partial<Solicitud> = {}) =>
    solicitud({ tipo: 'otorgamiento', fechaInicio: '2026-07-11', fechaFin: '2026-07-11', diasHabiles: 1, ...over });

  it('CANDADO: ninguno de sus eventos produce calendario ni hoja', () => {
    for (const evento of ['creada', 'aprobacion', 'aprobada', 'rechazada'] as const) {
      const p = construirPayload(otorgamiento({ estado: evento === 'aprobada' ? 'aprobada' : 'pendiente' }), evento);
      expect(p.calendario, `evento ${evento}`).toBeNull();
      expect(p.hoja, `evento ${evento}`).toBeNull();
    }
  });

  it('CANDADO: y una vacacion aprobada SI las produce, para que el de arriba pruebe algo', () => {
    const p = construirPayload(solicitud({ estado: 'aprobada' }), 'aprobada');
    expect(p.calendario).not.toBeNull();
    expect(p.hoja).not.toBeNull();
  });

  it('CANDADO de la segunda cerradura: no tiene pestaña a la que escribir', () => {
    // Independiente del guard de `construirPayload`, a proposito: si alguien
    // deshiciera aquel, esto sigue impidiendo la fila. Se comprueba sobre la
    // configuracion y no sobre el payload, que es lo que lo hace independiente.
    expect(PESTANA.otorgamiento).toBeNull();
    expect(PESTANA.compensatorio).not.toBeNull();
  });

  it('el correo si sale: lo que se excluye es Google, no el aviso', () => {
    const p = construirPayload(otorgamiento(), 'creada');
    expect(p.correo.para).not.toBe('');
    expect(p.correo.asunto).not.toBe('');
  });
});
