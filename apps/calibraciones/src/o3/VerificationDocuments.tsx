import { useState } from 'react';
import { FileDown, FileSpreadsheet, FileText, Tag } from 'lucide-react';
import { verificationPointsCsv, verificationSheets } from '../lib/exports';
import { buildLabelModel, DEFAULT_LABEL_SIZE, LABEL_SIZES, labelAvailability, type LabelSizeKey } from '../lib/label';
import { buildReportModel, documentFileName, reportAvailability, type ReportContext } from '../lib/report';
import type { Equipment, Verification, VerificationDetail } from '../types';
import { Alert, Button, Card, downloadBlob, downloadText, Select } from '../ui';

/**
 * Informe PDF (Annex A), Etiqueta (§11.1), CSV and XLSX of one stored
 * verification. Any role that can open the record can download (LECTOR too).
 * react-pdf and SheetJS load on the first click (separate chunks).
 */
export default function VerificationDocuments({
  verification,
  reference,
  candidate,
  referenceVerification,
  dirty,
}: {
  verification: VerificationDetail;
  reference: Equipment | null;
  candidate: Equipment | null;
  referenceVerification: Verification | null;
  dirty: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [size, setSize] = useState<LabelSizeKey>(DEFAULT_LABEL_SIZE);

  const ctx: ReportContext = { verification, reference, candidate, referenceVerification };
  const code = candidate?.internalCode ?? 'equipo';
  const report = reportAvailability(verification);
  const label = labelAvailability(verification);

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(`No se pudo generar el archivo: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  const downloadReport = () =>
    run('report', async () => {
      const { reportPdfBlob } = await import('../pdf/generate');
      downloadBlob(documentFileName('informe', verification, code, 'pdf'), await reportPdfBlob(buildReportModel(ctx)));
    });

  const downloadLabel = () =>
    run('label', async () => {
      const { labelPdfBlob } = await import('../pdf/generate');
      downloadBlob(documentFileName('etiqueta', verification, code, 'pdf'), await labelPdfBlob(buildLabelModel(ctx), LABEL_SIZES[size]));
    });

  const downloadXlsx = () =>
    run('xlsx', async () => {
      const { workbookBytes } = await import('../lib/xlsx');
      const bytes = workbookBytes(verificationSheets(ctx));
      downloadBlob(
        documentFileName('verificacion', verification, code, 'xlsx'),
        new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      );
    });

  return (
    <Card title="Documentos y exportaciones">
      <div className="space-y-3">
        {dirty && <Alert tone="amber">Hay cambios sin guardar: los documentos usan el registro guardado en el servidor.</Alert>}
        <div className="flex flex-wrap items-end gap-2">
          <Button variant="primary" onClick={downloadReport} busy={busy === 'report'} disabled={!report.ok || !!busy}>
            <FileText className="h-4 w-4" aria-hidden /> Informe PDF
          </Button>
          <Button onClick={downloadLabel} busy={busy === 'label'} disabled={!label.ok || !!busy}>
            <Tag className="h-4 w-4" aria-hidden /> Etiqueta
          </Button>
          <label className="text-xs text-gray-600">
            <span className="mb-1 block">Tamaño de la etiqueta</span>
            <Select value={size} onChange={(e) => setSize(e.target.value as LabelSizeKey)} disabled={!label.ok} aria-label="Tamaño de la etiqueta">
              {Object.entries(LABEL_SIZES).map(([k, s]) => (
                <option key={k} value={k}>
                  {s.label}
                </option>
              ))}
            </Select>
          </label>
          <Button
            onClick={() => downloadText(documentFileName('puntos', verification, code, 'csv'), verificationPointsCsv(verification))}
            disabled={!!busy}
          >
            <FileDown className="h-4 w-4" aria-hidden /> CSV
          </Button>
          <Button onClick={downloadXlsx} busy={busy === 'xlsx'} disabled={!!busy}>
            <FileSpreadsheet className="h-4 w-4" aria-hidden /> XLSX
          </Button>
        </div>
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-gray-500">
          {!report.ok && <li>{report.reason}</li>}
          {report.ok && report.watermark && <li>El informe llevará la marca «{report.watermark}» hasta que el Director Técnico apruebe el registro.</li>}
          {!label.ok && <li>{label.reason}</li>}
          <li>El CSV de puntos usa el formato de la plantilla de importación (separador «;», coma decimal) y se puede volver a importar.</li>
        </ul>
        {error && <Alert tone="red">{error}</Alert>}
      </div>
    </Card>
  );
}
