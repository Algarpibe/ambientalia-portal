import { describe, it, expect } from 'vitest';
import {
  AusenciaError,
  nombreArchivoNormalizado,
  puedeDecidir,
  puedeDecidirModificacion,
  puedePedirAnulacion,
  puedePedirModificacion,
  puedeVerAdjunto,
  validarNuevaModificacion,
  validarNuevaSolicitud,
  validarSaldo,
  type Sesion,
} from './service.js';
import {
  decisorDeModificacion,
  transicionAlDecidir,
  type EstadoSolicitud,
  type Modificacion,
  type Solicitud,
} from './types.js';

const PDF_BASE64 = Buffer.from('%PDF-1.4 fake').toString('base64');

function nueva(over: Record<string, unknown> = {}) {
  return { tipo: 'vacaciones', fechaInicio: '2026-07-06', fechaFin: '2026-07-10', ...over };
}

/**
 * Un «hoy» anterior a las fechas de `nueva()`, para que su rango caiga en el
 * futuro. Va fijo y no `hoyEnColombia()`: con la fecha real, estos tests
 * empezarían a fallar solos el 7 de julio de 2026 por la regla de fechas
 * pasadas, sin que nadie hubiera tocado el código.
 */
const HOY = '2026-07-01';

/**
 * Fechas de una incapacidad DENTRO de su ventana: dos dias hacia atras desde
 * HOY. Con nombre porque las usan varios tests, y moverlas de una en una es
 * como se desincronizan de la constante del servicio.
 */
const INCAP_DESDE = '2026-06-29';
const INCAP_HASTA = '2026-06-30';

/** `validarNuevaSolicitud` con el «hoy» fijo, que es lo que quiere casi todo el fichero. */
const validar = (body: unknown, hoy: string = HOY) => validarNuevaSolicitud(body, hoy);

function solicitud(over: Partial<Solicitud> = {}): Solicitud {
  return {
    id: 's1',
    tipo: 'vacaciones',
    empleadoId: 'e1',
    empleadoNombre: 'Gustavo Novoa',
    empleadoCargo: 'Director Técnico',
    solicitanteEmail: 'director.tecnico@ambientalia.com.co',
    fechaInicio: '2026-07-06',
    fechaFin: '2026-07-10',
    diasHabiles: 5,
    horaInicio: null,
    horaFin: null,
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
    // Este fichero no prueba copias: null es el valor neutro.
    copiaCorreo: null,
    // Sin propuesta de cambio viva y sin anular: el estado de casi todas.
    modificacionPendiente: null,
    anuladaAt: null,
    // Este fichero no llega a Google: una `pendiente` no tiene evento.
    eventoCalendarioId: null,
    ...over,
  };
}

describe('validarNuevaSolicitud — el otorgamiento', () => {
  /** Un otorgamiento correcto: un día trabajado en el pasado, días y motivo. */
  const otorg = (over: Record<string, unknown> = {}) => ({
    tipo: 'otorgamiento',
    fechaInicio: '2026-06-20',
    fechaFin: '2026-06-20',
    dias: 1,
    comentarios: 'Trabajé el sábado en el montaje de Cartagena',
    ...over,
  });

  it('acepta uno correcto y devuelve los días concedidos', () => {
    expect(validar(otorg())).toMatchObject({ tipo: 'otorgamiento', dias: 1 });
  });

  it('CANDADO: su fecha SÍ puede estar en el pasado', () => {
    // Es la regla que lo hace posible. Se pide DESPUÉS de haber trabajado, así
    // que con la regla de las ausencias todo otorgamiento seria rechazado.
    expect(validar(otorg({ fechaInicio: '2026-05-05', fechaFin: '2026-05-05' })).dias).toBe(1);
    // Y el control: unas vacaciones en esa misma fecha SÍ se rechazan.
    expect(() => validar(nueva({ fechaInicio: '2026-05-05', fechaFin: '2026-05-08' }))).toThrow(
      expect.objectContaining({ code: 'fecha_en_pasado' }),
    );
  });

  it('rechaza un trabajo de hace más de tres meses', () => {
    // Sin tope, alguien reclama hoy un sábado de hace seis años — y encima
    // caeria por debajo de su fecha de corte, donde no sumaría nada.
    expect(() => validar(otorg({ fechaInicio: '2025-06-01', fechaFin: '2025-06-01' }))).toThrow(
      expect.objectContaining({ code: 'trabajo_demasiado_antiguo', field: 'fechaInicio' }),
    );
  });

  it('CANDADO: la ventana son tres meses de CALENDARIO, y el borde entra', () => {
    // Con `hoy` = 2026-07-01, el día más antiguo válido es el 2026-04-01. El
    // borde SE ADMITE —«tres meses» incluye el propio día— y el anterior no. Los
    // dos casos juntos son lo que fija dónde está la raya: con solo uno, mover
    // el límite un día en cualquier sentido seguiría en verde.
    const enElBorde = (f: string) => validar(otorg({ fechaInicio: f, fechaFin: f })).dias;
    expect(enElBorde('2026-04-01')).toBe(1);
    expect(() => enElBorde('2026-03-31')).toThrow(
      expect.objectContaining({ code: 'trabajo_demasiado_antiguo' }),
    );
  });

  it('CANDADO: tampoco hacia adelante — se pide por un día YA trabajado', () => {
    // La ventana es «de hoy hacia atrás». Hoy vale; mañana no: un compensatorio
    // se gana por haber trabajado, no por ir a trabajar.
    expect(validar(otorg({ fechaInicio: HOY, fechaFin: HOY })).dias).toBe(1);
    expect(() => validar(otorg({ fechaInicio: '2026-07-02', fechaFin: '2026-07-02' }))).toThrow(
      expect.objectContaining({ code: 'trabajo_en_el_futuro', field: 'fechaInicio' }),
    );
  });

  it('exige UN SOLO día de trabajo, no un rango', () => {
    // El formulario manda una sola fecha, pero el servidor no puede fiarse: sin
    // esto se colaría un trimestre entero como «el día que trabajé».
    expect(() => validar(otorg({ fechaFin: '2026-06-25' }))).toThrow(
      expect.objectContaining({ code: 'otorgamiento_un_solo_dia', field: 'fechaFin' }),
    );
  });

  it('exige el motivo', () => {
    expect(() => validar(otorg({ comentarios: '   ' }))).toThrow(
      expect.objectContaining({ code: 'motivo_requerido', field: 'comentarios' }),
    );
  });

  it('rechaza cantidades imposibles', () => {
    for (const dias of [0, -1, 1.25, 31, Number.NaN]) {
      expect(() => validar(otorg({ dias })), String(dias)).toThrow(expect.objectContaining({ status: 400 }));
    }
    // Y admite el medio día, que es la precisión de la columna.
    expect(validar(otorg({ dias: 0.5 })).dias).toBe(0.5);
    // Justo en el tope, que es lo que separa «30 sí» de «30 no».
    expect(validar(otorg({ dias: 30 })).dias).toBe(30);
  });

  it('CANDADO: `dias` en cualquier OTRO tipo es un 400, no se ignora', () => {
    // Aceptarlo e ignorarlo dejaría creer que se puede fijar desde el cliente el
    // recuento de unas vacaciones, que es justo lo que no se puede.
    expect(() => validar(nueva({ dias: 3 }))).toThrow(
      expect.objectContaining({ code: 'dias_no_aplica', field: 'dias' }),
    );
  });

  it('y sin `dias` un otorgamiento no pasa', () => {
    expect(() => validar(otorg({ dias: undefined }))).toThrow(
      expect.objectContaining({ code: 'dias_invalidos', field: 'dias' }),
    );
  });
});

