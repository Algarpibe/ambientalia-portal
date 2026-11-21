// Condiciones de uso y política de tratamiento de datos personales del portal,
// versión 1.0 (spec docs/superpowers/specs/2026-11-20-terminos-del-servicio-design.md,
// Anexo). Es lo que se publica en /terminos y lo que cada usuario acepta.
//
// Va como datos y no como Markdown: sin dependencias nuevas, y la página decide
// cómo se pinta cada pieza.
//
// Este módulo solo puede exportar texto del Anexo: el candado de ./terminos.test.ts
// recorre TODO lo que se exporta y lo compara con el Anexo, así que una exportación
// ajena (una constante de configuración, un texto de interfaz) lo pondría en rojo.
//
// Dos candados:
//   · apps/hub-api/src/users/terms.test.ts lee este fichero como TEXTO y exige que
//     TERMS_VERSION sea la CURRENT_TERMS_VERSION de hub-api. Cambiar el texto de
//     verdad es subir la versión en los dos sitios, y todos vuelven a aceptarlo. Por
//     eso la declaración de TERMS_VERSION no cambia de forma: hub-api la lee como texto.
//   · ./terminos.test.ts falla si queda un hueco «[…]» o «{…}» en cualquier texto
//     exportado o si el texto no coincide con el Anexo del spec.

// Una versión nueva toca TRES cosas a la vez: esta constante, CURRENT_TERMS_VERSION
// en apps/hub-api/src/users/terms.ts y el Anexo del spec que lee el test. Además, la
// versión nueva lleva su PROPIO texto aprobado (un spec/Anexo nuevo o un
// docs/legal/terminos-vX.Y.md) y la ruta SPEC del test se apunta a él: el Anexo de la
// v1.0 no se edita nunca, porque el texto versionado en git de cada versión es la
// constancia de lo que aceptaron los usuarios.
export const TERMS_VERSION = '1.0';

/**
 * Día en que entra en vigor: el del despliegue del portal (spec §8), escrito
 * «24 de noviembre de 2026». Se fija en el último commit antes de fusionar;
 * mientras sea un hueco «[…]», el candado de ./terminos.test.ts falla a propósito.
 */
export const TERMS_EFFECTIVE_DATE = '[fecha de vigencia]';

/**
 * El canal de contacto del §2.1 y del §2.7: la dirección real de la fila «Canal
 * de contacto» del Anexo, a propósito (decisión del usuario, spec §2). Es el único
 * sitio del código donde puede aparecer. La escribe a mano el usuario antes de
 * fusionar: el filtro de privacidad no deja que la escriba un agente. Mientras sea
 * un hueco «[…]», el candado de ./terminos.test.ts falla a propósito.
 */
export const CORREO_CONTACTO = '[correo de contacto]';

/** Un párrafo; `destacado` es su arranque en negrita («1.1 Quién puede usarlo.»). */
export interface Parrafo {
  tipo: 'parrafo';
  destacado?: string;
  texto: string;
}

export interface Lista {
  tipo: 'lista';
  items: string[];
}

export interface Tabla {
  tipo: 'tabla';
  columnas: string[];
  filas: string[][];
}

export type Bloque = Parrafo | Lista | Tabla;

/** Un apartado («2.1 Responsable del tratamiento») y lo que lleva debajo. Sin título, va pegado al de la sección. */
export interface Apartado {
  titulo?: string;
  bloques: Bloque[];
}

export interface Seccion {
  titulo: string;
  apartados: Apartado[];
}

export const TITULO_TERMINOS =
  'Condiciones de uso y política de tratamiento de datos personales — Portal de aplicaciones';

export const INTRODUCCION =
  'Este documento reúne las condiciones de uso del portal de aplicaciones internas de AMBIENTALIA S.A.S. y la política con la que la compañía trata los datos personales de quienes lo usan. Al ingresar al portal, el usuario acepta ambas.';

export const LINEA_VERSION = `Versión ${TERMS_VERSION} · Vigente desde ${TERMS_EFFECTIVE_DATE}`;

const parrafo = (texto: string): Parrafo => ({ tipo: 'parrafo', texto });
const arranque = (destacado: string, texto: string): Parrafo => ({ tipo: 'parrafo', destacado, texto });
const lista = (...items: string[]): Lista => ({ tipo: 'lista', items });
const tabla = (columnas: string[], ...filas: string[][]): Tabla => ({ tipo: 'tabla', columnas, filas });

