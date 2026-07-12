import React, { useMemo, useState } from 'react';
import type { ReconciledRow } from './types';
import { generateCashFlowProjections } from './customerAnalysisUtils';
import { TrendingUpIcon, Info, Download } from 'lucide-react';
import * as XLSX from 'xlsx';

interface InfoTooltipProps {
  title: string;
  description: string;
  formula?: string;
}

const InfoTooltip: React.FC<InfoTooltipProps> = ({ title, description, formula }) => {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div className="relative inline-block">
      <button
        onMouseEnter={() => setIsVisible(true)}
        onMouseLeave={() => setIsVisible(false)}
        className="p-1 hover:bg-white/50 rounded-full transition-colors"
        type="button"
      >
        <Info size={16} className="text-slate-400 hover:text-slate-600" />
      </button>
      {isVisible && (
        <div className="absolute z-50 w-72 p-3 bg-slate-800 text-white text-xs rounded-lg shadow-xl -left-32 top-8">
          <div className="font-bold mb-1">{title}</div>
          <div className="text-slate-200 mb-2">{description}</div>
          {formula && (
            <div className="bg-slate-700 p-2 rounded mt-2 font-mono text-xs">
              {formula}
            </div>
          )}
          <div className="absolute -top-2 left-36 w-0 h-0 border-l-8 border-r-8 border-b-8 border-transparent border-b-slate-800"></div>
        </div>
      )}
    </div>
  );
};

interface CashFlowProjectionsProps {
  reconciledData: ReconciledRow[];
}