describe('validarNuevaSolicitud', () => {
  it('acepta una solicitud correcta y limpia los comentarios', () => {
    const r = validar(nueva({ comentarios: '  Viaje  ' }));
    expect(r).toMatchObject({ tipo: 'vacaciones', fechaInicio: '2026-07-06', comentarios: 'Viaje' });
  });

  it('rechaza un tipo que no existe', () => {
    expect(() => validar(nueva({ tipo: 'sabatico' }))).toThrow(
      expect.objectContaining({ code: 'tipo_invalido', status: 400 }),
    );
  });

  it('rechaza fechas que no son de calendario', () => {
    expect(() => validar(nueva({ fechaInicio: '2026-02-30' }))).toThrow(
      expect.objectContaining({ code: 'fecha_invalida', field: 'fechaInicio' }),
    );
  });

  it('rechaza unas vacaciones que empiezan antes de hoy', () => {
    // Pedir aprobación de algo que ya ocurrió no tiene sentido: cuando llegue la
    // firma, los días ya se disfrutaron (o no) y el saldo ya no se puede reservar.
    expect(() => validar(nueva({ fechaInicio: '2026-06-30', fechaFin: '2026-07-10' }))).toThrow(
      expect.objectContaining({ code: 'fecha_en_pasado', status: 400, field: 'fechaInicio' }),
    );
  });

  it('acepta unas vacaciones que empiezan HOY', () => {
    // El límite es «anterior a hoy», no «posterior a hoy»: pedir el mismo día es
    // legítimo y es justo el caso que un `<` mal puesto rompería en silencio.
    expect(validar(nueva({ fechaInicio: HOY, fechaFin: '2026-07-10' }))).toMatchObject({ fechaInicio: HOY });
  });

  it('CANDADO: una incapacidad de antes de su ventana se rechaza', () => {
    // Un día más atrás que `INCAP_DESDE`. Esta pareja —este test y el de abajo—
    // acota la ventana por sus dos lados; separarlos la deja sin borde.
    expect(() =>
      validar(
        nueva({
          tipo: 'incapacidad',
          fechaInicio: '2026-06-28',
          fechaFin: '2026-06-29',
          adjunto: { nombreArchivo: 'inc.pdf', mime: 'application/pdf', contenidoBase64: PDF_BASE64 },
        }),
      ),
    ).toThrow(expect.objectContaining({ code: 'incapacidad_demasiado_antigua', field: 'fechaInicio' }));
  });

  it('CANDADO: y una que empieza en el futuro tampoco: nadie sabe que va a enfermar', () => {
    expect(() =>
      validar(
        nueva({
          tipo: 'incapacidad',
          fechaInicio: '2026-07-02',
          fechaFin: '2026-07-03',
          adjunto: { nombreArchivo: 'inc.pdf', mime: 'application/pdf', contenidoBase64: PDF_BASE64 },
        }),
      ),
    ).toThrow(expect.objectContaining({ code: 'incapacidad_en_el_futuro', field: 'fechaInicio' }));
  });

  it('CANDADO: pero una que empieza HOY y termina despues si vale', () => {
    // El caso corriente que la regla del futuro no puede llevarse por delante:
    // el medico firma hoy una baja que cubre los proximos dias. Por eso la
    // comprobacion mira `fechaInicio` y no `fechaFin`.
    expect(
      validar(
        nueva({
          tipo: 'incapacidad',
          fechaInicio: HOY,
          fechaFin: '2026-07-06',
          adjunto: { nombreArchivo: 'inc.pdf', mime: 'application/pdf', contenidoBase64: PDF_BASE64 },
        }),
      ),
    ).toMatchObject({ fechaInicio: HOY });
  });

  it('acepta una incapacidad con fechas ya pasadas, dentro de su ventana', () => {
    // La excepción que justifica que la regla mire el tipo. Una incapacidad se
    // INFORMA después de haber estado enfermo: uno va al médico, vuelve y sube el
    // soporte. Exigirle fecha de hoy en adelante haría imposible el caso normal.
    //
    // La ventana la acotan los tres candados de aquí arriba; este fija que
    // dentro de ella el caso normal sigue pasando.
    const r = validar(
      nueva({
        tipo: 'incapacidad',
        fechaInicio: INCAP_DESDE,
        fechaFin: INCAP_HASTA,
        adjunto: { nombreArchivo: 'inc.pdf', mime: 'application/pdf', contenidoBase64: PDF_BASE64 },
      }),
    );
    expect(r).toMatchObject({ tipo: 'incapacidad', fechaInicio: INCAP_DESDE });
  });

  it('la regla del pasado también tapa permisos y compensatorios', () => {
    // Los tres tipos que requieren aprobación van juntos: si la regla mirara solo
    // `vacaciones`, quedaría abierta la misma puerta por otro lado.
    // Un solo día en los dos: desde el 2026-08-25 un permiso de varios rebota
    // antes con `permiso_de_un_solo_dia` y este test dejaría de probar la regla
    // del pasado, que es la suya. Al compensatorio el día suelto no le cambia
    // nada.
    for (const tipo of ['permiso', 'compensatorio'] as const) {
      expect(() => validar(nueva({ tipo, fechaInicio: '2026-06-30', fechaFin: '2026-06-30' }))).toThrow(
        expect.objectContaining({ code: 'fecha_en_pasado', field: 'fechaInicio' }),
      );
    }
  });

  it('rechaza el rango invertido', () => {
    expect(() => validar(nueva({ fechaInicio: '2026-07-10', fechaFin: '2026-07-06' }))).toThrow(
      expect.objectContaining({ code: 'rango_invertido' }),
    );
  });

  it('rechaza rangos de más de un año', () => {
    expect(() => validar(nueva({ fechaFin: '2028-07-10' }))).toThrow(
      expect.objectContaining({ code: 'rango_demasiado_largo' }),
    );
  });

  it('exige adjunto en las incapacidades', () => {
    // Es el único tipo que nadie aprueba: el soporte médico es lo único que lo
    // respalda, así que sin él no se registra.
    expect(() => validar(nueva({ tipo: 'incapacidad', fechaInicio: INCAP_DESDE, fechaFin: INCAP_HASTA }))).toThrow(
      expect.objectContaining({ code: 'adjunto_requerido' }),
    );
  });

  it('acepta la incapacidad con su PDF', () => {
    const r = validar(
      nueva({ tipo: 'incapacidad', fechaInicio: INCAP_DESDE, fechaFin: INCAP_HASTA, adjunto: { nombreArchivo: 'inc.pdf', mime: 'application/pdf', contenidoBase64: PDF_BASE64 } }),
    );
    expect(r.adjunto?.nombreArchivo).toBe('inc.pdf');
  });

  it('no permite adjuntar algo que no sea un PDF', () => {
    expect(() =>
      validar(
        // `fechaFin` explícita: un permiso es de un solo día, y con el rango por
        // defecto de `nueva()` este test rebotaría por eso en vez de por el
        // adjunto, que es lo que viene a probar.
        nueva({ tipo: 'permiso', fechaFin: '2026-07-06', adjunto: { nombreArchivo: 'x.exe', mime: 'application/x-msdownload', contenidoBase64: PDF_BASE64 } }),
      ),
    ).toThrow(expect.objectContaining({ code: 'adjunto_no_es_pdf' }));
  });

  it('rechaza un adjunto por encima del tope sin llegar a decodificarlo', () => {
    const enorme = 'A'.repeat(12 * 1024 * 1024); // ~9 MB una vez decodificado
    expect(() =>
      validar(
        nueva({ tipo: 'incapacidad', fechaInicio: INCAP_DESDE, fechaFin: INCAP_HASTA, adjunto: { nombreArchivo: 'i.pdf', mime: 'application/pdf', contenidoBase64: enorme } }),
      ),
    ).toThrow(expect.objectContaining({ code: 'adjunto_demasiado_grande' }));
  });

  it('el permiso puede ir sin adjunto', () => {
    // De un solo día, por lo mismo que los dos de arriba.
    expect(validar(nueva({ tipo: 'permiso', fechaFin: '2026-07-06' })).adjunto).toBeUndefined();
  });

  it('ignora cualquier empleadoId o diasHabiles que mande el cliente', () => {
    // La identidad sale de la sesión y los días se calculan en el servidor: si
    // estos campos se colaran, cualquiera podría pedir vacaciones a nombre de
    // otro o declararse 40 días hábiles en una semana.
    const r = validar(nueva({ empleadoId: 'otro', diasHabiles: 99 })) as unknown as Record<string, unknown>;
    expect(r.empleadoId).toBeUndefined();
    expect(r.diasHabiles).toBeUndefined();
  });
});

