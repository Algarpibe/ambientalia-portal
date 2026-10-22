import { describe, it, expect } from 'vitest';
import type { ClientProfile } from '../types';
import { hojasDeExportacion } from './exportSheets';

// DATA-334 — ventas, coste y margen son sumas de USD en coma flotante; el Excel de
// valoración las escribía con residuo (0.30000000000000004). Se redondean a centavos
// al exportar; la pantalla y el scoring siguen con el valor completo.
const residuo = 0.1 + 0.2;

const periodo = { orderCount: 2, salesTotal: residuo, cogsTotal: residuo, grossProfit: residuo, grossMarginPct: 33.3333, mixMarginIndex: 1 };
const pagos = { invoiceCount: 2, totalValue: residuo, lateRate: 0.5, lateValueRate: 0.25, severity: 1, avgDpd: 3, maxDpd: 5, volatility: 0.1 };

const cliente = {
  displayName: 'Cliente ficticio',
  profitability: { period12m: periodo, period6m: periodo },
  payments: { period12m: pagos, period6m: pagos, raw6m: pagos, combined: { lateValueRate: 0.25, severity: 1, avgDpd: 3 } },
  scores: {
    valueScore: 50, paymentScore: 60, totalScore: 55, segment: 'B', dataQuality: 'ok', flags: [], actions: [],
    gating: { maxBenefitTier: 1, locks: [], creditBlocked: false, discountBlocked: false, priorityReduced: false },
    valueComponents: { gmPctScore: 1, gmAbsScore: 2, mixMarginScore: 3 },
    paymentComponents: { lateValueRateScore: 1, severityScore: 2, avgDpdScore: 3, volatilityScore: 4 },
    policy: { creditDescription: 'c', discountDescription: 'd', priorityDescription: 'p' },
  },
} as unknown as ClientProfile;

describe('hojasDeExportacion', () => {
  it('escribe los importes en USD redondeados a centavos, sin residuo de coma flotante', () => {
    const { ranking, rentabilidad, pagos: hojaPagos } = hojasDeExportacion([cliente]);
    expect(ranking[0]['Ventas 12m']).toBe(0.3);
    expect(ranking[0]['GM$ 12m']).toBe(0.3);
    expect(rentabilidad[0]['Ventas 12m']).toBe(0.3);
    expect(rentabilidad[0]['COGS 12m']).toBe(0.3);
    expect(rentabilidad[0]['GM$ 12m']).toBe(0.3);
    expect(rentabilidad[0]['Ventas 6m']).toBe(0.3);
    expect(hojaPagos[0]['Valor Total 12m']).toBe(0.3);
  });

  it('no toca lo que no es un importe (porcentajes, ratios, conteos)', () => {
    const { ranking, rentabilidad, pagos: hojaPagos } = hojasDeExportacion([cliente]);
    expect(ranking[0]['GM% 12m']).toBe(33.3333);
    expect(rentabilidad[0]['Órdenes 12m']).toBe(2);
    expect(hojaPagos[0]['LateValueRate 12m']).toBe(0.25);
  });

  it('deja fuera a los clientes sin scores, como antes', () => {
    const sinScores = { ...cliente, scores: null } as ClientProfile;
    const hojas = hojasDeExportacion([cliente, sinScores]);
    expect(hojas.ranking).toHaveLength(1);
    expect(hojas.politicas).toHaveLength(1);
  });
});
