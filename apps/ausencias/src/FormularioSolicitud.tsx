import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Paperclip, Send } from 'lucide-react';
import {
  crearSolicitud,
  leerComoBase64,
  type SaldoCompensatorios,
  type SaldoVacaciones,
  type Solicitud,
  type TipoSolicitud,
} from './api';
import {
  contarDiasHabiles,
  esDeUnSoloDia,
  esOtorgamiento,
  etiquetasFecha,
  hoyEnColombia,
  limiteDeLaIncapacidad,
  limiteDelTrabajo,
  pedible,
  requiereAprobacion,
  TIPOS,
} from './dominio';
import TarjetaSaldo from './TarjetaSaldo';
import TarjetaCompensatorios from './TarjetaCompensatorios';

/** Mismo tope que el servidor (MAX_ADJUNTO_BYTES). Se avisa antes de subir. */
const MAX_PDF_BYTES = 8 * 1024 * 1024;

interface Props {
  festivos: Set<string>;
  /**
   * Cómo nombrar a quien aprueba: su nombre si tiene ficha, y si no su correo.
   * Se resuelve en App a partir del contexto — aquí solo se pinta, para que el
   * componente no tenga que saber cuándo hay nombre y cuándo no.
   */
  aprobador: string;
  /** Null si el usuario no tiene ficha de empleado, o si el cálculo del saldo falló. */
  saldo: SaldoVacaciones | null;
  /** Opcional: puede faltar si hub-api todavía no manda la clave. Ver `api.ts`. */
  compensatorios?: SaldoCompensatorios | null;
  /**
   * Un admin puede pedir vacaciones por encima de su saldo y quedarse en
   * negativo; el resto, no. Aquí solo apaga o no el botón — quien de verdad lo
   * impide es la puerta del servidor, que lee el rol del token y no esto.
   */
  esAdmin: boolean;
  onCreada: (s: Solicitud) => void;
}

const CAMPO = 'w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none';

/**
 * Cuántas horas puede durar un permiso.
 *
 * Horas ENTERAS. La media hora sigue siendo alcanzable por el otro lado —el
 * «desde» va de :00 en :30—, así que un permiso de 10:30 a 12:30 se pide igual;
 * lo que ya no se puede es pedir media hora suelta.
 *
 * Se corta en 8 —una jornada— a propósito: un permiso más largo que eso ya es el
 * día entero, y el día entero se pide dejando el horario en blanco. Es una lista
 * y no un campo numérico libre porque un desplegable de ocho opciones se rellena
 * de un toque, también en el móvil.
 */
const HORAS_POSIBLES = ['1', '2', '3', '4', '5', '6', '7', '8'];

/** «1 hora», «2 horas». */
const etiquetaHoras = (h: string): string => `${h} ${h === '1' ? 'hora' : 'horas'}`;

/**
 * La hora a la que acaba el permiso, o `null` si no hay franja que calcular.
 *
 * El servidor sigue guardando principio y fin —un evento de Google necesita los
 * dos, y el CHECK de la migración 036 exige `hora_fin > hora_inicio`—, así que
 * esto es solo la resta que el formulario le ahorra a quien pide.
 *
 * ⚠️ Devuelve `null` cuando la suma llega o pasa la medianoche, y NO la recorta a
 * las 23:59. Un permiso que cruza el día no cabe en este modelo: las dos horas
 * viven en la MISMA fecha, así que un fin «anterior» al inicio rebotaría contra
 * el CHECK con un 500 desde dentro de una transacción. Recortarlo en silencio
 * sería peor todavía — guardaría algo distinto de lo que la persona pidió.
 */
function finDelPermiso(desde: string, horas: string): string | null {
  if (desde === '' || horas === '') return null;
  const [h, m] = desde.split(':').map(Number);
  const total = h * 60 + m + Math.round(Number(horas) * 60);
  if (!Number.isFinite(total) || total >= 24 * 60) return null;
  const dosDigitos = (n: number) => String(n).padStart(2, '0');
  return `${dosDigitos(Math.floor(total / 60))}:${dosDigitos(total % 60)}`;
}