describe('validarNuevaSolicitud — la hora del permiso', () => {
  const base = { tipo: 'permiso', fechaInicio: '2026-07-02', fechaFin: '2026-07-02' };

  it('sin horas, un permiso sigue siendo de día completo', () => {
    const r = validar(base);
    expect(r.horaInicio).toBeNull();
    expect(r.horaFin).toBeNull();
  });

  it('acepta la pareja completa', () => {
    const r = validar({ ...base, horaInicio: '09:00', horaFin: '11:00' });
    expect(r.horaInicio).toBe('09:00');
    expect(r.horaFin).toBe('11:00');
  });

  it('CANDADO: media pareja es un 400', () => {
    // La BD ya lo rechaza, pero ahí llega como un 500 opaco desde dentro de una
    // transacción. Aquí sale como un 400 con el campo señalado.
    expect(() => validar({ ...base, horaInicio: '09:00' })).toThrow(
      expect.objectContaining({ code: 'hora_invalida', status: 400 }),
    );
    expect(() => validar({ ...base, horaFin: '11:00' })).toThrow(
      expect.objectContaining({ code: 'hora_invalida', status: 400 }),
    );
  });

  it('CANDADO: un formato que no sea HH:MM es un 400', () => {
    // '9:5' compilaría y se concatenaría al ISO de Google sin que nadie avise.
    for (const mala of ['9:00', '09:0', '25:00', '09:60', 'mañana', '09:00:00']) {
      expect(() => validar({ ...base, horaInicio: mala, horaFin: '18:00' })).toThrow(
        expect.objectContaining({ code: 'hora_invalida' }),
      );
    }
  });

  it('CANDADO: la hora de fin tiene que ser posterior a la de inicio', () => {
    expect(() => validar({ ...base, horaInicio: '11:00', horaFin: '09:00' })).toThrow(
      expect.objectContaining({ code: 'hora_invalida', status: 400, field: 'horaFin' }),
    );
    expect(() => validar({ ...base, horaInicio: '09:00', horaFin: '09:00' })).toThrow(
      expect.objectContaining({ code: 'hora_invalida', status: 400, field: 'horaFin' }),
    );
  });

  it('CANDADO: solo un PERMISO admite hora', () => {
    expect(() =>
      validar({ ...base, tipo: 'vacaciones', horaInicio: '09:00', horaFin: '11:00' }),
    ).toThrow(expect.objectContaining({ code: 'hora_no_permitida', status: 400 }));
  });

  it('CANDADO: con horas, el rango tiene que ser de un solo día', () => {
    // ⚠️ Desde el 2026-08-25 esto lo caza `permiso_de_un_solo_dia` y no
    // `hora_no_permitida`: la regla de que un permiso ocupa UN día va antes en la
    // validación, y es la más básica de las dos — ese rango ya está mal lleve o
    // no horas.
    //
    // El enunciado que este test defiende sigue siendo cierto y sigue mereciendo
    // candado; lo que cambió es quién lo dice. Por eso la rama
    // `fechaInicio !== fechaFin` de `validarHoras` quedó INALCANZABLE, y allí se
    // anota: se conserva por si algún día vuelve a haber permisos de varios días.
    expect(() =>
      validar({ ...base, fechaFin: '2026-07-03', horaInicio: '09:00', horaFin: '11:00' }),
    ).toThrow(expect.objectContaining({ code: 'permiso_de_un_solo_dia', status: 400, field: 'fechaFin' }));
  });
});

describe('nombreArchivoNormalizado', () => {
  it('mantiene la convención del flujo de n8n', () => {
    expect(nombreArchivoNormalizado('incapacidad', 'Ana Ruiz', '2026-07-06')).toBe(
      'Incapacidades_Ana_Ruiz_2026-07-06_1.pdf',
    );
  });

  it('quita tildes y ñ del nombre', () => {
    expect(nombreArchivoNormalizado('permiso', 'José Muñoz Peña', '2026-07-06')).toBe(
      'Permisos_Jose_Munoz_Pena_2026-07-06_1.pdf',
    );
  });

  it('aguanta un nombre de una sola palabra', () => {
    expect(nombreArchivoNormalizado('permiso', 'Madonna', '2026-07-06')).toBe('Permisos_Madonna_Apellidos_2026-07-06_1.pdf');
  });
});

describe('permisos', () => {
  const yo: Sesion = { email: 'comercial@ambientalia.com.co', userId: 'u1', esAdmin: false };
  const otro: Sesion = { email: 'alguien@ambientalia.com.co', userId: 'u2', esAdmin: false };
  const admin: Sesion = { email: 'admin@ambientalia.com.co', userId: 'u3', esAdmin: true };

  it('solo decide quien la tiene asignada', () => {
    expect(puedeDecidir(yo, solicitud())).toBe(true);
    expect(puedeDecidir(otro, solicitud())).toBe(false);
  });

  it('el admin puede decidir cualquiera — es quien destraba una aprobación parada', () => {
    expect(puedeDecidir(admin, solicitud())).toBe(true);
  });

  it('compara correos sin distinguir mayúsculas', () => {
    expect(puedeDecidir({ ...yo, email: 'COMERCIAL@Ambientalia.com.co' }, solicitud())).toBe(true);
  });

  it('el PDF solo lo ven el solicitante, sus dos aprobadores y un admin', () => {
    const adj = {
      solicitudId: 's1',
      solicitanteEmail: 'director.tecnico@ambientalia.com.co',
      aprobadorCorreo: 'comercial@ambientalia.com.co',
      segundoAprobadorCorreo: null,
      nombreArchivo: 'i.pdf',
      mime: 'application/pdf',
      contenido: Buffer.from(''),
    };
    expect(puedeVerAdjunto({ ...otro, email: 'director.tecnico@ambientalia.com.co' }, adj, false)).toBe(true);
    expect(puedeVerAdjunto(yo, adj, false)).toBe(true);
    expect(puedeVerAdjunto(admin, adj, false)).toBe(true);
    expect(puedeVerAdjunto(otro, adj, false)).toBe(false);
  });

  it('administración abre el PDF de un tercero con el que no tiene ninguna relación', () => {
    const adj = {
      solicitudId: 's1',
      solicitanteEmail: 'ajena@ambientalia.com.co',
      aprobadorCorreo: 'jefa.directa@ambientalia.com.co',
      segundoAprobadorCorreo: null,
      nombreArchivo: 'incapacidad.pdf',
      mime: 'application/pdf',
      contenido: Buffer.from(''),
    };
    const visor = { email: 'administrativo@ambientalia.com.co', userId: null, esAdmin: false };
    expect(puedeVerAdjunto(visor, adj, true)).toBe(true);
    expect(puedeVerAdjunto(otro, adj, false)).toBe(false);
  });

  it('la llave no mira el correo de la sesión, al contrario que las demás ramas', () => {
    // Se llamaba «el visor entra aunque su correo llegue en MAYÚSCULAS», y dejó de
    // ser cierto: desde que `esVisor` entra por parámetro, la normalización vive
    // en el `lower()` del SQL de `repo.esVisorDeAdjuntos` y aquí ya no se puede
    // probar —no hay Postgres en este fichero—. Lo que sí fija, y por eso no se
    // retira, es que la rama de la llave gana SIN comparar correos, a diferencia
    // de las de solicitante y aprobadores: el correo va en mayúsculas justo para
    // que el test caiga si alguien la reescribiera para mirarlo.
    const adj = {
      solicitudId: 's1',
      solicitanteEmail: 'ajena@ambientalia.com.co',
      aprobadorCorreo: null,
      segundoAprobadorCorreo: null,
      nombreArchivo: 'i.pdf',
      mime: 'application/pdf',
      contenido: Buffer.from(''),
    };
    expect(puedeVerAdjunto({ email: 'ADMINISTRATIVO@AMBIENTALIA.COM.CO', userId: null, esAdmin: false }, adj, true)).toBe(
      true,
    );
  });

  it('el segundo aprobador ve el PDF aunque todavía no sea su turno', () => {
    // La ruta del adjunto devuelve 404, no 403: sin esto tendría que firmar un
    // permiso sin poder abrir su soporte y sin entender por qué.
    const adj = {
      solicitudId: 's1',
      solicitanteEmail: 'director.tecnico@ambientalia.com.co',
      aprobadorCorreo: 'jefa.directa@ambientalia.com.co',
      segundoAprobadorCorreo: 'comercial@ambientalia.com.co',
      nombreArchivo: 'i.pdf',
      mime: 'application/pdf',
      contenido: Buffer.from(''),
    };
    expect(puedeVerAdjunto(yo, adj, false)).toBe(true);
    expect(puedeVerAdjunto(otro, adj, false)).toBe(false);
  });

  it('el visor puede abrir cualquier adjunto', () => {
    // El booleano entra por parámetro y no se consulta aquí: así la regla se
    // puede probar sin Postgres, que es como se prueba todo en este repo.
    const ajeno = { solicitanteEmail: 'otra@ambientalia.com.co', aprobadorCorreo: null, segundoAprobadorCorreo: null } as never;
    expect(puedeVerAdjunto({ email: 'quien.sea@ambientalia.com.co', userId: null, esAdmin: false }, ajeno, true)).toBe(true);
  });

  it('sin la llave no se abre un adjunto ajeno', () => {
    const ajeno = { solicitanteEmail: 'otra@ambientalia.com.co', aprobadorCorreo: null, segundoAprobadorCorreo: null } as never;
    expect(puedeVerAdjunto({ email: 'quien.sea@ambientalia.com.co', userId: null, esAdmin: false }, ajeno, false)).toBe(false);
  });

  it('quitar la llave no cierra el adjunto a quien lo pidió ni a quien lo firma', () => {
    // La llave AÑADE acceso, no lo condiciona: si al retirarla se perdiera el
    // acceso propio, quitársela a alguien le dejaría sin ver sus propias
    // solicitudes.
    const sesion = { email: 'ana@ambientalia.com.co', userId: null, esAdmin: false };
    const propio = { solicitanteEmail: 'ana@ambientalia.com.co', aprobadorCorreo: null, segundoAprobadorCorreo: null } as never;
    const aFirmar = { solicitanteEmail: 'otra@ambientalia.com.co', aprobadorCorreo: 'ana@ambientalia.com.co', segundoAprobadorCorreo: null } as never;
    expect(puedeVerAdjunto(sesion, propio, false)).toBe(true);
    expect(puedeVerAdjunto(sesion, aFirmar, false)).toBe(true);
  });
});

