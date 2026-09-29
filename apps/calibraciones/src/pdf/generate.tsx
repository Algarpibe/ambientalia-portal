/**
 * Lazy entry point of the PDF documents. Import it ONLY with
 * `await import('../pdf/generate')`: that keeps @react-pdf/renderer (and its
 * pdfkit / fontkit dependencies) in a separate chunk loaded on first click.
 */
import { pdf } from '@react-pdf/renderer';
import type { LabelModel } from '../lib/label';
import type { ReportModel } from '../lib/report';
import { LabelDocument } from './LabelDocument';
import { ReportDocument } from './ReportDocument';

export const reportPdfBlob = (model: ReportModel): Promise<Blob> => pdf(<ReportDocument model={model} />).toBlob();

export const labelPdfBlob = (model: LabelModel, size: { widthMm: number; heightMm: number }): Promise<Blob> =>
  pdf(<LabelDocument model={model} size={size} />).toBlob();
