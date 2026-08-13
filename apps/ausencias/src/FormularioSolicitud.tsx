import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Paperclip, Send } from 'lucide-react';
import { crearSolicitud, leerComoBase64, type SaldoVacaciones, type Solicitud, type TipoSolicitud } from './api';
import { contarDiasHabiles, etiquetasFecha, requiereAprobacion, TIPOS } from './dominio';
import TarjetaSaldo from './TarjetaSaldo';

/** Mismo tope que el servidor (MAX_ADJUNTO_BYTES). Se avisa antes de subir. */
const MAX_PDF_BYTES = 8 * 1024 * 1024;

interface Props {
  festivos: Set<string>;
  aprobadorCorreo: string;
  /** Null si el usuario no tiene ficha de empleado, o si nadie configuró su punto de corte. */
  saldo: SaldoVacaciones | null;
  onCreada: (s: Solicitud) => void;
}

const CAMPO = 'w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none';

export default function FormularioSolicitud({ festivos, aprobadorCorreo, saldo, onCreada }: Props) {
  const [tipo, setTipo] = useState<TipoSolicitud>('vacaciones');
  const [fechaInicio, setFechaInicio] = useState('');
  const [fechaFin, setFechaFin] = useState('');
  const [comentarios, setComentarios] = useState('');
  const [archivo, setArchivo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const inputArchivo = useRef<HTMLInputElement>(null);

  const etiquetas = etiquetasFecha(tipo);
  const dias = useMemo(() => contarDiasHabiles(fechaInicio, fechaFin, festivos), [fechaInicio, fechaFin, festivos]);
  const adjuntoObligatorio = tipo === 'incapacidad';
  const aceptaAdjunto = tipo === 'incapacidad' || tipo === 'permiso';

  const rangoInvertido = Boolean(fechaInicio && fechaFin && fechaInicio > fechaFin);
  const faltaAdjunto = adjuntoObligatorio && !archivo;
  const puedeEnviar = Boolean(fechaInicio && fechaFin) && !rangoInvertido && !faltaAdjunto && !enviando;

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
        fechaFin,
        comentarios: comentarios.trim() || undefined,
        adjunto: archivo
          ? { nombreArchivo: archivo.name, mime: archivo.type, contenidoBase64: await leerComoBase64(archivo) }
          : undefined,
      });
      setExito(
        requiereAprobacion(tipo)
          ? `Solicitud enviada. ${aprobadorCorreo} recibirá el aviso para aprobarla y te llegará un correo con el resultado.`
          : 'Incapacidad registrada. Te hemos enviado el acuse por correo.',
      );
      setFechaInicio('');
      setFechaFin('');
      setComentarios('');
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
            min={fechaInicio || undefined}
            onChange={(e) => setFechaFin(e.target.value)}
            className={CAMPO}
          />
        </div>
      </div>

      {rangoInvertido && (
        <p className="mb-4 text-sm text-red-600">La fecha final no puede ser anterior a la inicial.</p>
      )}

      {/* Solo en vacaciones: los permisos y compensatorios no tocan el saldo. */}
      {tipo === 'vacaciones' && saldo && <TarjetaSaldo saldo={saldo} diasPedidos={rangoInvertido ? 0 : dias} />}

      {/* El contador en vivo evita la sorpresa de pedir «una semana» y que el
          aprobador vea 4 días porque había un festivo en medio. */}
      {dias > 0 && !rangoInvertido && (
        <p className="mb-4 rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-700">
          Son <b className="tabular-nums">{dias}</b> {dias === 1 ? 'día hábil' : 'días hábiles'}, descontando fines de
          semana y festivos de Colombia.
        </p>
      )}

      <div className="mb-4">
        <label htmlFor="comentarios" className="mb-1 block text-sm font-medium text-gray-700">
          Comentarios <span className="font-normal text-gray-400">(opcional)</span>
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
