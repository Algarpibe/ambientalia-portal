# Plan de Implementación: Dashboard Widgets

## Overview

Transforma el Dashboard estático del Portal en un panel de control operativo con widgets configurables. El orden de implementación sigue el grafo de dependencias del diseño: tipos → registry → hooks → componentes base → Dashboard modificado → stubs de apps. La feature usa TypeScript a lo largo de todo el monorepo.

## Tasks

- [ ] 1. Instalar dependencias y definir tipos base
  - [ ] 1.1 Instalar `react-grid-layout` y `@types/react-grid-layout`
    - Ejecutar `npm install react-grid-layout@1.5.0` en `apps/portal`
    - Ejecutar `npm install --save-dev @types/react-grid-layout@1.3.0` en `apps/portal`
    - `fast-check@3` se instala solo cuando se aborden los tests de propiedad (diferidos, tareas `*`)
    - _Requirements: 3.1_

  - [ ] 1.2 Crear `apps/portal/src/widgets/types.ts` con todos los tipos e invariantes
    - Definir `WidgetSize`, `WidgetDescriptor`, `LayoutItem`, `LayoutConfig`
    - Implementar `isValidWidgetSize`, `isValidReactComponent`, `isValidLayoutConfig` tal como se especifica en el diseño
    - _Requirements: 1.1, 1.2, 5.6_

  - [ ]* 1.3 Escribir tests de propiedad para `types.ts`
    - **Property 8: Serialización round-trip de LayoutConfig es sin pérdida**
    - **Validates: Requirements 5.6**
    - **Property 10: Parsing defensivo de LayoutConfig corrupto**
    - **Validates: Requirements 5.5**
    - **Property 12: Validación de WidgetSize acepta exactamente el rango [1, 12]**
    - **Validates: Requirements 1.2**
    - Archivo: `apps/portal/src/widgets/types.test.ts`
    - _Requirements: 1.2, 5.5, 5.6_

- [ ] 2. Crear el registro de factories y extender Sentry
  - [ ] 2.1 Crear `apps/portal/src/widgets/registry.ts` con el mapa `WIDGET_FACTORIES`
    - **Piloto:** registrar SOLO las apps que ya tienen `src/widgets/index.ts` implementado.
      En Fase 1 eso es únicamente `customer-profitability`. Cada nueva app se añade con una
      línea cuando implemente sus widgets (tarea 9.4).
    - Cada entrada es `() => import('../../{app-dir}/src/widgets/index')`
    - > Registrar un `appId` cuyo módulo de widgets aún no existe rompería el build de Vite
      >   (import estático no resoluble), por eso el mapa arranca solo con el piloto.
    - _Requirements: 1.3_

  - [ ] 2.2 Extender `apps/portal/src/sentry.ts` con `captureWidgetError`
    - Añadir la función `captureWidgetError(error: unknown, context: { widgetId: string; appId: string }): void`
    - Implementar usando `Sentry.withScope` + `scope.setContext('widget', context)` tal como describe el diseño
    - Mantener la función `captureError` existente sin modificaciones
    - _Requirements: 6.3_

- [ ] 3. Implementar `useWidgetRegistry`
  - [ ] 3.1 Crear `apps/portal/src/hooks/useWidgetRegistry.ts`
    - Implementar la máquina de estados `RegistryState` (`loading` | `ready` | `error`)
    - Leer `apps[]` del JWT via `useAuth()` y filtrar con `WIDGET_FACTORIES`
    - Lanzar `Promise.allSettled` con timeout de 10 s via `Promise.race`
    - Validar cada descriptor (componente válido, sin duplicados), deduplicar por `id`, loguear errores/advertencias
    - Re-ejecutar cuando cambia `apps` (dependencia del efecto)
    - _Requirements: 1.4, 1.5, 1.6, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [ ]* 3.2 Escribir tests de propiedad para `useWidgetRegistry`
    - **Property 1: Aislamiento de fallos en la carga del registry**
    - **Validates: Requirements 1.4, 1.6, 2.4**
    - **Property 2: Deduplicación conserva la primera ocurrencia**
    - **Validates: Requirements 1.5**
    - **Property 3: Filtrado de widgets por permisos JWT es idéntico al de AppGuard**
    - **Validates: Requirements 2.1, 2.5, 2.6**
    - Archivo: `apps/portal/src/hooks/useWidgetRegistry.test.ts`
    - Mockear `WIDGET_FACTORIES` y `useAuth` en los tests
    - _Requirements: 1.4, 1.5, 1.6, 2.1, 2.4, 2.5, 2.6_