describe('transicionAlDecidir', () => {
  const conSegundo = { estado: 'pendiente' as const, segundoAprobadorCorreo: 'comercial@ambientalia.com.co' };
  const sinSegundo = { estado: 'pendiente' as const, segundoAprobadorCorreo: null };

  it('la primera firma de dos sube a pendiente_2 y NO cierra la solicitud', () => {
    // El mutante que muere aquí: encolar `aprobada` en la primera firma manda el
    // correo de aprobada y crea el evento de Google Calendar antes de tiempo.
    expect(transicionAlDecidir(conSegundo, true)).toEqual({
      estado: 'pendiente_2',
      evento: 'aprobacion_2',
      esPrimeraFirma: true,
      esDecisionFinal: false,
    });
  });

  it('sin segundo aprobador, una sola firma la deja aprobada', () => {
    // Es el comportamiento anterior a la cascada, y el de toda la plantilla hasta
    // que se rellene el organigrama. Mandar todo a pendiente_2 atascaría a medio
    // mundo el día del despliegue.
    expect(transicionAlDecidir(sinSegundo, true)).toEqual({
      estado: 'aprobada',
      evento: 'aprobada',
      esPrimeraFirma: true,
      esDecisionFinal: true,
    });
  });

  it('la segunda firma cierra la solicitud y no vuelve a sellar la primera', () => {
    expect(transicionAlDecidir({ estado: 'pendiente_2', segundoAprobadorCorreo: 'x@y.com' }, true)).toEqual({
      estado: 'aprobada',
      evento: 'aprobada',
      esPrimeraFirma: false,
      esDecisionFinal: true,
    });
  });

  it('el rechazo es terminal en los dos niveles', () => {
    expect(transicionAlDecidir(conSegundo, false)?.estado).toBe('rechazada');
    expect(transicionAlDecidir({ estado: 'pendiente_2', segundoAprobadorCorreo: 'x@y.com' }, false)?.estado).toBe(
      'rechazada',
    );
  });

  it('un rechazo en el primer nivel también sella la primera firma: el jefe actuó', () => {
    expect(transicionAlDecidir(conSegundo, false)?.esPrimeraFirma).toBe(true);
  });

  it('los estados terminales no admiten firma', () => {
    for (const estado of ['aprobada', 'rechazada', 'registrada'] as const) {
      expect(transicionAlDecidir({ estado, segundoAprobadorCorreo: null }, true)).toBeNull();
    }
  });
});

describe('puedeDecidir con dos firmas', () => {
  const primero = { email: 'jefa.directa@ambientalia.com.co', userId: null, esAdmin: false };
  const segundo = { email: 'comercial@ambientalia.com.co', userId: null, esAdmin: false };
  const enCascada = solicitud({
    aprobadorCorreo: 'jefa.directa@ambientalia.com.co',
    segundoAprobadorCorreo: 'comercial@ambientalia.com.co',
  });

  it('en pendiente firma el jefe inmediato', () => {
    expect(puedeDecidir(primero, enCascada)).toBe(true);
  });

  it('en pendiente el segundo NO se salta la cola', () => {
    // El mutante que muere aquí: escribirlo como un OR de los dos correos —que es
    // la forma más natural— deja al superior firmar solo, y la cascada desaparece
    // sin que nada falle.
    expect(puedeDecidir(segundo, enCascada)).toBe(false);
  });

  it('en pendiente_2 firma el segundo y ya no el primero', () => {
    const subida = { ...enCascada, estado: 'pendiente_2' as const };
    expect(puedeDecidir(segundo, subida)).toBe(true);
    expect(puedeDecidir(primero, subida)).toBe(false);
  });

  it('en estado terminal pasan los dos, para que gane el 409 sobre el 403', () => {
    const cerrada = { ...enCascada, estado: 'aprobada' as const };
    expect(puedeDecidir(primero, cerrada)).toBe(true);
    expect(puedeDecidir(segundo, cerrada)).toBe(true);
  });

  it('un admin destraba en cualquier nivel', () => {
    expect(puedeDecidir({ email: 'a@b.com', userId: null, esAdmin: true }, enCascada)).toBe(true);
  });
});


