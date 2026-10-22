// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import { JSDOM } from 'jsdom';
import App from './App';
import { RankingTable } from './ui/RankingTable';
import { CustomerDetail } from './ui/CustomerDetail';
import { Settings } from './ui/Settings';
import { DEFAULT_SCORING_CONFIG, DEFAULT_EXTENDED_CONFIG, type ClientProfile } from './types';

// FE-419 — la valoración de clientes se tiene que poder usar con teclado y lector de
// pantalla: buscador y campos de ajustes con nombre (y las etiquetas asociadas a su control),
// cabeceras ordenables que son botones y declaran su orden, filas que abren el detalle
// también con Enter, botones de solo icono con nombre y unos modales de información que son
// diálogos de verdad (nombre, foco dentro al abrir, Escape cierra y el foco vuelve a quien
// los abrió). Se prueba por roles y nombres accesibles.
//
// Esta app no tiene vitest.config: el entorno jsdom va en el docblock y los matchers y la
// limpieza del DOM se cargan aquí (RTL 16 no limpia solo sin `globals`). En Node 22+ el
// `localStorage` de Node tapa al de jsdom y vale `undefined` (ver apps/portal/src/vitest.setup.ts);
// la app lo lee al arrancar (la configuración guardada) y, sin esto, cae en su catch y lo
// avisa por consola. Bajo Node 20 (el de CI) el global ya existe y esto no hace nada.
if (!globalThis.localStorage) {
  globalThis.localStorage = new JSDOM('', { url: 'http://localhost:3000' }).window.localStorage;
}

afterEach(() => {
  cleanup();
});

// Solo lo que pintan la tabla, el detalle (resumen y rentabilidad) y la cabecera de la app;
// el resto del ClientProfile se completa con un cast para no fijarlo entero en el test.
const CLIENTE = {
  clientKey: 'acme',
  displayName: 'ACME SAS',
  profitability: {
    combined: { gmPct: 30, gmAbs: 1000, mixMarginIndex: 0.5 },
    period12m: { orderCount: 3, salesTotal: 5000, grossMarginPct: 30, topSkus: [] },
    period6m: { orderCount: 1, salesTotal: 2000, grossMarginPct: 25, topSkus: [] },
  },
  payments: null,
  quickMetrics: { salesTotal: 5000, gmPct: 30, gmAbs: 1000, lateValueRate: 0.1, severity: 5, avgDpd: 3 },
  scores: {
    valueScore: 70, paymentScore: 60, totalScore: 65, segment: 'Estándar', quadrant: 'Estandar',
    segmentExplanation: 'Cliente estándar', policy: {}, warnings: [], actions: [],
    topPositiveDrivers: [], topNegativeDrivers: [],
    gating: { locks: [], maxBenefitTier: 'Max', creditBlocked: false, discountBlocked: false, priorityReduced: false },
    valueComponents: { gmPctScore: 70, gmPctPercentile: 0.7, gmAbsScore: 60, gmAbsPercentile: 0.6, mixMarginScore: 50, mixMarginPercentile: 0.5 },
  },
} as unknown as ClientProfile;

vi.mock('./hub/loadFromHub', () => ({
  loadFromHub: vi.fn(() => Promise.resolve({ sales: [{}], master: [], invoices: [], payments: [], salesHistory: [] })),
}));

vi.mock('./metrics/clientAggregator', async (importOriginal) => {
  const real = await importOriginal<typeof import('./metrics/clientAggregator')>();
  return { ...real, aggregateClients: () => [CLIENTE] };
});

/** Enfoca el elemento y pulsa la tecla, como haría quien navega con Tab. */
function pulsar(el: HTMLElement, key: string) {
  el.focus();
  fireEvent.keyDown(el, { key });
}

