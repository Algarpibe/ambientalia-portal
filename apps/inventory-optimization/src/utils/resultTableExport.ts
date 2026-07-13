// Export de la tabla de inventario (ARQ-001 tarea B): se saca de ResultTable
// para aislar el import dinámico de xlsx y el acceso al DOM. Comportamiento igual.
import type { AnalysisResult } from '../types';
import { computeEoq } from './resultTableLogic';

/** Exporta el análisis completo a un .xlsx con dos hojas (con seguimiento / sin). */
export async function exportInventoryToExcel(
  data: AnalysisResult[],
  eoqOrderCost: number,
  eoqHoldingRate: number,
): Promise<void> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();

  const formatData = (items: AnalysisResult[]) => items.map((item) => ({
    SKU: item.sku,
    'Nombre del Artículo': item.itemName,
    'Precio Unitario': item.unitPrice.toLocaleString('en-US', { style: 'currency', currency: 'USD' }),
    'Nivel Actual (Reposición)': item.currentLevel,
    'Ventas 2026 (Proyectadas/Total)': item.sales2026?.toFixed(2),
    'Promedio Mensual (Base)': item.monthlyAverage.toFixed(2),
    'Ventas Anuales (Base)': item.annualSales.toFixed(2),
    'Tiempo Entrega (Días)': item.leadTimeDays,
    'Tiempo Entrega (Meses)': item.leadTimeMonths.toFixed(2),
    'σ Lead Time (Días)': item.leadTimeStdDays,
    'Fuente Lead Time': item.leadTimeSource,
    '# OC Recibidas': item.leadTimeN,
    'Cobertura (Días)': item.coverageDays < 0 ? 'N/A' : item.coverageDays,
    'Riesgo Quiebre (Cob<LT)': item.coverageRisk ? 'SÍ' : 'NO',
    'ETA (llegada)': item.etaDate || '',
    'ETA (días)': item.etaDate ? item.etaDays : '',
    'Stock Seguridad': item.safetyStock.toFixed(2),
    'Punto de Pedido (PdP)': item.reorderPoint.toFixed(2),
    'Cantidad Óptima (Q)': item.optimalQuantity.toFixed(2),
    'EOQ': computeEoq(item.annualSales, item.unitCost, eoqOrderCost, eoqHoldingRate) || '',
    'Desviación': item.deviation.toFixed(2),
    'Estatus': item.status,
    'ABC': item.abcClass,
    'XYZ': item.xyzClass,
    'ABC-XYZ': item.abcXyz,
    'Costo (USD)': item.unitCost,
    'Valor consumo anual (USD)': Math.round(item.annualValue),
    'Coef. Variación': item.coefVariation.toFixed(2),
    'Origen de Demanda': item.demandSource,
    'Patrón Demanda': item.demandPattern,
    'ADI': item.adi === Infinity ? '∞' : item.adi.toFixed(2),
    'CV²': item.cv2.toFixed(2),
    'Pronóstico Croston (mes)': item.crostonForecast.toFixed(2),
    'Revisión Manual': item.manualReview ? 'SÍ' : 'NO',
    'Nombre de categoría': item.category,
    'Ratio Variabilidad': item.variabilityRatio.toFixed(2),
  }));

  const wsMain = XLSX.utils.json_to_sheet(formatData(data.filter((r) => !r.isService)));
  const wsService = XLSX.utils.json_to_sheet(formatData(data.filter((r) => r.isService)));

  XLSX.utils.book_append_sheet(wb, wsMain, 'Análisis de Inventario');
  XLSX.utils.book_append_sheet(wb, wsService, 'Artículos sin Seguimiento');

  XLSX.writeFile(wb, `Analisis_Ambientalia_${new Date().toISOString().split('T')[0]}.xlsx`);
}

/** Exporta un CSV mínimo (sku + niveles) para cargar de vuelta al ERP. */
export async function exportInventoryToErpCsv(data: AnalysisResult[]): Promise<void> {
  const XLSX = await import('xlsx');
  const erpData = data.filter((r) => !r.isService).map((item) => ({
    sku: item.sku,
    new_reorder_level: Math.round(item.reorderPoint),
    new_order_quantity: Math.round(item.optimalQuantity),
  }));

  const ws = XLSX.utils.json_to_sheet(erpData);
  const csv = XLSX.utils.sheet_to_csv(ws);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', 'Carga_ERP_Ambientalia.csv');
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