describe('validarSaldo', () => {
  it('acepta un saldo con decimal y su fecha', () => {
    expect(validarSaldo({ saldoCorte: 12.5, fechaCorte: '2026-08-12' })).toEqual({
      vacaciones: { saldoCorte: 12.5, fechaCorte: '2026-08-12' },
      // Null y no una pareja vacía: el body no traía la de compensatorios, así
      // que esa bolsa no se toca. Ver el candado del despliegue más abajo.
      compensatorios: null,
    });
  });

  it('acepta la coma decimal que teclea la gente', () => {
    expect(validarSaldo({ saldoCorte: '12,5', fechaCorte: '2026-08-12' }).vacaciones.saldoCorte).toBe(12.5);
  });

  it('acepta vaciar la configuración con las dos a null', () => {
    expect(validarSaldo({ saldoCorte: null, fechaCorte: null })).toEqual({
      vacaciones: { saldoCorte: null, fechaCorte: null },
      compensatorios: null,
    });
  });

  it('CANDADO del despliegue: sin las claves de compensatorios, esa bolsa NO se toca', () => {
    // Es exactamente lo que manda un PanelSaldos anterior a esta función. Si su
    // ausencia se leyera como «vaciar», la primera vez que un admin corrigiera
    // las vacaciones de alguien durante la ventana de despliegue le borraría la
    // bolsa de compensatorios, sin error y sin rastro.
    expect(validarSaldo({ saldoCorte: 12.5, fechaCorte: '2026-08-12' }).compensatorios).toBeNull();
  });

  it('acepta las dos parejas a la vez, cada una con su fecha', () => {
    // Fechas distintas a propósito: las dos bolsas se cuadran contra recuentos
    // distintos, y que puedan separarse es la razón de que sean columnas propias.
    expect(
      validarSaldo({
        saldoCorte: 12.5,
        fechaCorte: '2026-08-12',
        compensatoriosSaldoCorte: '3,5',
        compensatoriosFechaCorte: '2026-01-31',
      }),
    ).toEqual({
      vacaciones: { saldoCorte: 12.5, fechaCorte: '2026-08-12' },
      compensatorios: { saldoCorte: 3.5, fechaCorte: '2026-01-31' },
    });
  });

  it('acepta vaciar solo la bolsa de compensatorios', () => {
    expect(
      validarSaldo({
        saldoCorte: 12.5,
        fechaCorte: '2026-08-12',
        compensatoriosSaldoCorte: null,
        compensatoriosFechaCorte: null,
      }).compensatorios,
    ).toEqual({ saldoCorte: null, fechaCorte: null });
  });

  it('rechaza media pareja de compensatorios, señalando la que falta', () => {
    // Basta con que asome UNA de las dos claves para exigir la otra: así un
    // front que sí las conoce pero manda media pareja recibe su 400, sin que eso
    // estropee el caso legítimo de que no venga ninguna.
    const soloSaldo = () =>
      validarSaldo({ saldoCorte: 1, fechaCorte: '2026-08-12', compensatoriosSaldoCorte: 3 });
    expect(soloSaldo).toThrow(AusenciaError);
    try {
      soloSaldo();
    } catch (e) {
      expect((e as AusenciaError).field).toBe('compensatoriosFechaCorte');
    }
  });

  it('valida la bolsa de compensatorios con el mismo rasero que la de vacaciones', () => {
    const con = (v: unknown) =>
      validarSaldo({ saldoCorte: 1, fechaCorte: '2026-08-12', compensatoriosSaldoCorte: v, compensatoriosFechaCorte: '2026-08-12' });
    // Es OTRA ruta de código aunque comparta la regex: compartirla no garantiza
    // compartir el orden de comprobaciones.
    expect(() => con('0x10')).toThrow(AusenciaError);
    expect(() => con('1e2')).toThrow(AusenciaError);
    expect(() => con('  ')).toThrow(AusenciaError);
    expect(() => con([5])).toThrow(AusenciaError);
    expect(() => con(true)).toThrow(AusenciaError);
    expect(() => con(-1000)).toThrow(AusenciaError);
    expect(con(-2.8).compensatorios?.saldoCorte).toBe(-2.8);
  });

  it('CANDADO cruzado: tocar una bolsa no altera lo que sale de la otra', () => {
    const soloVacaciones = validarSaldo({ saldoCorte: 7, fechaCorte: '2026-08-12' }).vacaciones;
    const conAmbas = validarSaldo({
      saldoCorte: 7,
      fechaCorte: '2026-08-12',
      compensatoriosSaldoCorte: 99,
      compensatoriosFechaCorte: '2020-01-01',
    }).vacaciones;
    expect(conAmbas).toEqual(soloVacaciones);
  });

  it('rechaza una fecha mágica de Postgres también en compensatorios', () => {
    // 'infinity' y 'today' los aceptaría la columna DATE sin rechistar.
    expect(() =>
      validarSaldo({
        saldoCorte: 1,
        fechaCorte: '2026-08-12',
        compensatoriosSaldoCorte: 1,
        compensatoriosFechaCorte: 'infinity',
      }),
    ).toThrow(AusenciaError);
  });

  it('acepta un saldo negativo, que es quien ha adelantado vacaciones', () => {
    // El Excel del que salen los saldos iniciales los trae: significa que esa
    // persona ha disfrutado más días de los que lleva devengados. Rechazarlos
    // era una suposición equivocada, y además contradecía al resto de la app,
    // que sí calcula y pinta un disponible negativo.
    expect(validarSaldo({ saldoCorte: -2.8, fechaCorte: '2026-08-12' }).vacaciones.saldoCorte).toBe(-2.8);
    expect(validarSaldo({ saldoCorte: '-2,8', fechaCorte: '2026-08-12' }).vacaciones.saldoCorte).toBe(-2.8);
    expect(validarSaldo({ saldoCorte: '-2.8333', fechaCorte: '2026-08-12' }).vacaciones.saldoCorte).toBe(-2.8);
  });

  it('rechaza un saldo absurdamente negativo, que es un tecleo', () => {
    expect(() => validarSaldo({ saldoCorte: -1000, fechaCorte: '2026-08-12' })).toThrow(AusenciaError);
  });

  it('no confunde el signo con basura', () => {
    expect(() => validarSaldo({ saldoCorte: '-', fechaCorte: '2026-08-12' })).toThrow(AusenciaError);
    expect(() => validarSaldo({ saldoCorte: '--5', fechaCorte: '2026-08-12' })).toThrow(AusenciaError);
    expect(() => validarSaldo({ saldoCorte: '5-', fechaCorte: '2026-08-12' })).toThrow(AusenciaError);
    expect(() => validarSaldo({ saldoCorte: '-0x10', fechaCorte: '2026-08-12' })).toThrow(AusenciaError);
  });

  it('rechaza un saldo que no es número', () => {
    expect(() => validarSaldo({ saldoCorte: 'x', fechaCorte: '2026-08-12' })).toThrow(AusenciaError);
  });

  it('rechaza un saldo absurdo por tecleo', () => {
    // NUMERIC(5,1) admite hasta 9999,9, pero 999 días son 66 años de devengo.
    expect(() => validarSaldo({ saldoCorte: 5000, fechaCorte: '2026-08-12' })).toThrow(AusenciaError);
  });

  it('rechaza una fecha inválida', () => {
    expect(() => validarSaldo({ saldoCorte: 10, fechaCorte: '12/08/2026' })).toThrow(AusenciaError);
  });

  it('rechaza los valores mágicos de fecha de Postgres', () => {
    // `'infinity'` y `'today'` son fechas válidas para Postgres. Si se colaran,
    // `::text` las devolvería tal cual y el cálculo del saldo lanzaría.
    expect(() => validarSaldo({ saldoCorte: 10, fechaCorte: 'infinity' })).toThrow(AusenciaError);
    expect(() => validarSaldo({ saldoCorte: 10, fechaCorte: 'today' })).toThrow(AusenciaError);
  });

  it('rechaza la configuración a medias', () => {
    // Espejo del CHECK de la BD, para dar un error legible en vez de un fallo de
    // constraint de Postgres.
    expect(() => validarSaldo({ saldoCorte: 10, fechaCorte: null })).toThrow(AusenciaError);
    expect(() => validarSaldo({ saldoCorte: null, fechaCorte: '2026-08-12' })).toThrow(AusenciaError);
  });

  it('en la configuración a medias, señala el campo que falta y no el que sí llegó', () => {
    // Si señalara el que sí llegó, la interfaz resaltaría como culpable
    // justo el campo que el admin rellenó bien.
    expect(() => validarSaldo({ saldoCorte: 10, fechaCorte: null })).toThrow(
      expect.objectContaining({ field: 'fechaCorte' }),
    );
    expect(() => validarSaldo({ saldoCorte: null, fechaCorte: '2026-08-12' })).toThrow(
      expect.objectContaining({ field: 'saldoCorte' }),
    );
  });

  it('rechaza espacios en blanco como saldo, aunque Number() los acepte como 0', () => {
    // Camino de usuario real: el panel de admin usa `type="text"` y teclear
    // solo espacios y guardar no debe colar un saldo de 0 días con un 200.
    expect(() => validarSaldo({ saldoCorte: '  ', fechaCorte: '2026-08-12' })).toThrow(AusenciaError);
    expect(() => validarSaldo({ saldoCorte: '\t\n', fechaCorte: '2026-08-12' })).toThrow(AusenciaError);
  });

  it('rechaza un array como saldo, que Number() aceptaría vía toString', () => {
    expect(() => validarSaldo({ saldoCorte: [], fechaCorte: '2026-08-12' })).toThrow(AusenciaError);
    expect(() => validarSaldo({ saldoCorte: [5], fechaCorte: '2026-08-12' })).toThrow(AusenciaError);
  });

  it('rechaza hexadecimal y notación científica, que Number() entiende pero nadie teclea a mano', () => {
    expect(() => validarSaldo({ saldoCorte: '0x10', fechaCorte: '2026-08-12' })).toThrow(AusenciaError);
    expect(() => validarSaldo({ saldoCorte: '1e2', fechaCorte: '2026-08-12' })).toThrow(AusenciaError);
  });

  it('sigue aceptando lo que ya funcionaba bien', () => {
    expect(validarSaldo({ saldoCorte: '12,5', fechaCorte: '2026-08-12' }).vacaciones.saldoCorte).toBe(12.5);
    expect(validarSaldo({ saldoCorte: 0, fechaCorte: '2026-08-12' }).vacaciones.saldoCorte).toBe(0);
    expect(validarSaldo({ saldoCorte: '0', fechaCorte: '2026-08-12' }).vacaciones.saldoCorte).toBe(0);
    expect(validarSaldo({ saldoCorte: 999, fechaCorte: '2026-08-12' }).vacaciones.saldoCorte).toBe(999);
  });

  it('sigue rechazando lo que ya rechazaba bien', () => {
    expect(() => validarSaldo({ saldoCorte: '12.5abc', fechaCorte: '2026-08-12' })).toThrow(AusenciaError);
    expect(() => validarSaldo({ saldoCorte: true, fechaCorte: '2026-08-12' })).toThrow(AusenciaError);
    expect(() => validarSaldo({ saldoCorte: {}, fechaCorte: '2026-08-12' })).toThrow(AusenciaError);
    expect(() => validarSaldo({ saldoCorte: '5 ', fechaCorte: '2026-08-12' })).toThrow(AusenciaError);
    expect(() => validarSaldo({ saldoCorte: Infinity, fechaCorte: '2026-08-12' })).toThrow(AusenciaError);
  });

  it('rechaza una fecha que no sea string, aunque String() la convierta a algo con forma de fecha', () => {
    expect(() => validarSaldo({ saldoCorte: 10, fechaCorte: ['2026-08-12'] })).toThrow(AusenciaError);
  });

  it('vacía la configuración solo si las dos claves están presentes y en null', () => {
    // Un body sin las claves esperadas no debe colarse como «las dos vacías»:
    // un renombrado de campo en el front (`saldo`/`fecha` en vez de
    // `saldoCorte`/`fechaCorte`) borraría en silencio un saldo ya configurado.
    expect(() => validarSaldo(null)).toThrow(AusenciaError);
    expect(() => validarSaldo({})).toThrow(AusenciaError);
    expect(() => validarSaldo('hola')).toThrow(AusenciaError);
    expect(() => validarSaldo({ saldo: 12.5, fecha: '2026-08-12' })).toThrow(AusenciaError);
  });
});

