import type { ClientProfile } from '../types';

export function ExportButton({ clients }: { clients: ClientProfile[] }) {
  const handleExport = async () => {
    // Import dinámico: xlsx (429 KB) solo se carga al exportar (FE-001).
    const XLSX = await import('xlsx');
    const validClients = clients.filter(c => c.scores !== null);

    // Hoja 1: Ranking con scores principales
    const ranking = validClients.map((c) => ({
      Cliente: c.displayName,
      'Score Valor (V)': c.scores!.valueScore,
      'Score Pagos (P)': c.scores!.paymentScore,
      'Score Total (T)': c.scores!.totalScore,
      Segmento: c.scores!.segment,
      'Tier Beneficios': c.scores!.gating.maxBenefitTier,
      'Calidad Datos': c.scores!.dataQuality,
      Candados: c.scores!.gating.locks.length,
      'Ventas 12m': c.profitability?.period12m.salesTotal ?? 0,
      'GM% 12m': c.profitability?.period12m.grossMarginPct ?? 0,
      'GM$ 12m': c.profitability?.period12m.grossProfit ?? 0,
      'Mora Valor': c.payments ? c.payments.combined.lateValueRate * 100 : 0,
      'Severidad': c.payments?.combined.severity ?? 0,
      'Avg DPD': c.payments?.combined.avgDpd ?? 0,
      Flags: c.scores!.flags.join('; '),
      Acciones: c.scores!.actions.join('; ')
    }));

    // Hoja 2: Detalle de rentabilidad
    const rentabilidad = validClients.map((c) => ({
      Cliente: c.displayName,
      'Órdenes 12m': c.profitability?.period12m.orderCount ?? 0,
      'Ventas 12m': c.profitability?.period12m.salesTotal ?? 0,
      'COGS 12m': c.profitability?.period12m.cogsTotal ?? 0,
      'GM$ 12m': c.profitability?.period12m.grossProfit ?? 0,
      'GM% 12m': c.profitability?.period12m.grossMarginPct ?? 0,
      'MixMargin 12m': c.profitability?.period12m.mixMarginIndex ?? 0,
      'Órdenes 6m': c.profitability?.period6m.orderCount ?? 0,
      'Ventas 6m': c.profitability?.period6m.salesTotal ?? 0,
      'GM% 6m': c.profitability?.period6m.grossMarginPct ?? 0,
      'Score GM%': c.scores!.valueComponents.gmPctScore,
      'Score GM$': c.scores!.valueComponents.gmAbsScore,
      'Score MixMargin': c.scores!.valueComponents.mixMarginScore
    }));

    // Hoja 3: Detalle de pagos
    const pagos = validClients.map((c) => ({
      Cliente: c.displayName,
      'Facturas 12m': c.payments?.period12m.invoiceCount ?? 0,
      'Valor Total 12m': c.payments?.period12m.totalValue ?? 0,
      'LateRate 12m': c.payments?.period12m.lateRate ?? 0,
      'LateValueRate 12m': c.payments?.period12m.lateValueRate ?? 0,
      'Severidad 12m': c.payments?.period12m.severity ?? 0,
      'AvgDPD 12m': c.payments?.period12m.avgDpd ?? 0,
      'MaxDPD 12m': c.payments?.period12m.maxDpd ?? 0,
      'Volatilidad 12m': c.payments?.period12m.volatility ?? 0,
      'Facturas 6m': c.payments?.period6m.invoiceCount ?? 0,
      'LateValueRate 6m': c.payments?.raw6m.lateValueRate ?? 0,
      'Severidad 6m': c.payments?.raw6m.severity ?? 0,
      'MaxDPD 6m': c.payments?.raw6m.maxDpd ?? 0,
      'Score LateValue': c.scores!.paymentComponents.lateValueRateScore,
      'Score Severidad': c.scores!.paymentComponents.severityScore,
      'Score AvgDPD': c.scores!.paymentComponents.avgDpdScore,
      'Score Volatilidad': c.scores!.paymentComponents.volatilityScore
    }));

    // Hoja 4: Políticas y candados
    const politicas = validClients.map((c) => ({
      Cliente: c.displayName,
      Segmento: c.scores!.segment,
      'Política Crédito': c.scores!.policy.creditDescription,
      'Política Descuento': c.scores!.policy.discountDescription,
      'Prioridad Servicio': c.scores!.policy.priorityDescription,
      'Crédito Bloqueado': c.scores!.gating.creditBlocked ? 'Sí' : 'No',
      'Descuento Bloqueado': c.scores!.gating.discountBlocked ? 'Sí' : 'No',
      'Prioridad Reducida': c.scores!.gating.priorityReduced ? 'Sí' : 'No',
      'Candados Activos': c.scores!.gating.locks.map(l => l.description).join(' | '),
      'Recomendaciones': c.scores!.gating.locks.map(l => l.recommendation).join(' | ')
    }));

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