- [ ] 4. Implementar `useDashboardLayout`
  - [ ] 4.1 Crear `apps/portal/src/hooks/useDashboardLayout.ts`
    - Implementar la interfaz `DashboardLayoutHook` completa
    - Lectura inicial desde `localStorage` con `isValidLayoutConfig`; inicializar vacío si inválido
    - Debounce de 2 s con `useRef` para persistencia; activar `persistError` si `setItem` falla
    - Implementar `addWidget` con algoritmo de packing (primera posición libre sin superposición)
    - Implementar `removeWidget`, `onLayoutChange`
    - Manejar `userId === null` devolviendo estado vacío
    - _Requirements: 3.4, 4.3, 4.6, 5.1, 5.2, 5.4, 5.5_

  - [ ]* 4.2 Escribir tests de propiedad para `useDashboardLayout`
    - **Property 4: Toda mutación de layout se persiste en localStorage**
    - **Validates: Requirements 3.4, 4.6, 5.4**
    - **Property 6: Añadir widget usa la primera posición libre con defaultSize**
    - **Validates: Requirements 4.3**
    - **Property 7: La clave de localStorage incorpora el user_id**
    - **Validates: Requirements 5.1**
    - **Property 9: Reconciliación filtra widgets de apps desasignadas**
    - **Validates: Requirements 5.3**
    - Archivo: `apps/portal/src/hooks/useDashboardLayout.test.ts`
    - Mockear `localStorage` con `vitest` stubs
    - _Requirements: 3.4, 4.3, 4.6, 5.1, 5.3, 5.4_

- [ ] 5. Checkpoint — Validar la capa de datos
  - Asegurarse de que todos los tests de `types.ts`, `useWidgetRegistry` y `useDashboardLayout` pasan (`npm test` en `apps/portal`)
  - Verificar que TypeScript compila sin errores (`tsc -b --noEmit`)
  - Consultar al usuario si hay dudas antes de continuar con los componentes

- [ ] 6. Implementar componentes base de UI
  - [ ] 6.1 Crear `apps/portal/src/components/WidgetSkeleton.tsx`
    - Componente `<div>` con `animate-pulse bg-gray-200 rounded-2xl w-full h-full`
    - _Requirements: 6.5_

  - [ ] 6.2 Crear `apps/portal/src/components/WidgetErrorBoundary.tsx`
    - Class component con `getDerivedStateFromError` y `componentDidCatch`
    - En `componentDidCatch`: invocar `captureWidgetError(error, { widgetId, appId })` de `sentry.ts`
    - Fallback UI: tarjeta `bg-red-50 border border-red-200 rounded-2xl p-4` con icono `AlertTriangle` de lucide-react, nombre del widget y mensaje del error
    - Props: `widgetId`, `appId`, `widgetName?`, `children`
    - _Requirements: 6.1, 6.2, 6.3, 6.6_

  - [ ]* 6.3 Escribir tests de propiedad para `WidgetErrorBoundary`
    - **Property 11: Aislamiento de errores — un widget que falla no afecta a los demás**
    - **Validates: Requirements 6.2, 6.3, 6.6**
    - Archivo: `apps/portal/src/components/WidgetErrorBoundary.test.tsx`
    - Usar `fc.integer({ min: 2, max: 10 })` para N widgets y `fc.integer(...)` para K (widget que falla)
    - _Requirements: 6.2, 6.3, 6.6_

  - [ ] 6.4 Crear `apps/portal/src/components/WidgetCell.tsx`
    - Envolver en `<WidgetErrorBoundary widgetId={...} appId={...}>`
    - Dentro del boundary: `<Suspense fallback={<WidgetSkeleton />}>`
    - Crear componente lazy con `React.lazy(() => Promise.resolve({ default: descriptor.component }))`
    - En `editMode`: botón `×` con `position: absolute; top: 4px; right: 4px` que llama `onRemove`
    - _Requirements: 6.4, 6.5, 4.4_

  - [ ] 6.5 Crear `apps/portal/src/components/WidgetGrid.tsx`
    - Usar `<ResponsiveGridLayout>` de `react-grid-layout` con `breakpoints`, `cols`, `rowHeight=80`
    - `isDraggable={editMode}`, `isResizable={editMode}`
    - Data-grid por item: `{ i: widgetId, x, y, w, h, minW: 2, minH: 2, maxW: 12, maxH: 10 }`
    - En `editMode`: aplicar `ring-2 ring-blue-400` a cada celda
    - Importar CSS de react-grid-layout (`react-grid-layout/css/styles.css` y `react-resizable/css/styles.css`)
    - _Requirements: 3.1, 3.2, 3.3, 3.6, 3.7, 3.9, 3.10_

  - [ ]* 6.6 Escribir test de ejemplo para `WidgetGrid`
    - Verificar `cols=12` y `rowHeight=80`
    - Verificar `isDraggable/isResizable` según `editMode`
    - **Property 5: Responsive — viewport móvil aplana el layout**
    - **Validates: Requirements 3.10**
    - Archivo: `apps/portal/src/components/WidgetGrid.test.tsx`
    - _Requirements: 3.1, 3.2, 3.7, 3.10_

  - [ ] 6.7 Crear `apps/portal/src/components/CatalogPanel.tsx`
    - Slide-over lateral derecho: `fixed inset-y-0 right-0 w-80 bg-white shadow-xl z-50 transform transition-transform`
    - Listar `availableWidgets` agrupados por `appId`, mostrando nombre, descripción y `defaultSize`
    - Botón "Añadir" por widget: llama `onAddWidget(descriptor)` y cierra el panel
    - Overlay semitransparente para cerrar al hacer click fuera
    - Si `availableWidgets.length === 0`: mostrar mensaje "No hay más widgets disponibles para añadir."
    - _Requirements: 4.1, 4.2, 4.8_