describe('el informado no hereda ningún permiso del segundo firmante', () => {
  const INFORMADO = 'gerencia@ambientalia.com.co';
  const suSesion = { email: INFORMADO, userId: null, esAdmin: false };

  const sinSegundaFirma = solicitud({
    aprobadorCorreo: 'jefa.directa@ambientalia.com.co',
    segundoAprobadorCorreo: null,
    informadoCorreo: INFORMADO,
  });

  it('no puede firmarla mientras está pendiente', () => {
    expect(puedeDecidir(suSesion, sinSegundaFirma)).toBe(false);
  });

  it('tampoco cuando ya está decidida', () => {
    // En estado terminal `puedeDecidir` deja pasar a los firmantes para que el
    // 409 gane al 403. El informado no es firmante, así que sigue siendo 403.
    expect(puedeDecidir(suSesion, { ...sinSegundaFirma, estado: 'aprobada' })).toBe(false);
  });

  /**
   * El adjunto lleva `informadoCorreo` aunque `AdjuntoCompleto` NO tenga ese
   * campo: hoy la consulta de adjuntos no lo selecciona, y por eso el dato no
   * llega hasta aquí.
   *
   * Ponerlo igualmente es lo que convierte los dos tests de abajo en candados de
   * verdad. Sin él, ampliar `puedeVerAdjunto` para mirar al informado los dejaría
   * en VERDE —la comparación caería contra `undefined`— y estarían afirmando algo
   * mucho más flojo: que un tercero cualquiera no abre el soporte, que ya cubren
   * los tests de más arriba. Se comprobó rompiendo el código a propósito.
   */
  const adjuntoDeLaSolicitud = {
    solicitanteEmail: 'ana.ruiz@ambientalia.com.co',
    aprobadorCorreo: 'jefa.directa@ambientalia.com.co',
    segundoAprobadorCorreo: null,
    informadoCorreo: INFORMADO,
  } as never;

  it('no puede abrir el soporte', () => {
    // Que reciba el correo del resultado no le da acceso al dato de salud que lo
    // respalda: los soportes de las incapacidades son historia clínica.
    expect(puedeVerAdjunto(suSesion, adjuntoDeLaSolicitud, false)).toBe(false);
  });

  it('con la llave maestra sí lo abre, como cualquiera que la tenga', () => {
    // La llave AÑADE acceso y nunca lo condiciona: no ser firmante no puede
    // quitársela a quien la tiene por otra vía.
    expect(puedeVerAdjunto(suSesion, adjuntoDeLaSolicitud, true)).toBe(true);
  });
});

// ── Modificación de una solicitud ya enviada ───────────────────────────────

describe('validarNuevaModificacion', () => {
  /** Las fechas que la solicitud tiene AHORA, contra las que se compara. */
  const ACTUAL = { tipo: 'vacaciones', fechaInicio: '2026-07-06', fechaFin: '2026-07-10' } as const;
  /**
   * Un «hoy» a mitad de la ausencia (empezó el 6, acaba el 10): es el único
   * escenario donde recortar y retroceder se distinguen, que es lo que la regla
   * de fechas pasadas tiene que separar.
   */
  const HOY_MOD = '2026-07-08';
  const cambio = (over: Record<string, unknown> = {}) => ({
    clase: 'fechas',
    fechaInicio: '2026-07-13',
    fechaFin: '2026-07-15',
    ...over,
  });
  const validar = (body: unknown, hoy: string = HOY_MOD) => validarNuevaModificacion(body, ACTUAL, hoy);

  it('acepta un cambio de fechas y limpia el motivo', () => {
    expect(validar(cambio({ motivo: '  Cita médica  ' }))).toEqual({
      clase: 'fechas',
      fechaInicio: '2026-07-13',
      fechaFin: '2026-07-15',
      motivo: 'Cita médica',
    });
  });

  it('acepta una anulación, con las tres fechas en null', () => {
    expect(validar({ clase: 'anulacion', motivo: 'Se cancela el viaje' })).toEqual({
      clase: 'anulacion',
      fechaInicio: null,
      fechaFin: null,
      motivo: 'Se cancela el viaje',
    });
  });

  it('rechaza una clase que no existe', () => {
    expect(() => validar(cambio({ clase: 'cambiar_tipo' }))).toThrow(
      expect.objectContaining({ code: 'clase_invalida', status: 400, field: 'clase' }),
    );
    expect(() => validar({})).toThrow(expect.objectContaining({ code: 'clase_invalida' }));
  });

  it('CANDADO: una anulación que trae fechas es 400, no se ignoran en silencio', () => {
    // Un cliente con un bug creería haber pedido un cambio de fechas y habría
    // pedido que le anularan las vacaciones. Aceptarlo «quedándose con la
    // clase» es la forma silenciosa de borrarle los días a alguien.
    // Código propio: `clase_invalida` sobre un payload donde `clase` vale
    // 'anulacion' se lee como una mentira en un log, y el cliente no puede
    // distinguir «esa clase no existe» de «tu clase contradice tus fechas».
    expect(() => validar({ clase: 'anulacion', fechaInicio: '2026-07-13', fechaFin: '2026-07-15' })).toThrow(
      expect.objectContaining({ code: 'anulacion_con_fechas', status: 400, field: 'clase' }),
    );
    // Con una sola de las dos, también.
    expect(() => validar({ clase: 'anulacion', fechaFin: '2026-07-15' })).toThrow(
      expect.objectContaining({ code: 'anulacion_con_fechas' }),
    );
    // Y un input vacío del formulario NO cuenta como fecha.
    expect(() => validar({ clase: 'anulacion', fechaInicio: '', fechaFin: '' })).not.toThrow();
  });

  it('rechaza fechas que no son de calendario', () => {
    expect(() => validar(cambio({ fechaInicio: '2026-02-30' }))).toThrow(
      expect.objectContaining({ code: 'fecha_invalida', field: 'fechaInicio' }),
    );
    expect(() => validar(cambio({ fechaFin: 'mañana' }))).toThrow(
      expect.objectContaining({ code: 'fecha_invalida', field: 'fechaFin' }),
    );
  });

  it('rechaza el rango invertido', () => {
    expect(() => validar(cambio({ fechaInicio: '2026-07-15', fechaFin: '2026-07-13' }))).toThrow(
      expect.objectContaining({ code: 'rango_invertido' }),
    );
  });

  it('rechaza rangos de más de un año', () => {
    expect(() => validar(cambio({ fechaFin: '2028-07-15' }))).toThrow(
      expect.objectContaining({ code: 'rango_demasiado_largo' }),
    );
  });

  it('CANDADO: pedir exactamente las fechas que ya tiene es 400', () => {
    // Si pasara, el jefe recibiría un correo pidiéndole que apruebe dejar todo
    // igual — y a la tercera vez deja de leerlos.
    expect(() => validar(cambio({ fechaInicio: ACTUAL.fechaInicio, fechaFin: ACTUAL.fechaFin }))).toThrow(
      expect.objectContaining({ code: 'sin_cambios', status: 400 }),
    );
  });

  it('cambiar solo una de las dos fechas SÍ es un cambio', () => {
    // El caso principal de la feature: acortar por la cola una ausencia en curso.
    expect(validar(cambio({ fechaInicio: ACTUAL.fechaInicio, fechaFin: '2026-07-08' }))).toMatchObject({
      fechaInicio: '2026-07-06',
      fechaFin: '2026-07-08',
    });
  });

  it('recortar una ausencia YA EMPEZADA vale, aunque su inicio esté en el pasado', () => {
    // Hoy es 8 de julio y la ausencia empezó el 6: «córtala, tengo que volver»
    // obliga a proponer un inicio pasado. Si esto se rechazara, la feature no
    // cubriría el caso que la justifica.
    expect(validar(cambio({ fechaInicio: ACTUAL.fechaInicio, fechaFin: '2026-07-08' }))).toMatchObject({
      fechaInicio: '2026-07-06',
      fechaFin: '2026-07-08',
    });
  });

  it('CANDADO: RETROCEDER al pasado es 400, aunque la solicitud siga vigente', () => {
    // El agujero que esto tapa: unas vacaciones de julio todavía sin empezar,
    // movidas a enero. Pasaba la validación y los dos CHECK de la 024, y dejaba
    // una fila legal reservando días ya pasados — al aplicarla, saldo movido de
    // un año a otro sin que nadie lo viera.
    expect(() => validar(cambio({ fechaInicio: '2026-01-05', fechaFin: '2026-01-08' }), '2026-06-01')).toThrow(
      expect.objectContaining({ code: 'fecha_en_pasado', status: 400, field: 'fechaInicio' }),
    );
  });

  it('adelantar el inicio SÍ vale mientras no caiga en el pasado', () => {
    // «Hacia atrás» es contra el calendario, no contra las fechas actuales:
    // pedir empezar antes es legítimo si esos días aún no han llegado.
    expect(validar(cambio({ fechaInicio: '2026-07-02', fechaFin: '2026-07-08' }), '2026-07-01')).toMatchObject({
      fechaInicio: '2026-07-02',
    });
  });

  it('rechaza un motivo kilométrico', () => {
    expect(() => validar(cambio({ motivo: 'x'.repeat(2001) }))).toThrow(
      expect.objectContaining({ code: 'motivo_demasiado_largo', field: 'motivo' }),
    );
    expect(validar(cambio({ motivo: 'x'.repeat(2000) })).motivo).toHaveLength(2000);
  });

  it('sin motivo se guarda null, no una cadena vacía', () => {
    expect(validar(cambio()).motivo).toBeNull();
    expect(validar(cambio({ motivo: '   ' })).motivo).toBeNull();
  });

  it('ignora cualquier empleadoId o diasHabiles que mande el cliente', () => {
    // Igual que en el alta: la identidad sale de la sesión y los días los cuenta
    // el servidor. Este test fija que no EXISTA la rama que los lea.
    const r = validar(cambio({ empleadoId: 'otro', diasHabiles: 99 })) as unknown as Record<string, unknown>;
    expect(r.empleadoId).toBeUndefined();
    expect(r.diasHabiles).toBeUndefined();
  });
});