describe('Dashboard (FE-419)', () => {
  it('el buscador tiene nombre y los filtros de segmento dicen si están activos', async () => {
    render(<App />);
    expect(await screen.findByRole('textbox', { name: 'Buscar cliente' })).toBeInTheDocument();
    const premium = screen.getByRole('button', { name: /^Premium:/ });
    expect(premium).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(premium);
    expect(premium).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^Todos:/ })).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('Ranking de clientes (FE-419)', () => {
  it('cabeceras botón con aria-sort y la fila abre el detalle con Enter o Espacio', () => {
    const onSelect = vi.fn();
    render(<RankingTable clients={[CLIENTE]} onSelect={onSelect} />);
    // Orden inicial: T descendente.
    expect(screen.getByRole('columnheader', { name: /^T/ })).toHaveAttribute('aria-sort', 'descending');
    fireEvent.click(screen.getByRole('button', { name: 'CLIENTE' }));
    const cabecera = screen.getByRole('columnheader', { name: /CLIENTE/ });
    expect(cabecera).toHaveAttribute('aria-sort', 'descending');
    expect(screen.getByRole('columnheader', { name: /^T/ })).not.toHaveAttribute('aria-sort');
    fireEvent.click(within(cabecera).getByRole('button'));
    expect(cabecera).toHaveAttribute('aria-sort', 'ascending');

    const fila = screen.getByRole('row', { name: 'Abrir el detalle de ACME SAS' });
    pulsar(fila, 'Enter');
    pulsar(fila, ' ');
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenCalledWith(CLIENTE);
  });
});

describe('Detalle del cliente (FE-419)', () => {
  const detalle = () => render(<CustomerDetail client={CLIENTE} config={DEFAULT_SCORING_CONFIG} extendedConfig={DEFAULT_EXTENDED_CONFIG} onBack={() => {}} />);

  it('Enter en un score abre su explicación como diálogo; Escape la cierra y el foco vuelve al score', () => {
    detalle();
    const score = screen.getByRole('button', { name: 'Score V (Valor): 70, ver qué significa' });
    pulsar(score, 'Enter');
    const dialogo = screen.getByRole('dialog', { name: 'Score de Valor (V)' });
    expect(dialogo).toHaveAttribute('aria-modal', 'true');
    expect(document.activeElement).toBe(within(dialogo).getByRole('button', { name: 'Cerrar' }));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(score);
  });

  it('el botón de información de una métrica tiene nombre y abre un diálogo con nombre', () => {
    detalle();
    fireEvent.click(screen.getByRole('button', { name: 'Rentabilidad' }));
    const info = screen.getByRole('button', { name: 'Qué es Margen Bruto %' });
    info.focus();
    fireEvent.click(info);
    const dialogo = screen.getByRole('dialog', { name: 'Margen Bruto %' });
    expect(document.activeElement).toBe(within(dialogo).getByRole('button', { name: 'Cerrar' }));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(info);
  });
});

describe('Ajustes (FE-419)', () => {
  it('cada casilla y cada campo numérico tiene nombre; la ayuda dice si está abierta', () => {
    render(<Settings config={DEFAULT_SCORING_CONFIG} extendedConfig={DEFAULT_EXTENDED_CONFIG} onSave={() => true} />);
    // La etiqueta ya visible se asocia a su casilla (clic en el texto la marca).
    expect(screen.getByLabelText('Incluir año actual (2026) en cálculos de ventas históricas')).toHaveAttribute('type', 'checkbox');
    expect(screen.getByRole('checkbox', { name: 'Aplicar candados de gating al asignar etiqueta de segmento' })).toBeInTheDocument();
    // Los umbrales repiten «Score V mínimo» en cada segmento: el nombre dice de cuál es.
    for (const seg of ['Premium', 'Valioso Condicionado', 'Estándar']) {
      expect(screen.getByRole('spinbutton', { name: `${seg}: score V mínimo` })).toBeInTheDocument();
      expect(screen.getByRole('spinbutton', { name: `${seg}: score P mínimo` })).toBeInTheDocument();
    }
    expect(screen.getByRole('spinbutton', { name: 'Score Total Estándar (V + P): peso Valor (V)' })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Score Total Extendido (V + P + S): peso Ventas (S)' })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Score de Valor (V): Gm Pct'})).toBeInTheDocument();
    // Ningún campo numérico se queda sin nombre.
    for (const campo of screen.getAllByRole('spinbutton')) {
      expect(campo).toHaveAccessibleName();
    }

    const ayuda = screen.getByRole('button', { name: 'Ver descripción de indicadores: Score de Pagos (P)' });
    expect(ayuda).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(ayuda);
    expect(ayuda).toHaveAttribute('aria-expanded', 'true');
  });
});