export const SECCIONES: Seccion[] = [
  {
    titulo: '1. Condiciones de uso',
    apartados: [
      {
        bloques: [
          arranque(
            '1.1 Quién puede usarlo.',
            'El portal es para empleados y colaboradores de AMBIENTALIA. La cuenta solo queda activa después de que un administrador la aprueba.',
          ),
          arranque(
            '1.2 Cuenta.',
            'La cuenta es personal e intransferible. La contraseña no se comparte con nadie. Si otra persona la conoce o el usuario sospecha un acceso indebido, debe avisar de inmediato a un administrador. AMBIENTALIA puede desactivar la cuenta en cualquier momento, y lo hará cuando termine el vínculo con la compañía.',
          ),
          arranque(
            '1.3 Uso aceptable.',
            'El portal se usa solo para el trabajo. No está permitido sacar información fuera de la compañía, intentar entrar a aplicaciones que no han sido asignadas ni automatizar accesos. El incumplimiento puede llevar a la desactivación de la cuenta y a las medidas previstas en el Reglamento Interno de Trabajo.',
          ),
          arranque(
            '1.4 Confidencialidad.',
            'El portal muestra información de clientes, contabilidad e inventario. Esa información es confidencial: no se divulga ni se comparte con terceros, durante el vínculo con la compañía ni después de terminado.',
          ),
          arranque(
            '1.5 Registro de actividad.',
            'Por seguridad y auditoría, el portal registra las acciones de administración y los errores técnicos. Los errores se registran con el servicio Sentry.',
          ),
          arranque(
            '1.6 Disponibilidad.',
            'AMBIENTALIA no garantiza un servicio continuo. El portal puede tener interrupciones por mantenimiento o por fallas.',
          ),
          arranque(
            '1.7 Cambios.',
            'Estas condiciones y la política de tratamiento de datos llevan número de versión y fecha. Cuando cambien, el portal lo avisará a los usuarios.',
          ),
        ],
      },
    ],
  },
  {
    titulo: '2. Política de tratamiento de datos personales',
    apartados: [
      {
        bloques: [
          parrafo(
            'AMBIENTALIA trata los datos personales de los usuarios del portal conforme a la Ley 1581 de 2012 y al Decreto 1377 de 2013, compilado en el Decreto 1074 de 2015.',
          ),
        ],
      },
      {
        titulo: '2.1 Responsable del tratamiento',
        bloques: [
          tabla(
            ['Dato', 'Información'],
            ['Razón social', 'AMBIENTALIA S.A.S.'],
            ['NIT', '900.700.933-5'],
            ['Domicilio', 'Calle 86 # 24-27, Bogotá D.C., Colombia'],
            ['Canal de contacto', CORREO_CONTACTO],
          ),
        ],
      },
      {
        titulo: '2.2 Datos que se tratan',
        bloques: [
          tabla(
            ['Dato', 'Detalle'],
            ['Nombre, correo y rol', 'Los registra el usuario al crear la cuenta; el rol lo asigna un administrador'],
            ['Contraseña', 'Se guarda solo como huella cifrada; nadie en la compañía puede conocerla'],
            ['Foto de perfil', 'Opcional; solo si el usuario decide subirla'],
            ['Ausencias', 'Fechas, tipo de ausencia y soportes que el usuario carga en la aplicación Ausencias'],
          ),
          parrafo(
            'El portal registra además las acciones de administración y los errores técnicos, que pueden quedar asociados al usuario que los originó.',
          ),
        ],
      },
      {
        titulo: '2.3 Finalidad',
        bloques: [
          parrafo('Los datos se usan únicamente para:'),
          lista(
            'Gestionar el acceso al portal: crear, aprobar, administrar y desactivar cuentas.',
            'Operar las aplicaciones internas, incluida la gestión de ausencias.',
            'Enviar los correos de acceso y de recuperación de contraseña.',
            'Mantener la seguridad del portal y permitir su auditoría.',
          ),
          parrafo(
            'AMBIENTALIA no usa estos datos con fines comerciales ni los entrega a terceros para fines propios de estos.',
          ),
        ],
      },
      {
        titulo: '2.4 Autorización y datos sensibles',
        bloques: [
          parrafo(
            'El tratamiento se basa en la autorización previa, expresa e informada del usuario, que la otorga al aceptar esta política al crear su cuenta o, si ya la tenía, en su siguiente ingreso al portal. Cuando la política cambie de versión, el portal pedirá aceptarla de nuevo. El portal guarda constancia de cada aceptación, con fecha y versión.',
          ),
          parrafo(
            'Los soportes de incapacidad que se cargan en Ausencias contienen datos de salud, que la ley considera sensibles. Para ellos:',
          ),
          lista(
            'El usuario no está obligado a autorizar el tratamiento de datos sensibles.',
            'Solo se usan para tramitar y soportar la ausencia.',
            'Solo los ven el usuario, quienes aprueban su solicitud, las personas que AMBIENTALIA autoriza expresamente para tramitar ausencias y los administradores del portal.',
          ),
        ],
      },
      {
        titulo: '2.5 Terceros que procesan datos',
        bloques: [
          parrafo(
            'Estos proveedores procesan datos por cuenta de AMBIENTALIA, solo para las finalidades de esta política:',
          ),
          tabla(
            ['Proveedor', 'Servicio', 'Datos'],
            ['Hostinger', 'Alojamiento del portal y de su base de datos', 'Todos los datos del portal'],
            [
              'Google (Gmail), mediante n8n',
              'Envío de los correos de acceso y de recuperación de contraseña',
              'Nombre y correo',
            ],
            ['Sentry', 'Registro de errores técnicos', 'Datos técnicos del error, que pueden incluir el usuario afectado'],
          ),
          parrafo(
            'Algunos de estos proveedores tienen servidores fuera de Colombia, por lo que los datos pueden almacenarse o procesarse en otros países. Al aceptar esta política, el usuario autoriza esa transmisión.',
          ),
        ],
      },
      {
        titulo: '2.6 Derechos del titular',
        bloques: [
          parrafo('El usuario puede, sin costo:'),
          lista(
            'Conocer, actualizar y rectificar sus datos.',
            'Solicitar la supresión de sus datos.',
            'Revocar la autorización.',
            'Solicitar prueba de la autorización y ser informado del uso que se ha dado a sus datos.',
            'Presentar una queja ante la Superintendencia de Industria y Comercio, después de haber tramitado la consulta o el reclamo ante AMBIENTALIA.',
          ),
          parrafo(
            'La supresión y la revocatoria no proceden mientras exista un deber legal o contractual de conservar los datos.',
          ),
        ],
      },
      {
        titulo: '2.7 Procedimiento para ejercer los derechos',
        bloques: [
          parrafo(
            `Las solicitudes se envían a ${CORREO_CONTACTO} con el asunto “Datos personales”, indicando nombre, identificación y lo que se solicita.`,
          ),
          tabla(
            ['Trámite', 'Para qué sirve', 'Plazo de respuesta'],
            [
              'Consulta',
              'Conocer los datos que tiene el portal y cómo se usan',
              '10 días hábiles desde el recibo, prorrogables hasta por 5 más',
            ],
            [
              'Reclamo',
              'Corregir, actualizar o suprimir datos, revocar la autorización o advertir un incumplimiento',
              '15 días hábiles desde el día siguiente al recibo, prorrogables hasta por 8 más',
            ],
          ),
          parrafo(
            'Si AMBIENTALIA necesita la prórroga, informará antes del vencimiento el motivo y la nueva fecha. Si un reclamo llega incompleto, pedirá completarlo dentro de los 5 días hábiles siguientes al recibo.',
          ),
        ],
      },
      {
        titulo: '2.8 Vigencia y conservación',
        bloques: [
          parrafo(`Esta política rige desde el ${TERMS_EFFECTIVE_DATE}. Los datos se conservan así:`),
          tabla(
            ['Dato', 'Conservación'],
            [
              'Cuenta: nombre, correo, rol y huella de la contraseña',
              'Mientras dure el vínculo con la compañía; después la cuenta se desactiva y se elimina a los 3 años',
            ],
            ['Foto de perfil', 'Hasta que el usuario la retire o se desactive la cuenta'],
            ['Ausencias y sus soportes', '3 años después de terminado el vínculo con la compañía'],
            ['Registros de administración y de errores', '3 años desde que se generan'],
          ),
          parrafo(
            'Vencidos estos plazos, los datos se eliminan, salvo que una norma obligue a conservarlos por más tiempo.',
          ),
        ],
      },
    ],
  },
];

/**
 * La casilla del registro y de la pantalla de aceptación, en trozos: en el
 * registro, `enlace` es el que abre /terminos.
 */
export const CASILLA = {
  antes: 'Acepto las ',
  enlace: 'condiciones de uso',
  despues: ' y autorizo el tratamiento de mis datos personales según la política de AMBIENTALIA S.A.S.',
};

/** La casilla entera, en una sola frase (la pantalla de aceptación la pinta así). */
export const TEXTO_CASILLA = `${CASILLA.antes}${CASILLA.enlace}${CASILLA.despues}`;