const CashFlowProjections: React.FC<CashFlowProjectionsProps> = ({
  reconciledData,
}) => {
  const formatNumber = (num: number, decimals: number = 2) => {
    return num.toLocaleString('es-CO', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  };

  // Calculate historical recovery rate from ALL data (not filtered by period)
  const historicalRecoveryRate = useMemo(() => {
    if (reconciledData.length === 0) return 0;

    const totalInvoiced = reconciledData.reduce((sum, inv) => sum + inv.total, 0);
    const totalCollected = reconciledData.reduce((sum, inv) => sum + inv.totalPaid, 0);
    
    return totalInvoiced > 0 ? (totalCollected / totalInvoiced) * 100 : 0;
  }, [reconciledData]);

  const cashFlowProjections = useMemo(() => {
    return generateCashFlowProjections(reconciledData, 6);
  }, [reconciledData]);

  const downloadProjectionsExcel = () => {
    const exportData = cashFlowProjections.map(proj => ({
      'Mes': proj.month.toUpperCase(),
      'Ingresos Proyectados': proj.projectedRevenue,
      'Pagos Esperados': proj.projectedPayments,
      'Flujo Neto': proj.netFlow,
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Proyecciones');
    XLSX.writeFile(workbook, 'Proyecciones_Flujo_Caja.xlsx');
  };

  return (
    <div className="space-y-6 fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
            <TrendingUpIcon size={32} className="text-blue-600" />
            Proyecciones de Flujo de Caja
          </h1>
          <p className="text-slate-500 mt-1">Predicción de ingresos y pagos esperados para los próximos 6 meses</p>
        </div>
        <button
          onClick={downloadProjectionsExcel}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
        >
          <Download size={18} />
          Descargar
        </button>
      </div>

      {/* Main Projection Table */}
      <div className="bg-gradient-to-br from-blue-50 to-blue-100/50 rounded-xl shadow-md shadow-blue-200/20 border border-blue-200 p-6">
        <div className="flex items-center gap-2 mb-4">
          <h2 className="text-lg font-semibold text-blue-600 uppercase tracking-wide">Proyecciones Mensuales</h2>
          <InfoTooltip
            title="Proyecciones de Flujo de Caja"
            description="Predicción de ingresos futuros basada en el promedio histórico de facturación y la tasa de recuperación actual. Los montos proyectados representan ingresos esperados ajustados por días de vencimiento promedio."
            formula="Ingresos Proyectados = Promedio Mensual Histórico × (Tasa Recuperación / 100)"
          />
        </div>

        {cashFlowProjections.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-blue-300">
                  <th className="text-left py-3 px-4 text-blue-700 font-bold">Mes</th>
                  <th className="text-right py-3 px-4 text-blue-700 font-bold">Ingresos Proyectados</th>
                  <th className="text-right py-3 px-4 text-blue-700 font-bold">Pagos Esperados</th>
                  <th className="text-right py-3 px-4 text-blue-700 font-bold">Flujo Neto</th>
                  <th className="text-center py-3 px-4 text-blue-700 font-bold">Tendencia</th>
                </tr>
              </thead>
              <tbody>
                {cashFlowProjections.map((projection, idx) => (
                  <tr key={idx} className={`border-b border-blue-100 hover:bg-white/50 transition-colors ${
                    projection.netFlow > 0 ? 'bg-green-50/40' : 'bg-orange-50/40'
                  }`}>
                    <td className="py-4 px-4 font-semibold text-slate-700 capitalize">{projection.month}</td>
                    <td className="py-4 px-4 text-right font-semibold text-blue-700">
                      ${formatNumber(projection.projectedRevenue, 0)}
                    </td>
                    <td className="py-4 px-4 text-right font-semibold text-emerald-700">
                      ${formatNumber(projection.projectedPayments, 0)}
                    </td>
                    <td className={`py-4 px-4 text-right font-bold ${
                      projection.netFlow > 0 ? 'text-green-700' : 'text-orange-700'
                    }`}>
                      ${formatNumber(projection.netFlow, 0)}
                    </td>
                    <td className="py-4 px-4 text-center">
                      {projection.netFlow > 0 ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-semibold">
                          ↑ Positivo
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-orange-100 text-orange-700 rounded-full text-xs font-semibold">
                          ↓ Negativo
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-slate-500 text-center py-12">No hay datos suficientes para generar proyecciones</p>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-gradient-to-br from-blue-50 to-blue-100/50 rounded-xl shadow-md shadow-blue-200/20 border border-blue-200 p-4">
          <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-2">Total Ingresos Proyectados (6m)</p>
          <p className="text-2xl font-bold text-blue-700 leading-tight">
            ${formatNumber(cashFlowProjections.reduce((sum, p) => sum + p.projectedRevenue, 0), 0)}
          </p>
        </div>

        <div className="bg-gradient-to-br from-emerald-50 to-emerald-100/50 rounded-xl shadow-md shadow-emerald-200/20 border border-emerald-200 p-4">
          <p className="text-xs font-semibold text-emerald-600 uppercase tracking-wide mb-2">Total Pagos Esperados (6m)</p>
          <p className="text-2xl font-bold text-emerald-700 leading-tight">
            ${formatNumber(cashFlowProjections.reduce((sum, p) => sum + p.projectedPayments, 0), 0)}
          </p>
        </div>

        <div className={`bg-gradient-to-br rounded-xl shadow-md border p-4 ${
          cashFlowProjections.reduce((sum, p) => sum + p.netFlow, 0) > 0
            ? 'from-green-50 to-green-100/50 shadow-green-200/20 border-green-200'
            : 'from-orange-50 to-orange-100/50 shadow-orange-200/20 border-orange-200'
        }`}>
          <p className={`text-xs font-semibold uppercase tracking-wide mb-2 ${
            cashFlowProjections.reduce((sum, p) => sum + p.netFlow, 0) > 0
              ? 'text-green-600'
              : 'text-orange-600'
          }`}>Flujo Neto Total (6m)</p>
          <p className={`text-2xl font-bold leading-tight ${
            cashFlowProjections.reduce((sum, p) => sum + p.netFlow, 0) > 0
              ? 'text-green-700'
              : 'text-orange-700'
          }`}>
            ${formatNumber(cashFlowProjections.reduce((sum, p) => sum + p.netFlow, 0), 0)}
          </p>
        </div>
      </div>

      {/* Info Box */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <div className="flex gap-3">
          <div className="flex-shrink-0">
            <Info size={20} className="text-blue-600 mt-0.5" />
          </div>
          <div>
            <h3 className="font-semibold text-blue-900 mb-1">Sobre estas proyecciones</h3>
            <ul className="text-sm text-blue-800 space-y-1">
              <li>• <strong>Base de cálculo:</strong> Promedio histórico de ingresos mensuales de <strong>todos los períodos</strong></li>
              <li>• <strong>Tasa de recuperación histórica:</strong> {formatNumber(historicalRecoveryRate, 1)}% (basada en todos los datos)</li>
              <li>• <strong>Metodología:</strong> Las proyecciones NO utilizan filtros de período para asegurar consistencia y precisión</li>
              <li>• <strong>Precisión:</strong> A mayor cantidad de histórico, más precisas serán las proyecciones</li>
              <li>• <strong>Revisión periódica:</strong> Actualiza estas proyecciones mensualmente con datos reales para mantener precisión</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CashFlowProjections;
