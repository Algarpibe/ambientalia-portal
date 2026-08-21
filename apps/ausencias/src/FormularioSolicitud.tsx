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
  onCreada: (s: Solicitud) => void;
}

const CAMPO = 'w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none';

export default function FormularioSolicitud({ festivos, aprobador, saldo, compensatorios, onCreada }: Props) {
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
  const inputArchivo = useRef<HTMLInputElement>(null);

  const pideOtorgamiento = esOtorgamiento(tipo);
  // Texto y no número, por lo mismo que en el panel de saldos: convertirlo aquí
  // haría que un «abc» viajara como NaN → `null` en JSON, y el servidor leería
  // «sin días» en vez de «esto no es un número». La validación de forma vive
  // entera en el backend, que es quien redacta el error.
  const diasConcedidos = Number(diasTexto.trim().replace(',', '.'));
  const diasConcedidosValidos = /^\d{1,2}([.,]\d)?$/.test(diasTexto.trim()) && diasConcedidos > 0;

  const etiquetas = etiquetasFecha(tipo);
  const dias = useMemo(() => contarDiasHabiles(fechaInicio, fechaFin, festivos), [fechaInicio, fechaFin, festivos]);
  const adjuntoObligatorio = tipo === 'incapacidad';
  const aceptaAdjunto = tipo === 'incapacidad' || tipo === 'permiso';

  const rangoInvertido = Boolean(fechaInicio && fechaFin && fechaInicio > fechaFin);
  const faltaAdjunto = adjuntoObligatorio && !archivo;

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

  // Un otorgamiento tiene otros requisitos: no hay fecha fin que rellenar, pero
  // sí una cantidad y un motivo, los dos obligatorios. Lo que no se comprueba
  // aquí es el tope de 30 días ni la ventana de tres meses: esas las redacta el
  // servidor con su mensaje, y duplicarlas aquí sería tener la regla dos veces.
  const puedeEnviar = pideOtorgamiento
    ? Boolean(fechaInicio) && diasConcedidosValidos && Boolean(comentarios.trim()) && !enviando
    : Boolean(fechaInicio && fechaFin) &&
      !rangoInvertido &&
      !fechaEnPasado &&
      !faltaAdjunto &&
      !excedeCompensatorios &&
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
        // Un otorgamiento es UN día: el fin es el mismo que el inicio, y el
        // servidor lo exige. Se manda explícito en vez de dejar el campo vacío
        // porque `fechaFin` no es opcional en el contrato.
        fechaFin: pideOtorgamiento ? fechaInicio : fechaFin,
        comentarios: comentarios.trim() || undefined,
        dias: pideOtorgamiento ? diasConcedidos : undefined,
        adjunto: archivo
          ? { nombreArchivo: archivo.name, mime: archivo.type, contenidoBase64: await leerComoBase64(archivo) }
          : undefined,
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
          <TarjetaSaldo saldo={saldo} diasPedidos={rangoInvertido ? 0 : dias} soloSiAvisa />
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
