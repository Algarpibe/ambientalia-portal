import { useState } from 'react';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import { importarHistorico, type FilaHistorico, type ResumenImportacion } from './api';
import { leerLibro, PESTANAS, type LecturaExcel } from './leerExcel';

// Importación, una sola vez, del histórico que vivía en las cuatro pestañas de
// `consulta_vacaciones`. Dos pasos a propósito: primero se previsualiza en seco
// (el servidor cuenta sin escribir) y solo entonces se importa de verdad.

interface Props {
  onImportado: () => void;
}

export default function ImportarHistorico({ onImportado }: Props) {
  const [lectura, setLectura] = useState<LecturaExcel | null>(null);
  const [nombreFichero, setNombreFichero] = useState('');
  const [previa, setPrevia] = useState<ResumenImportacion | null>(null);
  const [resultado, setResultado] = useState<ResumenImportacion | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function elegir(fichero: File | null) {
    setError(null);
    setPrevia(null);
    setResultado(null);
    setLectura(null);
    if (!fichero) return;

    setNombreFichero(fichero.name);
    setTrabajando(true);
    try {
      const leido = await leerLibro(fichero);
      setLectura(leido);
      if (leido.filas.length === 0) {
        setError('No se encontró ninguna fila en las cuatro pestañas esperadas.');
        return;
      }
      setPrevia(await importarHistorico(leido.filas as FilaHistorico[], true));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTrabajando(false);
    }
  }

  async function importar() {
    if (!lectura) return;
    setTrabajando(true);
    setError(null);
    try {
      setResultado(await importarHistorico(lectura.filas as FilaHistorico[], false));
      setPrevia(null);
      onImportado();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTrabajando(false);
    }
  }

  const problemas = previa ? previa.sinResolver.length + previa.ambiguos.length : 0;

  return (
    <section className="mb-8 rounded-2xl border border-gray-200 bg-gray-50 p-4">
      <h3 className="mb-1 text-sm font-semibold text-gray-900">Importar el histórico de la hoja</h3>
      <p className="mb-3 text-sm text-gray-600">
        Elige el archivo <b>consulta_vacaciones.xlsx</b>. Se leen sus cuatro pestañas de solicitudes (
        {PESTANAS.join(', ')}) <b>en tu navegador</b>: al servidor solo viajan las filas, nunca el archivo. Primero verás
        un resumen y solo entonces se importa. Reimportar el mismo archivo es seguro: lo que ya esté no se duplica.
      </p>

      <input
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={(e) => void elegir(e.target.files?.[0] ?? null)}
        aria-label="Archivo consulta_vacaciones.xlsx"
        className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-xl file:border-0 file:bg-white file:px-4 file:py-2 file:text-sm file:font-medium file:text-gray-700 file:shadow-sm hover:file:bg-gray-100"
      />

      {trabajando && (
        <p className="mt-3 flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Leyendo…
        </p>
      )}

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {lectura && lectura.pestanasQueFaltan.length > 0 && (
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          No se encontraron estas pestañas: {lectura.pestanasQueFaltan.join(', ')}. Se importará el resto.
        </p>
      )}

      {previa && (
        <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
          <p className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-900">
            <FileSpreadsheet className="h-4 w-4 text-gray-400" /> {nombreFichero}
          </p>
          <ul className="mb-3 space-y-1 text-sm text-gray-700">
            <li>
              <b className="tabular-nums">{previa.total}</b> filas leídas
              {lectura && lectura.descartadas > 0 && (
                <span className="text-gray-500"> ({lectura.descartadas} sin nombre o sin fechas, descartadas)</span>
              )}
            </li>
            <li>
              <b className="tabular-nums">{previa.importadas}</b> se importarán
            </li>
            {previa.yaExistian > 0 && (
              <li className="text-gray-500">
                <b className="tabular-nums">{previa.yaExistian}</b> ya estaban registradas y se omiten
              </li>
            )}
          </ul>

          {/* Los nombres dudosos se enseñan, no se adivinan: atribuir vacaciones a
              la persona equivocada es peor que dejarlas fuera. */}
          {previa.sinResolver.length > 0 && (
            <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="mb-1 font-medium">Estos nombres no corresponden a ningún empleado registrado:</p>
              <ul className="list-inside list-disc">
                {previa.sinResolver.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
              <p className="mt-1">Sus filas quedarán fuera. Añádelos en Empleados y vuelve a importar.</p>
            </div>
          )}

          {previa.ambiguos.length > 0 && (
            <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="mb-1 font-medium">Estos nombres encajan con más de una persona:</p>
              <ul className="list-inside list-disc">
                {previa.ambiguos.map((a) => (
                  <li key={a.nombre}>
                    {a.nombre} → {a.candidatos.join(' o ')}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button
            type="button"
            disabled={trabajando || previa.importadas === 0}
            onClick={() => void importar()}
            className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300"
          >
            {trabajando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Importar {previa.importadas} solicitudes{problemas > 0 ? ' (dejando fuera las de arriba)' : ''}
          </button>
        </div>
      )}

      {resultado && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {resultado.importadas} solicitudes importadas
            {resultado.yaExistian > 0 && `, ${resultado.yaExistian} ya estaban`}.
          </span>
        </div>
      )}
    </section>
  );
}
