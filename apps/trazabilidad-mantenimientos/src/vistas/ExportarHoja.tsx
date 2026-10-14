import { useCallback, useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { api } from '../api';
import type { RespuestaExportaciones } from '../dominio';
import { ApiError } from '../lib/apiError';
import { NOTA_EXPORTAR, nombreDeDescarga, textoUltimaExportacion } from '../lib/exportar';
import { usePermisos } from '../permisos';
import { Alert, Button } from '../ui';

interface Props {
  /** El día de la tabla que se está viendo: sólo para el nombre de reserva del fichero. */
  hoy: string;
  /** Cambia cuando se pulsa «Actualizar»: vuelve a pedir la última exportación. */
  recarga: number;
}

/** Guarda lo recibido con ese nombre, desde la página (la petición lleva el token: no vale un enlace). */
function guardar(blob: Blob, nombre: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Exportar la F-ST-022 (lote 9e), en la pestaña «Trazabilidad F-ST-022». El
 * botón sólo le sale a quien tiene `hoja.exportar` (el servidor lo vuelve a
 * comprobar); «última exportación» la ve cualquiera con la app. El fichero lo
 * genera el servidor con la hoja ENTERA —no lo filtrado en pantalla— y se
 * guarda con el nombre que él manda. Aquí sólo se descarga: nada se sube.
 */
export default function ExportarHoja({ hoy, recarga }: Props) {
  const puedeExportar = usePermisos().puede('hoja.exportar');
  const [ultima, setUltima] = useState<RespuestaExportaciones | null>(null);
  const [generando, setGenerando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Si no llega, la línea no sale: no es un error que haya que enseñar.
  const cargar = useCallback(() => api.exportaciones().then(setUltima, () => setUltima(null)), []);
  useEffect(() => {
    void cargar();
  }, [cargar, recarga]);

  async function exportar() {
    setGenerando(true);
    setError(null);
    try {
      const { blob, contentDisposition } = await api.exportarHoja();
      guardar(blob, nombreDeDescarga(contentDisposition, hoy));
      await cargar();
    } catch (e) {
      // Lo que no es una respuesta del servidor (se cortó la conexión) no trae un mensaje que enseñar.
      setError(`No se pudo exportar la F-ST-022: ${e instanceof ApiError ? e.message : 'no hay conexión con el servidor. Inténtalo de nuevo en un momento.'}`);
    } finally {
      setGenerando(false);
    }
  }

  const texto = textoUltimaExportacion(ultima);
  if (!puedeExportar && !texto) return null;
  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-gray-200 pt-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {puedeExportar && (
          <Button variant="primary" busy={generando} onClick={() => void exportar()}>
            {!generando && <Download className="h-4 w-4" aria-hidden />}
            {generando ? 'Generando…' : 'Exportar F-ST-022'}
          </Button>
        )}
        <p className="min-w-0 flex-1 basis-64 text-xs text-gray-500">
          {puedeExportar && <span className="block">{NOTA_EXPORTAR}</span>}
          <span className="block text-gray-700" aria-live="polite">
            {texto}
          </span>
        </p>
      </div>
      {error && <Alert tone="red">{error}</Alert>}
    </div>
  );
}
