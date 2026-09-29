import { useState } from 'react';
import { Download } from 'lucide-react';
import { todayInColombia } from '../lib/domain';
import { sheetToCsv, type SheetSpec } from '../lib/exports';
import { Button, downloadBlob, downloadText } from '../ui';

/** «Exportar» CSV / XLSX of the rows a list is showing (filters applied). Any role. */
export default function ListExport({ fileBase, sheet }: { fileBase: string; sheet: (() => SheetSpec) | null }) {
  const [busy, setBusy] = useState(false);
  const name = (ext: string) => `${fileBase}_${todayInColombia()}.${ext}`;

  const xlsx = async () => {
    if (!sheet) return;
    setBusy(true);
    try {
      const { workbookBytes } = await import('../lib/xlsx');
      downloadBlob(name('xlsx'), new Blob([workbookBytes([sheet()])], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => sheet && downloadText(name('csv'), sheetToCsv(sheet()))} disabled={!sheet}>
        <Download className="h-4 w-4" aria-hidden /> Exportar CSV
      </Button>
      <Button onClick={xlsx} busy={busy} disabled={!sheet}>
        <Download className="h-4 w-4" aria-hidden /> Exportar XLSX
      </Button>
    </div>
  );
}
