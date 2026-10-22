import type { ClientProfile } from '../types';
import { hojasDeExportacion } from './exportSheets';

export function ExportButton({ clients }: { clients: ClientProfile[] }) {
  const handleExport = async () => {
    // Import dinámico: xlsx (429 KB) solo se carga al exportar (FE-001).
    const XLSX = await import('xlsx');
    // Las filas (con los importes ya redondeados, DATA-334) salen de una función pura.
    const { ranking, rentabilidad, pagos, politicas } = hojasDeExportacion(clients);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ranking), 'Ranking');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rentabilidad), 'Rentabilidad');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pagos), 'Pagos');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(politicas), 'Políticas');
    XLSX.writeFile(wb, 'valoracion_clientes.xlsx');
  };

  return (
    <button className="btn btn--primary" onClick={handleExport} disabled={!clients.length}>
      📊 Exportar Excel
    </button>
  );
}