describe('decisorDeModificacion', () => {
  const PRIMERO = 'jefa.directa@ambientalia.com.co';
  const SEGUNDO = 'comercial@ambientalia.com.co';
  const enCascada = (estado: EstadoSolicitud) =>
    solicitud({ estado, aprobadorCorreo: PRIMERO, segundoAprobadorCorreo: SEGUNDO });

  it('en `pendiente` decide el primer firmante', () => {
    expect(decisorDeModificacion(enCascada('pendiente'))).toBe(PRIMERO);
  });

  it('en `pendiente_2` decide el segundo: es a quien le toca el turno', () => {
    expect(decisorDeModificacion(enCascada('pendiente_2'))).toBe(SEGUNDO);
  });

  it('en `aprobada` decide el jefe inmediato, no el segundo', () => {
    // Ya no hay turno que respetar, y exigir dos firmas para RENUNCIAR a unas
    // vacaciones es absurdo. El jefe inmediato es quien reorganiza el trabajo.
    expect(decisorDeModificacion(enCascada('aprobada'))).toBe(PRIMERO);
  });

  it('una incapacidad (`registrada`, sin aprobador) no tiene decisor', () => {
    // Se informa, no se concede: no hay a quién mandarle la petición.
    expect(
      decisorDeModificacion(
        solicitud({ estado: 'registrada', aprobadorCorreo: null, segundoAprobadorCorreo: null }),
      ),
    ).toBeNull();
  });
});

describe('puedePedirModificacion', () => {
  const HOY_MOD = '2026-07-08';
  /** Una solicitud en cascada: los dos firmantes con valor en todos los estados. */
  const conFechaFin = (estado: EstadoSolicitud, fechaFin: string) =>
    solicitud({
      estado,
      fechaFin,
      aprobadorCorreo: 'jefa.directa@ambientalia.com.co',
      segundoAprobadorCorreo: 'comercial@ambientalia.com.co',
    });

  const FUTURA = '2026-07-20';
  const HOY_MISMO = HOY_MOD;
  const PASADA = '2026-07-07';

  it.each(['pendiente', 'pendiente_2', 'aprobada'] as const)('%s admite cambio si aún no ha terminado', (estado) => {
    expect(puedePedirModificacion(conFechaFin(estado, FUTURA), HOY_MOD)).toBe(true);
    // El último día cuenta: la ausencia todavía está en curso.
    expect(puedePedirModificacion(conFechaFin(estado, HOY_MISMO), HOY_MOD)).toBe(true);
    // Ya terminada, no: eso es corrección de nómina, no una aprobación.
    expect(puedePedirModificacion(conFechaFin(estado, PASADA), HOY_MOD)).toBe(false);
  });

  it.each(['rechazada', 'registrada'] as const)('%s no admite cambio en ninguna fecha', (estado) => {
    for (const fechaFin of [FUTURA, HOY_MISMO, PASADA]) {
      expect(puedePedirModificacion(conFechaFin(estado, fechaFin), HOY_MOD)).toBe(false);
    }
  });

  it('la regla mira `fechaFin` y NO `fechaInicio`: una ausencia en curso se puede acortar', () => {
    // Es el caso «córtala, tengo que volver». Con `fechaInicio` esto sería false
    // y la feature no cubriría justo el momento en que más se necesita.
    const enCurso = solicitud({
      estado: 'aprobada',
      fechaInicio: '2026-07-06',
      fechaFin: FUTURA,
      aprobadorCorreo: 'jefa.directa@ambientalia.com.co',
    });
    expect(puedePedirModificacion(enCurso, HOY_MOD)).toBe(true);
  });

  it('anular exige que NO haya empezado; cambiar las fechas, no', () => {
    // El agujero que separa las dos reglas: anular deja la solicitud en
    // `rechazada`, y `rechazada` devuelve TODOS sus días y desaparece del
    // calendario. Sobre una ausencia en curso eso regala los días ya
    // disfrutados; acortarla por la cola, no.
    const enCurso = solicitud({
      estado: 'aprobada',
      fechaInicio: '2026-07-06',
      fechaFin: '2026-07-20',
      aprobadorCorreo: 'jefa.directa@ambientalia.com.co',
    });
    expect(puedePedirModificacion(enCurso, HOY_MOD)).toBe(true);
    expect(puedePedirAnulacion(enCurso, HOY_MOD)).toBe(false);
  });

  it('anular vale hasta el primer día INCLUIDO', () => {
    // El `>=` es deliberado: un día solo queda consumido al terminar, y
    // cancelar la mañana del primer día es el caso normal. Con `>` esa persona
    // se quedaría además sin salida, porque no se puede acortar a menos de un
    // día. Ver el JSDoc de `noHaEmpezado` antes de «arreglar» esto.
    const empiezaHoy = solicitud({
      estado: 'aprobada',
      fechaInicio: HOY_MOD,
      fechaFin: '2026-07-20',
      aprobadorCorreo: 'jefa.directa@ambientalia.com.co',
    });
    const empiezaManana = solicitud({ ...empiezaHoy, fechaInicio: '2026-07-09' });
    expect(puedePedirAnulacion(empiezaHoy, HOY_MOD)).toBe(true);
    expect(puedePedirAnulacion(empiezaManana, HOY_MOD)).toBe(true);
  });

  it('sin decisor no admite cambio, aunque el estado y la fecha acompañen', () => {
    // La incapacidad llega aquí por el estado `registrada`, pero el candado real
    // es que no hay a quién mandárselo: una fila sin aprobador tampoco vale.
    const huerfana = solicitud({
      estado: 'aprobada',
      fechaFin: FUTURA,
      aprobadorCorreo: null,
      segundoAprobadorCorreo: null,
    });
    expect(puedePedirModificacion(huerfana, HOY_MOD)).toBe(false);
  });
});

describe('puedeDecidirModificacion', () => {
  const ANA = 'ana.ruiz@ambientalia.com.co';
  const PRIMERO = 'jefa.directa@ambientalia.com.co';
  const SEGUNDO = 'comercial@ambientalia.com.co';

  const sesion = (email: string, esAdmin = false): Sesion => ({ email, userId: null, esAdmin });

  /**
   * Una solicitud de Ana **en cascada y ya aprobada**: los dos firmantes con
   * valor. Que los dos existan es lo que hace falsable el candado de abajo — con
   * `segundoAprobadorCorreo: null` no habría segundo correo que colar por error.
   */
  const suya = solicitud({
    estado: 'aprobada',
    solicitanteEmail: ANA,
    aprobadorCorreo: PRIMERO,
    segundoAprobadorCorreo: SEGUNDO,
  });

  /** La propuesta, con su decisor CONGELADO: el jefe inmediato. */
  const propuesta: Modificacion = {
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
    motivo: 'Cita médica',
    estado: 'pendiente',
    aprobadorCorreo: PRIMERO,
    solicitanteEmail: ANA,
    decididaAt: null,
    motivoRechazo: null,
    createdAt: '2026-06-20T10:00:00Z',
  };

  it('el decisor congelado en la propuesta decide', () => {
    expect(puedeDecidirModificacion(sesion(PRIMERO), propuesta, suya)).toBe(true);
  });

  it('CANDADO: el OTRO firmante congelado de la solicitud NO decide', () => {
    // Escribir el guard como un OR de `aprobadorCorreo` y
    // `segundoAprobadorCorreo` de la SOLICITUD es lo natural, y es exactamente
    // el bug que `puedeDecidir` documenta: dejaría decidir a quien no le toca.
    // El decisor sale de la propuesta y de ningún otro sitio.
    expect(puedeDecidirModificacion(sesion(SEGUNDO), propuesta, suya)).toBe(false);
  });

  it('CANDADO: el propio solicitante NO decide, ni siendo él mismo el decisor congelado', () => {
    // Autoaprobarse convierte el debido proceso en un formulario: quien pide
    // anular sus vacaciones no puede además concedérselo.
    //
    // El caso que de verdad prueba el candado es el segundo: la raíz del
    // organigrama se declara como su propio jefe (`fijarJefe` lo admite y hay un
    // test que lo fija), así que `decisorDeModificacion` le devuelve su propio
    // correo. En el primero, quitar el guard no cambiaría nada —Ana tampoco es
    // la decisora—, y un test que solo cubriera ese pasaría por construcción.
    expect(puedeDecidirModificacion(sesion(ANA), propuesta, suya)).toBe(false);

    const suPropioJefe = { ...propuesta, aprobadorCorreo: ANA };
    expect(puedeDecidirModificacion(sesion(ANA), suPropioJefe, { ...suya, aprobadorCorreo: ANA })).toBe(false);
  });

  it('un admin decide: es quien destraba una decisión bloqueada', () => {
    expect(puedeDecidirModificacion(sesion('admin@ambientalia.com.co', true), propuesta, suya)).toBe(true);
  });

  it('un tercero cualquiera no decide', () => {
    expect(puedeDecidirModificacion(sesion('curioso@ambientalia.com.co'), propuesta, suya)).toBe(false);
  });

  it('compara sin distinguir mayúsculas, como el resto de los guards', () => {
    expect(puedeDecidirModificacion(sesion('Jefa.Directa@Ambientalia.com.co'), propuesta, suya)).toBe(true);
  });
});

