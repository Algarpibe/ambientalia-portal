import type { ComponentType } from 'react';

// Contrato de widgets del Dashboard configurable (feature: dashboard-widgets).
// Es la única frontera de acoplamiento entre una app del monorepo y el Portal:
// cada app exporta un array de WidgetDescriptor desde su src/widgets/index.ts y
// el Portal los descubre vía import dinámico (ver widgets/registry.ts).

// ─── Dimensiones de un widget ────────────────────────────────────────────────

/** Ancho y alto en unidades de columnas/filas del grid. w y h ∈ [1, 12]. */
export interface WidgetSize {
  w: number; // columnas
  h: number; // filas
}

/** Valida que un WidgetSize sea un par de enteros en [1, 12]. */
export function isValidWidgetSize(size: unknown): size is WidgetSize {
  if (!size || typeof size !== 'object') return false;
  const { w, h } = size as Record<string, unknown>;
  return (
    typeof w === 'number' && Number.isInteger(w) && w >= 1 && w <= 12 &&
    typeof h === 'number' && Number.isInteger(h) && h >= 1 && h <= 12
  );
}

// ─── Contrato de un widget ───────────────────────────────────────────────────

/**
 * Contrato que cada app del monorepo debe implementar para registrar widgets.
 * Se exporta como array default desde src/widgets/index.ts de cada app.
 */
export interface WidgetDescriptor {
  /** Identificador único global del widget. Debe ser único en todo el monorepo. */
  id: string;
  /** Debe coincidir con el id de la app en el catálogo APPS de lib/apps.ts. */
  appId: string;
  /** Nombre legible que se muestra en el CatalogPanel y en el título del widget. */
  name: string;
  /** Descripción corta del widget (máx. recomendado: 120 caracteres). */
  description: string;
  /** Dimensiones por defecto al añadir el widget al grid. */
  defaultSize: WidgetSize;
  /**
   * Componente React del widget. No recibe props del Portal: gestiona su propia
   * carga de datos, formateo y renderizado. El Portal lo envuelve en Suspense +
   * ErrorBoundary.
   */
  component: ComponentType;
}

/** Valida que un valor sea un ComponentType React (función o clase). */
export function isValidReactComponent(value: unknown): value is ComponentType {
  return typeof value === 'function';
}

/** Valida la forma mínima de un WidgetDescriptor cargado de un módulo de app. */
export function isValidWidgetDescriptor(value: unknown): value is WidgetDescriptor {
  if (!value || typeof value !== 'object') return false;
  const d = value as Record<string, unknown>;
  return (
    typeof d.id === 'string' && d.id.length > 0 &&
    typeof d.appId === 'string' && d.appId.length > 0 &&
    typeof d.name === 'string' &&
    typeof d.description === 'string' &&
    isValidWidgetSize(d.defaultSize) &&
    isValidReactComponent(d.component)
  );
}

// ─── Layout ──────────────────────────────────────────────────────────────────

/** Una entrada del layout de react-grid-layout enriquecida con widgetId. */
export interface LayoutItem {
  widgetId: string; // referencia al WidgetDescriptor.id
  x: number;        // columna de inicio (0-based)
  y: number;        // fila de inicio (0-based)
  w: number;        // ancho en columnas
  h: number;        // alto en filas
}

/**
 * Estructura que se serializa y deserializa desde localStorage.
 * Clave: dashboard_layout_{user_id}
 */
export interface LayoutConfig {
  /** Versión del schema. Incrementar si el modelo de datos cambia. */
  version: number;
  /** Lista de widgets anclados con su posición y tamaño en el grid. */
  widgets: LayoutItem[];
}

/** Versión actual del schema de LayoutConfig. */
export const LAYOUT_SCHEMA_VERSION = 1;

/**
 * Valida que un valor parseado de JSON sea un LayoutConfig válido.
 * Devuelve false si faltan campos obligatorios o los tipos son incorrectos.
 */
export function isValidLayoutConfig(value: unknown): value is LayoutConfig {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.version === 'number' && Array.isArray(v.widgets);
}