export default function FormularioSolicitud({
  festivos,
  aprobador,
  saldo,
  compensatorios,
  esAdmin,
  onCreada,
}: Props) {
  const [tipo, setTipo] = useState<TipoSolicitud>('vacaciones');
  const [fechaInicio, setFechaInicio] = useState('');
  const [fechaFin, setFechaFin] = useState('');
  const [comentarios, setComentarios] = useState('');
  /** Los días que se piden conceder. Solo lo usa el otorgamiento. */
  const [diasTexto, setDiasTexto] = useState('');
  const [archivo, setArchivo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  /** A qué hora empieza el permiso, `HH:MM`. Vacía = día completo. */
  const [horaInicio, setHoraInicio] = useState('');
  // Cuántas horas dura, no a qué hora acaba: es la forma en que la gente piensa
  // un permiso («me voy dos horas»), y ahorra la resta mental. El servidor sigue
  // recibiendo un principio y un FIN —un evento de calendario necesita los dos—,
  // así que el final se deriva aquí abajo en `horaFin`.
  const [horas, setHoras] = useState('');
  const inputArchivo = useRef<HTMLInputElement>(null);

  const pideOtorgamiento = esOtorgamiento(tipo);
  // Texto y no número, por lo mismo que en el panel de saldos: convertirlo aquí
  // haría que un «abc» viajara como NaN → `null` en JSON, y el servidor leería
  // «sin días» en vez de «esto no es un número». La validación de forma vive
  // entera en el backend, que es quien redacta el error.
  const diasConcedidos = Number(diasTexto.trim().replace(',', '.'));
  const diasConcedidosValidos = /^\d{1,2}([.,]\d)?$/.test(diasTexto.trim()) && diasConcedidos > 0;

  const etiquetas = etiquetasFecha(tipo);

  /**
   * Un permiso y un otorgamiento ocupan UN día, así que no tienen segunda
   * casilla y su fecha de fin es la de inicio.
   *
   * Derivada y no un `setFechaFin` colgado del `onChange` de la primera: así no
   * hay un estado que pueda quedarse desincronizado si alguien cambia de tipo
   * con las fechas ya puestas. Y el `fechaFin` de verdad se conserva intacto
   * mientras tanto, de modo que volver a vacaciones recupera el rango que se
   * había tecleado — el mismo criterio que las horas.
   */
  const unSoloDia = esDeUnSoloDia(tipo);
  const fechaFinEfectiva = unSoloDia ? fechaInicio : fechaFin;

  const dias = useMemo(
    () => contarDiasHabiles(fechaInicio, fechaFinEfectiva, festivos),
    [fechaInicio, fechaFinEfectiva, festivos],
  );
  const adjuntoObligatorio = tipo === 'incapacidad';
  const aceptaAdjunto = tipo === 'incapacidad' || tipo === 'permiso';

  // Sobre la fecha EFECTIVA: en los de un solo día las dos son la misma, así que
  // este aviso no puede saltar ahí — y es correcto que no salte, porque no hay
  // ninguna segunda casilla que el usuario pueda poner del revés.
  const rangoInvertido = Boolean(fechaInicio && fechaFinEfectiva && fechaInicio > fechaFinEfectiva);
  const faltaAdjunto = adjuntoObligatorio && !archivo;

  // La franja solo cabe en un permiso, que desde el 2026-08-25 es siempre de un
  // solo día. Ya no hace falta comparar las dos fechas: `esDeUnSoloDia` garantiza
  // que coinciden, y comprobarlo aquí sería repetir esa regla en un segundo
  // sitio que puede desviarse.
  //
  // El `fechaInicio !== ''` sí sigue haciendo falta: al abrir el formulario está
  // vacía, y sin él la franja aparecería sobre un permiso que todavía no tiene
  // ningún día elegido.
  const admiteHora = tipo === 'permiso' && fechaInicio !== '';

  // La hora a la que acaba, derivada. `null` significa «esta solicitud no lleva
  // franja», y engloba los tres casos en que no la lleva: falta el «desde»,
  // faltan las horas, o la suma se pasa de medianoche.
  const horaFin = finDelPermiso(horaInicio, horas);

  // Los TRES motivos por los que una franja a medio poner apaga el botón. Van
  // guardados por `admiteHora` en `horaMalPuesta`: si la franja ni siquiera se
  // está pintando —porque cambiaron el tipo—, unas horas tecleadas antes no
  // pueden bloquear el envío de algo que ya no las lleva.
  //
  // Ya NO hace falta comprobar que el fin sea posterior al inicio: con una
  // duración siempre positiva, eso no se puede dar. Es la mitad del motivo por el
  // que este campo dejó de ser una hora.
  const mediaPareja = (horaInicio !== '') !== (horas !== '');
  const seSaleDelDia = horaInicio !== '' && horas !== '' && horaFin === null;
  // ⚠️ El navegador NO recorta a la rejilla del `step`: se queda con el 10:15
  // tecleado a mano y marca el campo `:invalid` por `stepMismatch`. Y como este
  // formulario no lleva `noValidate`, la validación nativa aborta el submit
  // ANTES de llegar al `onSubmit` — o sea, botón con pinta de activo, la
  // pantalla diciendo «Termina a las 12:15», y al pulsar no pasa nada, ni con el
  // ratón ni con Enter, salvo un globo del navegador en su propio idioma.
  // Comprobado en Chrome con teclado real.
  //
  // Se detecta aquí para apagar el botón CON SU MOTIVO al lado, que es lo que
  // hace el resto del formulario. Recortarlo en silencio sería el otro camino, y
  // se descarta por lo mismo que en `finDelPermiso`: cambiaría lo que la persona
  // escribió.
  //
  // Anclada por los dos extremos, y no solo por el final: sin el `^` se colarían
  // un `10:15:00` y un `9:30`, que además el servidor rechazaría con
  // `hora_invalida`. Escrita en positivo —lo que se ACEPTA— espeja el `HORA` de
  // `service.ts`, que es la otra mitad de esta misma regla.
  const EN_REJILLA = /^([01]\d|2[0-3]):(00|30)$/;
  const horaFueraDeRejilla = horaInicio !== '' && !EN_REJILLA.test(horaInicio);

  // Y por lo mismo NO se borran con un efecto al dejar de caber: basta con que
  // solo viajen cuando caben. Así no hay estado que pueda quedarse caducado, y
  // si el usuario vuelve a poner un solo día recupera lo que había tecleado.
  //
  // ⚠️ El `!horaFueraDeRejilla` no sobra, aunque `horaFin` sí se pueda calcular
  // con un 10:15: sin él, `conHoras` diría «esta solicitud lleva franja» sobre
  // una hora que la propia pantalla está rechazando en rojo. Las dos
  // consecuencias eran reales — la nota de abajo contradecía al aviso, y el
  // cuerpo de la petición se habría llevado el `10:15`, protegido solo por el
  // `if (!puedeEnviar) return` que vive treinta líneas más abajo. Esta constante
  // tiene que significar exactamente «estas horas viajan», o no significa nada.
  const conHoras = admiteHora && horaFin !== null && !horaFueraDeRejilla;

  // Se nombra en negativo porque `puedeEnviar` es afirmativo y esto entra ahí
  // como `&& !horaMalPuesta`.
  const horaMalPuesta = admiteHora && (mediaPareja || seSaleDelDia || horaFueraDeRejilla);

  // Lo que requiere aprobación no puede empezar en el pasado. La incapacidad sí:
  // se informa después de haber estado enfermo, así que `minFecha` le queda
  // `undefined`.
  //
  // ⚠️ Eso NO significa ya que su calendario abra entero: desde el 2026-08-21
  // tiene ventana propia, y quien la acota es `minInicio`/`maxInicio` unas
  // líneas más abajo. `minFecha` sigue existiendo aparte porque de él cuelga
  // `fechaEnPasado`, que pinta un párrafo rojo que a una baja no le aplica.
  //
  // El `min` del input es solo la barrera cómoda —se puede teclear por encima, y
  // algunos navegadores lo permiten—, por eso se comprueba también aquí y, sobre
  // todo, en el servidor: `validarNuevaSolicitud` responde `fecha_en_pasado`.
  //
  // ⚠️ El otorgamiento queda fuera, y no basta con quitarle el `min` del input:
  // este booleano pinta un párrafo rojo diciendo «no puedes pedir días que ya
  // pasaron» debajo del campo. Sobre un compensatorio eso es exactamente al
  // revés —su fecha SIEMPRE está en el pasado, porque se pide después de haber
  // trabajado— y el mensaje salía aunque el botón sí dejara enviar. Su ventana
  // es otra: de hoy hacia atrás, tres meses.
  const hoyCol = hoyEnColombia();
  const minFecha = requiereAprobacion(tipo) && !pideOtorgamiento ? hoyCol : undefined;

  // La incapacidad tiene ventana propia: dos días hacia atrás y nada hacia
  // adelante. Va aparte de `minFecha` porque aquella nace de «no se piden días
  // pasados», que es justo la regla de la que la incapacidad está exenta — y
  // mezclarlas dejaría el booleano `fechaEnPasado` de abajo pintando el párrafo
  // rojo equivocado, el de «no puedes pedir días que ya pasaron», a alguien que
  // lo que está haciendo es informar una baja.
  //
  // El `max` solo acota la fecha de INICIO: el médico firma hoy una baja que
  // cubre los próximos días, y esa sí tiene el fin en el futuro.
  const esIncapacidad = tipo === 'incapacidad';
  const minInicio = esIncapacidad ? limiteDeLaIncapacidad(hoyCol) : minFecha;
  const maxInicio = esIncapacidad ? hoyCol : undefined;
  const fechaEnPasado = Boolean(minFecha && fechaInicio && fechaInicio < minFecha);

  // El servidor rechaza el compensatorio que no cabe en la bolsa, así que aquí se
  // apaga el botón: dejar pulsar para recibir un 409 es hacer perder el viaje.
  //
  // `configurado === true` y no truthy: contra un hub-api que todavía no manda la
  // clave, `compensatorios` llega `undefined` y esto NO debe activarse — dejaría
  // el botón muerto mientras el servidor aceptaría la solicitud sin problema.
  // Mismo criterio que el `!== false` de `esMiTurno`.
  //
  // El cliente es la cortesía; la regla vive en el servidor. Por eso solo se
  // bloquea el caso que se puede calcular con certeza: sin bolsa configurada el
  // botón sigue activo y el 409 explica qué hacer, que es hablar con
  // administración — un botón apagado sin más no lo diría.
  const excedeCompensatorios =
    tipo === 'compensatorio' &&
    compensatorios?.configurado === true &&
    dias > 0 &&
    dias > pedible(compensatorios);

  // Lo mismo para las vacaciones, con las MISMAS tres cautelas que el de arriba
  // —`configurado === true` y no truthy, `dias > 0`, y `pedible` en vez del
  // firme— y una cuarta propia: un ADMIN queda exento y su botón no se apaga
  // nunca por esto.
  //
  // Sin saldo configurado tampoco se bloquea, y aquí no es solo prudencia del
  // cliente: es que el SERVIDOR tampoco bloquea ese caso. Un corte sin sembrar
  // significa «administración no lo ha puesto todavía», no «tienes cero», y
  // apagar el botón dejaría a esa persona sin vacaciones y sin nada que hacer al
  // respecto. Las dos mitades tienen que decir lo mismo o el botón mentiría.
  //
  // `TarjetaSaldo` ya avisa por su cuenta cuando se pasa —«te faltan X días»— y
  // lo sigue haciendo también para un admin: la advertencia es cierta para él,
  // lo único que cambia es que puede seguir adelante.
  //
  // La exención se nombra UNA vez y de ahí salen las dos mitades —el botón de
  // aquí abajo y la última frase de la tarjeta—, porque son la misma regla vista
  // desde dos sitios. Tenerla escrita dos veces es exactamente cómo se
  // desviaron: la tarjeta siguió diciendo «puedes enviarla igualmente» a todo el
  // mundo cuando el `!esAdmin` de esta línea empezó a apagarle el botón a casi
  // todo el mundo. Un `esAdmin` suelto en el JSX volvería a poder desviarse; el
  // nombre compartido, no.
  const sobregiroPermitido = esAdmin;
  const excedeVacaciones =
    tipo === 'vacaciones' &&
    !sobregiroPermitido &&
    saldo?.configurado === true &&
    dias > 0 &&
    dias > pedible(saldo);

  // Un otorgamiento tiene otros requisitos: no hay fecha fin que rellenar, pero
  // sí una cantidad y un motivo, los dos obligatorios. Lo que no se comprueba
  // aquí es el tope de 30 días ni la ventana de tres meses: esas las redacta el
  // servidor con su mensaje, y duplicarlas aquí sería tener la regla dos veces.
  const puedeEnviar = pideOtorgamiento
    ? Boolean(fechaInicio) && diasConcedidosValidos && Boolean(comentarios.trim()) && !enviando
    : // La EFECTIVA: en un permiso no hay segunda casilla que rellenar, así que
      // exigir el `fechaFin` de verdad dejaría el botón apagado para siempre.
      Boolean(fechaInicio && fechaFinEfectiva) &&
      !rangoInvertido &&
      !fechaEnPasado &&
      !faltaAdjunto &&
      !excedeCompensatorios &&
      !excedeVacaciones &&
      // Solo en esta rama: `horaMalPuesta` cuelga de `admiteHora`, que exige
      // `tipo === 'permiso'`, y un permiso nunca entra por la del otorgamiento.
      !horaMalPuesta &&
      !enviando;

  function cambiarTipo(nuevo: TipoSolicitud) {
    setTipo(nuevo);
    // El adjunto se descarta al cambiar de tipo: un PDF elegido para una
    // incapacidad no debe viajar sin querer en una solicitud de vacaciones.
    if (nuevo !== 'incapacidad' && nuevo !== 'permiso') limpiarArchivo();
  }

  function limpiarArchivo() {
    setArchivo(null);
    if (inputArchivo.current) inputArchivo.current.value = '';
  }

  function elegirArchivo(f: File | null) {
    setError(null);
    if (!f) return void limpiarArchivo();
    if (f.type !== 'application/pdf') {
      setError('El soporte debe ser un archivo PDF.');
      return void limpiarArchivo();
    }
    if (f.size > MAX_PDF_BYTES) {
      setError(`El archivo pesa ${(f.size / 1024 / 1024).toFixed(1)} MB y el máximo son 8 MB.`);
      return void limpiarArchivo();
    }
    setArchivo(f);
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!puedeEnviar) return;
    setEnviando(true);
    setError(null);
    setExito(null);
    try {
      const creada = await crearSolicitud({
        tipo,
        fechaInicio,
        // La efectiva, que resuelve de una vez el otorgamiento y el permiso: los
        // dos son de UN día y ninguno tiene segunda casilla. Se manda explícita
        // y no se deja vacía porque `fechaFin` no es opcional en el contrato.
        fechaFin: fechaFinEfectiva,
        comentarios: comentarios.trim() || undefined,
        dias: pideOtorgamiento ? diasConcedidos : undefined,
        adjunto: archivo
          ? { nombreArchivo: archivo.name, mime: archivo.type, contenidoBase64: await leerComoBase64(archivo) }
          : undefined,
        // Solo cuando la pareja está completa Y cabe: `conHoras` cuelga de
        // `admiteHora`, así que unas horas tecleadas para un permiso y luego
        // abandonadas —cambiando el tipo a otra cosa— no viajan en el cuerpo, que
        // es justo lo que el servidor devolvería como `hora_no_permitida`.
        //
        // El alias basta para que TypeScript estreche `horaFin` a `string` aquí
        // dentro: siendo los dos `const`, el análisis de flujo atraviesa una
        // condición con nombre desde TS 4.4. Repetir la condición a mano dejaría
        // dos sitios que mantener sincronizados, que es justo lo que documenta
        // `sobregiroPermitido` más arriba que no se debe hacer.
        ...(conHoras ? { horaInicio, horaFin } : {}),
      });
      setExito(
        pideOtorgamiento
          ? `Petición enviada. ${aprobador} decidirá si te concede esos días; si los aprueba entrarán en tu bolsa de compensatorios.`
          : requiereAprobacion(tipo)
            ? `Solicitud enviada. ${aprobador} recibirá el aviso para aprobarla y te llegará un correo con el resultado.`
            : 'Incapacidad registrada. Te hemos enviado el acuse por correo.',
      );
      setFechaInicio('');
      setFechaFin('');
      setComentarios('');
      setDiasTexto('');
      // También las horas, por lo mismo que el adjunto: el formulario queda
      // listo para otra solicitud, y una franja superviviente volvería a viajar
      // sola en cuanto la siguiente fuera otro permiso de un solo día.
      setHoraInicio('');
      setHoras('');
      limpiarArchivo();
      onCreada(creada);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="max-w-2xl">
      <fieldset className="mb-5">
        <legend className="mb-2 text-sm font-medium text-gray-700">Tipo de solicitud</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {TIPOS.map((t) => (
            <label
              key={t.id}
              className={`flex cursor-pointer flex-col gap-1 rounded-xl border p-3 transition-colors ${
                tipo === t.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-medium text-gray-900">
                <input
                  type="radio"
                  name="tipo"
                  value={t.id}
                  checked={tipo === t.id}
                  onChange={() => cambiarTipo(t.id)}
                  className="accent-blue-600"
                />
                {t.label}
              </span>
              <span className="pl-6 text-xs text-gray-500">{t.ayuda}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* Un otorgamiento pide otra cosa: UN día trabajado y una cantidad. No es
          un rango, así que el segundo campo de fecha no se oculta con CSS — no
          existe, para que no pueda mandarse por accidente. Y la fecha va sin
          `min`: se pide DESPUÉS de haber trabajado, siempre en el pasado. */}
      {pideOtorgamiento ? (
        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="fechaInicio" className="mb-1 block text-sm font-medium text-gray-700">
              Día que trabajaste
            </label>
            {/* La ventana entera va en el propio calendario: de hoy hacia atrás,
                tres meses. Así el selector no deja ni elegir un día fuera de
                plazo, en vez de aceptarlo y devolver un error después.

                Los dos límites se repiten en el servidor a propósito: el `min` y
                el `max` de un input se saltan tecleando la fecha a mano. */}
            <input
              id="fechaInicio"
              type="date"
              required
              value={fechaInicio}
              min={limiteDelTrabajo(hoyCol)}
              max={hoyCol}
              onChange={(e) => setFechaInicio(e.target.value)}
              className={CAMPO}
            />
            <p className="mt-1 text-xs text-gray-500">Hasta tres meses hacia atrás.</p>
          </div>
          <div>
            <label htmlFor="diasConcedidos" className="mb-1 block text-sm font-medium text-gray-700">
              Días que pides
            </label>
            {/* type="text" y no "number", como el panel de saldos: hace falta
                para admitir la coma decimal, que un `type="number"` rechaza en
                casi todos los locales del navegador. */}
            <input
              id="diasConcedidos"
              type="text"
              inputMode="decimal"
              required
              value={diasTexto}
              onChange={(e) => setDiasTexto(e.target.value)}
              placeholder="1"
              className={CAMPO}
            />
          </div>
        </div>
      ) : (
        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="fechaInicio" className="mb-1 block text-sm font-medium text-gray-700">
              {etiquetas.inicio}
            </label>
            <input
              id="fechaInicio"
              type="date"
              required
              value={fechaInicio}
              min={minInicio}
              max={maxInicio}
              onChange={(e) => setFechaInicio(e.target.value)}
              className={CAMPO}
            />
          </div>
          {/* En un permiso no se pinta: ocupa un solo día y su fecha de fin es la
              de inicio. Se esconde el campo entero y no solo la etiqueta, porque
              un `<input required>` invisible bloquearía el envío desde la
              validación nativa sin que la app pudiera decir por qué — el mismo
              callejón sin salida que abría el `step` del horario. */}
          {!unSoloDia && (
            <div>
              <label htmlFor="fechaFin" className="mb-1 block text-sm font-medium text-gray-700">
                {etiquetas.fin}
              </label>
              <input
                id="fechaFin"
                type="date"
                required
                value={fechaFin}
                min={fechaInicio || minInicio}
                onChange={(e) => setFechaFin(e.target.value)}
                className={CAMPO}
              />
            </div>
          )}
        </div>
      )}

      {/* La franja horaria del permiso de un solo día. Fuera de la rama del
          otorgamiento a propósito: `admiteHora` ya exige `tipo === 'permiso'`,
          así que anidarlo ahí dentro solo lo escondería dos veces. */}
      {admiteHora && (
        <div className="mb-4">
          {/* El «(opcional)» va en la frase y no colgando de una etiqueta: la
              regla es que los dos campos van juntos o ninguno, así que ponerlo
              sobre uno solo dejaría al otro con pinta de obligatorio. */}
          <p className="mb-2 text-xs text-gray-500">
            <b className="font-medium">Opcional.</b> Si el permiso es de unas horas y no del día entero, dilo aquí: así
            se ve en el calendario del equipo.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              {/* Etiqueta visible, no solo `aria-label`: en móvil el grid es de
                  una columna y los dos campos se apilan sin nada que diga cuál
                  es cuál. */}
              <label htmlFor="horaInicio" className="mb-1 block text-sm font-medium text-gray-700">
                Horario desde
              </label>
              {/* `step` de media hora: es la granularidad con la que se piden
                  estos permisos, y hace que el selector salte de :00 a :30 en
                  vez de minuto a minuto.
                  ⚠️ 1800 es múltiplo de 60, así que el `value` sigue saliendo
                  como `HH:MM`. Un `step` POR DEBAJO de 60 lo convertiría en
                  `HH:MM:SS` y el alta se caería con `hora_invalida` sin que nada
                  de aquí lo delatara. */}
              <input
                id="horaInicio"
                type="time"
                step={1800}
                value={horaInicio}
                onChange={(e) => setHoraInicio(e.target.value)}
                className={CAMPO}
              />
            </div>
            <div>
              <label htmlFor="horas" className="mb-1 block text-sm font-medium text-gray-700">
                Número de horas
              </label>
              <select id="horas" value={horas} onChange={(e) => setHoras(e.target.value)} className={CAMPO}>
                {/* «Día completo» y no un guion: es la respuesta a la pregunta
                    que se hace quien abre el desplegable, y es además el único
                    sitio de la pantalla donde se dice cómo se pide el día
                    entero —dejando el horario en blanco—. */}
                <option value="">Día completo</option>
                {HORAS_POSIBLES.map((h) => (
                  <option key={h} value={h}>
                    {etiquetaHoras(h)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {/* El final, de vuelta: se pidió la duración para no hacer restar a
              nadie, pero quien lo lee necesita ver en qué acaba lo que ha
              elegido. Derivado, no un campo más. */}
          {/* `conHoras` y no `horaFin !== null`: con un 10:15 tecleado a mano la
              cuenta sale igual, y enseñar «Termina a las 12:15» junto al aviso de
              que esa hora no vale sería darle la razón a lo que se está
              rechazando. Ese matiz vive ya dentro de `conHoras`, que es donde
              tiene que vivir. */}
          {conHoras && (
            <p className="mt-1 text-sm text-gray-600">
              Termina a las <b className="tabular-nums">{horaFin}</b>.
            </p>
          )}
          {horaFueraDeRejilla && (
            <p className="mt-1 text-sm text-red-600">
              El horario va de media en media hora: pon los minutos en <b>:00</b> o en <b>:30</b>.
            </p>
          )}
          {seSaleDelDia && (
            <p className="mt-1 text-sm text-red-600">
              Esas horas no caben antes de medianoche. Empieza antes, o pide menos horas.
            </p>
          )}
          {/* Sin nombrar los campos: la etiqueta dice «Horario desde» y llamarlo
              aquí «la hora de inicio» sería darle dos nombres al mismo campo en
              la misma pantalla. Solo hay dos, así que «los dos» no es ambiguo. */}
          {mediaPareja && (
            <p className="mt-1 text-sm text-amber-700">Rellena los dos campos, o deja los dos en blanco.</p>
          )}
        </div>
      )}

      {rangoInvertido && (
        <p className="mb-4 text-sm text-red-600">La fecha final no puede ser anterior a la inicial.</p>
      )}

      {/* Se explica el porqué, no solo el «no puedes»: quien llega aquí suele
          estar regularizando algo ya disfrutado, y necesita saber a quién acudir. */}
      {fechaEnPasado && (
        <p className="mb-4 text-sm text-red-600">
          No puedes pedir días que ya pasaron: la aprobación llegaría cuando ya no sirve de nada. Si necesitas
          registrar algo del pasado, pídeselo a administración.
        </p>
      )}

      {/* Cada tipo enseña SU bolsa, y solo los dos que consumen alguna: permisos
          e incapacidades no tocan ninguna.

          En vacaciones va con `soloSiAvisa`, así que la tarjeta se calla mientras
          no tenga nada que añadir al indicador de la cabecera, que está a un
          palmo de aquí: aparece para decir que falta configurar el saldo, o que
          los días que se están pidiendo no caben. El contenedor lleva
          `empty:hidden` porque, cuando la tarjeta se calla, su `mb-4` dejaría un
          hueco de 16px sin nada dentro. */}
      {tipo === 'vacaciones' && saldo && (
        <div className="mb-4 empty:hidden">
          <TarjetaSaldo
            saldo={saldo}
            diasPedidos={rangoInvertido ? 0 : dias}
            cierre={sobregiroPermitido ? 'puede_sobregirarse' : 'no_puede_sobregirarse'}
            soloSiAvisa
          />
        </div>
      )}

      {/* En compensatorios va SIN `soloSiAvisa`, y es deliberado: de dónde salen
          esos días —cuántos se otorgaron, desde cuándo y cuántos se han gastado—
          no aparece en ninguna otra parte de la app, así que callarlo dejaría al
          empleado sin forma de cuadrar su propia bolsa. En vacaciones el desglose
          se puede callar porque el número grande ya está en la cabecera y la
          fórmula es conocida; aquí no. */}
      {tipo === 'compensatorio' && compensatorios && (
        <div className="mb-4">
          <TarjetaCompensatorios saldo={compensatorios} diasPedidos={rangoInvertido ? 0 : dias} />
        </div>
      )}

      {/* La bolsa a la que van a parar los días, para que quien pide vea el
          antes y el después. Sin `diasPedidos`: aquí no se gasta nada, se suma,
          y la tarjeta pintaría en rojo «te faltan N» sobre una petición que hace
          justo lo contrario. */}
      {pideOtorgamiento && compensatorios && (
        <div className="mb-4">
          <TarjetaCompensatorios saldo={compensatorios} titulo="Tu bolsa ahora mismo" />
        </div>
      )}

      {/* El contador en vivo evita la sorpresa de pedir «una semana» y que el
          aprobador vea 4 días porque había un festivo en medio. No aplica a un
          otorgamiento: sus días se teclean, no se cuentan — y el día por el que
          se gana suele ser justo uno que NO es hábil. */}
      {!pideOtorgamiento && dias > 0 && !rangoInvertido && (
        <p className="mb-4 rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-700">
          Son <b className="tabular-nums">{dias}</b> {dias === 1 ? 'día hábil' : 'días hábiles'}, descontando fines de
          semana y festivos de Colombia.
          {/* En todo permiso que llegue hasta aquí, y no solo en los que llevan
              franja: la frase habla del permiso entero, y quien pide uno de día
              completo es precisamente quien más miedo tiene a que le descuenten.
              (El párrafo cuelga de `dias > 0`, así que un permiso en sábado o
              festivo se queda sin ella — es el mismo hueco preexistente que ya
              deja el contador mudo ahí, no uno nuevo.) Sin esto,
              la duda se resuelve escribiéndole a administración — justo el
              tráfico que esta app existe para quitar. */}
          {tipo === 'permiso' && (
            <span className="text-gray-500">
              {' '}
              Un permiso no descuenta de vacaciones ni de compensatorios
              {conHoras ? ': el horario es solo para el calendario del equipo' : ''}.
            </span>
          )}
        </p>
      )}

      <div className="mb-4">
        <label htmlFor="comentarios" className="mb-1 block text-sm font-medium text-gray-700">
          {pideOtorgamiento ? (
            // Obligatorio, y con otro nombre: es lo que el jefe juzga, y lo único
            // que dentro de seis meses dirá por qué esa persona tiene esos días.
            <>
              Por qué pides esos días <span className="font-normal text-red-500">*</span>
            </>
          ) : (
            <>
              Comentarios <span className="font-normal text-gray-400">(opcional)</span>
            </>
          )}
        </label>
        <textarea
          id="comentarios"
          rows={3}
          value={comentarios}
          maxLength={2000}
          onChange={(e) => setComentarios(e.target.value)}
          className={CAMPO}
        />
      </div>

      {aceptaAdjunto && (
        <div className="mb-5">
          <label htmlFor="adjunto" className="mb-1 block text-sm font-medium text-gray-700">
            {adjuntoObligatorio ? 'Soporte médico en PDF' : 'Documento adjunto en PDF'}
            {adjuntoObligatorio && <span className="text-red-500"> *</span>}
          </label>
          <input
            id="adjunto"
            ref={inputArchivo}
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => elegirArchivo(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-xl file:border-0 file:bg-gray-100 file:px-4 file:py-2 file:text-sm file:font-medium file:text-gray-700 hover:file:bg-gray-200"
          />
          {archivo && (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-gray-500">
              <Paperclip className="h-3.5 w-3.5" />
              {archivo.name} ({(archivo.size / 1024).toFixed(0)} KB)
            </p>
          )}
        </div>
      )}

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {exito && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> {exito}
        </div>
      )}

      <button
        type="submit"
        disabled={!puedeEnviar}
        className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
      >
        {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        {enviando ? 'Enviando…' : requiereAprobacion(tipo) ? 'Enviar solicitud' : 'Registrar incapacidad'}
      </button>
    </form>
  );
}