describe('anular un otorgamiento', () => {
  const HOY_OT = '2026-08-20';
  /** Un otorgamiento aprobado por un trabajo del pasado, que es lo normal. */
  const otorgAprobado = () =>
    solicitud({
      tipo: 'otorgamiento',
      estado: 'aprobada',
      fechaInicio: '2026-06-20',
      fechaFin: '2026-06-20',
      diasHabiles: 1,
      aprobadorCorreo: 'jefa.directa@ambientalia.com.co',
      segundoAprobadorCorreo: null,
    });

  it('CANDADO: se puede anular aunque su fecha este en el pasado', () => {
    // Las dos reglas que lo gobiernan miran fechas de AUSENCIA: `sigueVigente`
    // exige `fechaFin >= hoy` y `noHaEmpezado` exige `fechaInicio >= hoy`. La
    // fecha de un otorgamiento es el dia que se TRABAJO y esta en el pasado
    // siempre, asi que sin las dos ramas NINGUNO seria anulable — que es lo
    // contrario de lo decidido.
    expect(puedePedirModificacion(otorgAprobado(), HOY_OT)).toBe(true);
    expect(puedePedirAnulacion(otorgAprobado(), HOY_OT)).toBe(true);
  });

  it('y el control: unas vacaciones ya pasadas siguen sin poder anularse', () => {
    // Sin esto, hacer que las dos reglas devuelvan siempre `true` dejaria el
    // candado de arriba verde y abriria de par en par la puerta que
    // `noHaEmpezado` documenta: anular devuelve TODOS los dias, tambien los ya
    // disfrutados.
    const vacacionesPasadas = solicitud({ estado: 'aprobada', fechaInicio: '2026-07-06', fechaFin: '2026-07-10' });
    expect(puedePedirModificacion(vacacionesPasadas, HOY_OT)).toBe(false);
    expect(puedePedirAnulacion(vacacionesPasadas, HOY_OT)).toBe(false);
  });

  it('un otorgamiento ya rechazado no admite nada, como el resto', () => {
    // La vigencia se la sigue dando el ESTADO, que es lo que no cambia.
    expect(puedePedirModificacion(solicitud({ tipo: 'otorgamiento', estado: 'rechazada' }), HOY_OT)).toBe(false);
  });
});

describe('validarNuevaModificacion sobre un otorgamiento', () => {
  const OTORG = { tipo: 'otorgamiento', fechaInicio: '2026-06-20', fechaFin: '2026-06-20' } as const;

  it('CANDADO: solo se le puede pedir la anulacion', () => {
    // No tiene rango que mover: es un dia de trabajo y una cantidad concedida.
    expect(() => validarNuevaModificacion({ clase: 'fechas', fechaInicio: '2026-07-01', fechaFin: '2026-07-02' }, OTORG, '2026-08-20')).toThrow(
      expect.objectContaining({ code: 'otorgamiento_solo_anulable', status: 409, field: 'clase' }),
    );
  });

  it('la anulacion si', () => {
    expect(validarNuevaModificacion({ clase: 'anulacion', motivo: 'Me equivoque' }, OTORG, '2026-08-20')).toMatchObject({
      clase: 'anulacion',
    });
  });
});

describe('validarNuevaSolicitud — un permiso es de un solo día', () => {
  it('CANDADO: el ALTA rechaza un permiso de varios días', () => {
    // El formulario ya solo manda una fecha, pero el servidor no puede fiarse de
    // eso: `POST /solicitudes` está abierto y sin esta regla se cuela una semana
    // entera como «permiso». Es el mismo razonamiento —y el mismo sitio— que la
    // regla gemela del otorgamiento, cuatro líneas más arriba.
    //
    // Sin él, la API podía FABRICAR registros que su propia API de modificación
    // declara inválidos: un permiso de cinco días creado por aquí recibe
    // `permiso_de_un_solo_dia` en cuanto alguien intenta tocarlo.
    expect(() => validar({ tipo: 'permiso', fechaInicio: '2026-07-02', fechaFin: '2026-07-06' })).toThrow(
      expect.objectContaining({ code: 'permiso_de_un_solo_dia', status: 400, field: 'fechaFin' }),
    );
  });

  it('de un solo día SÍ', () => {
    expect(validar({ tipo: 'permiso', fechaInicio: '2026-07-02', fechaFin: '2026-07-02' })).toMatchObject({
      tipo: 'permiso',
      fechaFin: '2026-07-02',
    });
  });

  it('CANDADO: a unas vacaciones de varios días no le afecta', () => {
    // La regla es del permiso. Un `fechaInicio !== fechaFin` suelto en la
    // validación se llevaría por delante el caso normal de las vacaciones.
    expect(validar({ tipo: 'vacaciones', fechaInicio: '2026-07-02', fechaFin: '2026-07-06' })).toMatchObject({
      fechaFin: '2026-07-06',
    });
  });
});

describe('validarNuevaModificacion sobre un permiso', () => {
  const PERMISO = { tipo: 'permiso', fechaInicio: '2026-09-03', fechaFin: '2026-09-03' } as const;

  it('CANDADO: no se le puede estirar a varios días', () => {
    // Desde el 2026-08-25 un permiso es de UN día, y esta es la OTRA puerta:
    // el formulario ya solo pide una fecha, pero sin este candado se pedía de un
    // día y se estiraba a cinco por aquí. Con la firma del jefe, sí, pero contra
    // la regla que el alta acaba de imponer — y la app diría dos cosas distintas
    // según por dónde se entre.
    expect(() =>
      validarNuevaModificacion(
        { clase: 'fechas', fechaInicio: '2026-09-03', fechaFin: '2026-09-07' },
        PERMISO,
        '2026-08-25',
      ),
    ).toThrow(expect.objectContaining({ code: 'permiso_de_un_solo_dia', status: 409, field: 'fechaFin' }));
  });

  it('moverlo a otro día SÍ, que es el caso corriente', () => {
    // «No puedo el jueves, que sea el viernes». Sigue siendo de un solo día, así
    // que pasa. Prohibirlo también habría sido tratarlo como al otorgamiento, y
    // mover un permiso de un día es legítimo.
    expect(
      validarNuevaModificacion(
        { clase: 'fechas', fechaInicio: '2026-09-04', fechaFin: '2026-09-04' },
        PERMISO,
        '2026-08-25',
      ),
    ).toMatchObject({ clase: 'fechas', fechaInicio: '2026-09-04', fechaFin: '2026-09-04' });
  });

  it('la anulación no la toca', () => {
    expect(
      validarNuevaModificacion({ clase: 'anulacion', motivo: 'Ya no me hace falta' }, PERMISO, '2026-08-25'),
    ).toMatchObject({ clase: 'anulacion' });
  });

  it('CANDADO: la regla es del PERMISO, no de todos los tipos', () => {
    // Sin este, un `fechaInicio !== fechaFin` suelto en la validación se llevaría
    // por delante las vacaciones, para las que estirar el rango es justamente el
    // caso normal.
    const VACACIONES = { tipo: 'vacaciones', fechaInicio: '2026-09-03', fechaFin: '2026-09-03' } as const;
    expect(
      validarNuevaModificacion(
        { clase: 'fechas', fechaInicio: '2026-09-03', fechaFin: '2026-09-07' },
        VACACIONES,
        '2026-08-25',
      ),
    ).toMatchObject({ fechaFin: '2026-09-07' });
  });
});