- [ ] 7. Checkpoint — Validar componentes base antes de modificar Dashboard
  - Asegurarse de que todos los tests de componentes base pasan
  - Verificar compilación TypeScript sin errores
  - Consultar al usuario si hay dudas antes de modificar `Dashboard.tsx`

- [ ] 8. Modificar `apps/portal/src/pages/Dashboard.tsx`
  - [ ] 8.1 Integrar hooks y estado de controles del dashboard
    - Añadir `useWidgetRegistry()` y `useDashboardLayout(user_id)` al componente
    - Añadir estado local: `editMode`, `catalogOpen`, `confirmDelete`, `directorioExpanded`
    - Leer y persistir `directorioExpanded` en `localStorage` bajo `dashboard_apps_expanded_{user_id}`
    - Si `localStorage` no puede leerse, `directorioExpanded = true` por defecto (Req 7.5)
    - Renderizar spinner/skeleton cuando `registryState.status === 'loading'` (Req 2.3)
    - Renderizar banner de error cuando `registryState.status === 'error'` (Req 2.3)
    - _Requirements: 2.3, 3.8, 7.4, 7.5_

  - [ ] 8.2 Implementar grid de widgets, estado vacío y controles de edición
    - Botón "Editar Dashboard" que alterna `editMode`
    - Botón "Añadir Widget" visible solo en `editMode` (Req 4.1)
    - Banner de error de persistencia cuando `persistError !== null` (Req 3.5)
    - Si `anchoredWidgetIds.size === 0`: renderizar `<EmptyGridState>` con instrucciones (Req 4.9)
    - Si `anchoredWidgetIds.size > 0`: renderizar `<WidgetGrid>` con los handlers de layout
    - En `editMode`, mostrar botón `×` por widget; al pulsarlo, setear `confirmDelete = widgetId` (Req 4.4, 4.5)
    - _Requirements: 3.8, 3.9, 4.1, 4.4, 4.5, 4.9_

  - [ ] 8.3 Implementar confirmación de eliminación y reconciliación de layout
    - Dialog de confirmación inline (`<dialog>` nativo) cuando `confirmDelete !== null`
    - Al confirmar: llamar `removeWidget`, limpiar `confirmDelete` (Req 4.6, 4.7)
    - Reconciliación: en `useEffect` sobre `registryState`, filtrar `layoutItems` descartando widgets cuyo `appId` ya no esté en el registry (Req 5.3)
    - _Requirements: 4.5, 4.6, 4.7, 5.3_

  - [ ] 8.4 Integrar directorio de apps existente como sección colapsable
    - Cuando `anchoredWidgetIds.size > 0`: envolver el directorio (herramientas + aplicaciones) en `<CollapsibleSection>` con toggle de `directorioExpanded` (Req 7.2)
    - Cuando `anchoredWidgetIds.size === 0`: mostrar directorio expandido en posición principal (Req 7.1)
    - Preservar sin cambios: filtrado `isRouteAssigned`, cards de apps, header de bienvenida, barra de búsqueda (Req 7.3, 7.4)
    - **Ajuste:** ELIMINAR el footer de stats inventado (`Core Engine: Operational`, `Last Sync: 2m ago`,
      `5 Apps Integrated`) — son datos falsos, coherente con la limpieza ya hecha en Aplicaciones.
      (Sustituye la parte de "footer de stats" del Req 7.4.)
    - Renderizar `<CatalogPanel>` y el dialog de confirmación al final del `<main>` (Req 4.2)
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [ ]* 8.5 Escribir tests de ejemplo para `Dashboard.tsx`
    - Cubrir: toggle `editMode`, "Añadir Widget" visible solo en editMode, botones `×` en editMode
    - Cubrir: spinner cuando `status === 'loading'`, banner cuando `status === 'error'`, estado vacío sin widgets
    - Cubrir: directorio expandido por defecto cuando grid vacío; directorio colapsable cuando hay widgets
    - Cubrir: `isRouteAssigned` aplicado sin modificaciones al directorio
    - Archivo: `apps/portal/src/pages/Dashboard.test.tsx`
    - _Requirements: 2.3, 3.8, 4.1, 4.4, 4.9, 7.1, 7.2, 7.3_

