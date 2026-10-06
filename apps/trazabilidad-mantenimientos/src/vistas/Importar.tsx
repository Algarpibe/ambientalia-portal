import { useRef, useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { api } from '../api';
import type { FilaImportada, ResumenImportacion } from '../dominio';
import { leerLibro } from '../lib/importar';
import { Alert, Button, Modal } from '../ui';

interface Props {
  onClose: () => void;
  onHecho: (total: number) => Promise<void>;
}

/**
 * Importación en dos pasos: leer el Excel en el navegador y pedir al servidor
 * un simulacro (altas / cambios / retiradas); sólo al confirmar se escribe.
 */
export default function Importar({ onClose, onHecho }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [archivo, setArchivo] = useState<string | null>(null);
  const [filas, setFilas] = useState<FilaImportada[] | null>(null);
  const [descartadas, setDescartadas] = useState<number[]>([]);
  const [simulacro, setSimulacro] = useState<ResumenImportacion | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function elegir(f: File) {
    setError(null);
    setSimulacro(null);
    setFilas(null);
    setOcupado(true);
    try {
      const lectura = leerLibro(await f.arrayBuffer());
      if (lectura.filas.length === 0) throw new Error('El archivo no trae ningún GRIMM EDM 180 en la hoja «Trazabilidad».');
      setArchivo(f.name);
      setFilas(lectura.filas);
      setDescartadas(lectura.descartadas);
      setSimulacro(await api.simularImportacion(f.name, lectura.filas));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function aplicar() {
    if (!archivo || !filas) return;
    setOcupado(true);
    setError(null);
    try {
      const r = await api.importar(archivo, filas);
      await onHecho(r.total);
    } catch (e) {
      setError((e as Error).message);
      setOcupado(false);
    }
  }

  return (
    <Modal
      title="Importar la hoja F-ST-022"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={!simulacro} busy={ocupado && !!simulacro} onClick={() => void aplicar()}>
            Aplicar importación
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        <p className="text-gray-600">
          Elige el Excel «F-ST-022 Trazabilidad Mttos Clientes». Se leen sólo los GRIMM EDM 180 de la hoja «Trazabilidad». El seguimiento registrado aquí (avisos,
          «en Ambientalia», notas) no se toca.
        </p>
        <input
          ref={input}
          type="file"
          accept=".xlsx,.xlsm,.xls"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void elegir(f);
          }}
        />
        <Button onClick={() => input.current?.click()} busy={ocupado && !simulacro} className="self-start">
          <FileSpreadsheet className="h-4 w-4" aria-hidden /> {archivo ? 'Elegir otro archivo' : 'Elegir archivo'}
        </Button>

        {error && <Alert tone="red">{error}</Alert>}

        {simulacro && (
          <div className="rounded-xl border border-gray-200 p-4">
            <p className="mb-2 font-semibold text-gray-900">«{simulacro.archivo}»</p>
            <dl className="grid grid-cols-[1fr_auto] gap-y-1">
              <dt className="text-gray-600">GRIMM EDM 180 en el archivo</dt>
              <dd className="font-semibold tabular-nums">{simulacro.total}</dd>
              <dt className="text-gray-600">Nuevos</dt>
              <dd className="font-semibold tabular-nums">{simulacro.nuevos}</dd>
              <dt className="text-gray-600">Con cambios</dt>
              <dd className="font-semibold tabular-nums">{simulacro.actualizados}</dd>
              <dt className="text-gray-600">Ya no están en el archivo (se retiran del inventario)</dt>
              <dd className="font-semibold tabular-nums">{simulacro.retirados}</dd>
            </dl>
          </div>
        )}
        {simulacro && simulacro.retirados > 0 && (
          <Alert tone="amber">
            {simulacro.retirados} equipo{simulacro.retirados === 1 ? '' : 's'} dejará{simulacro.retirados === 1 ? '' : 'n'} de verse. Su seguimiento se conserva y vuelve si aparecen
            en otra importación.
          </Alert>
        )}
        {descartadas.length > 0 && (
          <Alert tone="amber">
            Se ignoran {descartadas.length} fila{descartadas.length === 1 ? '' : 's'} de EDM 180 sin serial o sin cliente (fila{descartadas.length === 1 ? '' : 's'} {descartadas.join(', ')}).
          </Alert>
        )}
      </div>
    </Modal>
  );
}