- [ ] 9. Widgets reales del piloto: `customer-profitability`
  > **Ajuste de alcance (Fase 1).** En lugar de crear 8 stubs vacíos, el piloto entrega
  > **widgets reales** de la única app con datos+gráficos listos (`customer-profitability`),
  > para que al terminar la Fase 1 el dashboard muestre gráficos de verdad y no cajas vacías.
  > Las otras 7 apps se suman después replicando este patrón; hasta entonces NO se registran
  > en `registry.ts` (evita imports a módulos inexistentes que romperían el build de Vite).

  - [ ] 9.1 Crear la capa de datos del widget en `customer-profitability`
    - `src/widgets/analysis.ts`: función pura `analyze(sales, products)` que reproduce el
      cálculo de agregación del `Dashboard` existente (totalSales, totalMargin, marginPercent,
      brands[], customers[]). No modificar el `Dashboard` monolito existente.
    - `src/widgets/useProfitabilityData.ts`: hook que hace `fetch('/api/profitability/data')`
      con `Authorization: Bearer` desde `ambientalia_token` (mismo patrón que `App.tsx`),
      devuelve `{ sales, products, loading, error, reload }`.
    - _Requirements: 1.1, 1.3_

  - [ ] 9.2 Crear los componentes de widget autocontenidos
    - `src/widgets/SummaryWidget.tsx`: KPIs de facturación, margen y % margen.
    - `src/widgets/TopBrandsWidget.tsx`: `BarChart` (recharts) de top marcas por ventas.
    - Cada uno gestiona sus propios estados loading/error/vacío; sin props del Portal.
    - _Requirements: 1.1_

  - [ ] 9.3 Crear `apps/customer-profitability/src/widgets/index.ts`
    - Exportar por defecto `WidgetDescriptor[]` con los dos widgets (`appId: 'customer-profitability'`).
    - Registrar `customer-profitability` en `WIDGET_FACTORIES` de `registry.ts`.
    - _Requirements: 1.3_

  - [ ]* 9.4 (Diferido) Replicar el patrón en las demás apps (`payment-reconciliation`, etc.)
    - Cada app crea su `src/widgets/index.ts` + se añade su línea en `registry.ts`.
    - _Requirements: 1.3_

- [ ] 10. Checkpoint final — Verificar integración completa
  - Ejecutar `npm test` en `apps/portal` y asegurarse de que todos los tests pasan
  - Ejecutar `tsc -b --noEmit` en `apps/portal` para confirmar que no hay errores de tipos
  - Consultar al usuario si quedan dudas antes de cerrar la feature

## Notes

- **Ajuste de alcance Fase 1 (piloto):** las tareas de test de propiedad (`*`) quedan **diferidas**
  para no frenar el MVP; se retoman tras validar el piloto. El registry arranca solo con
  `customer-profitability` (única app con widgets reales en Fase 1). El footer de stats inventado
  del Dashboard se elimina en la tarea 8.4.
- Las tareas marcadas con `*` son opcionales y pueden omitirse para un MVP más rápido
- Cada tarea referencia requerimientos específicos para trazabilidad
- Los checkpoints (tareas 5, 7, 10) garantizan validación incremental antes de modificar componentes críticos
- Los tests de propiedad usan `fast-check@3` con mínimo 100 iteraciones (`{ numRuns: 100 }`)
- Los tests unitarios y de propiedad son complementarios; cada propiedad del diseño tiene su propia sub-tarea
- `captureWidgetError` reemplaza `captureError` en el boundary de widgets; `captureError` permanece sin cambios
- Los stubs de widgets (tarea 9) son el punto de extensión que cada equipo de app debe completar

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "2.1", "2.2"] },
    { "id": 2, "tasks": ["3.1"] },
    { "id": 3, "tasks": ["3.2", "4.1"] },
    { "id": 4, "tasks": ["4.2", "6.1", "6.2"] },
    { "id": 5, "tasks": ["6.3", "6.4"] },
    { "id": 6, "tasks": ["6.5", "6.7"] },
    { "id": 7, "tasks": ["6.6", "8.1"] },
    { "id": 8, "tasks": ["8.2", "9.1", "9.2", "9.3", "9.4", "9.5", "9.6", "9.7", "9.8"] },
    { "id": 9, "tasks": ["8.3", "8.4"] },
    { "id": 10, "tasks": ["8.5"] }
  ]
}
```
