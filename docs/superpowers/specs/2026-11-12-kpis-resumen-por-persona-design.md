# Ausencias — KPIs: resumen por persona

**Fecha:** 2026-11-12
**Estado:** diseño aprobado en brainstorming; pendiente de plan de implementación
**Depende de:** el panel de KPIs de Vacaciones y Permisos (`apps/ausencias/src/PanelKpis.tsx`,
`apps/hub-api/src/ausencias/service/kpis.ts`, `kpis.ts`, `repo/kpis.ts`), en producción.

## 1. Objetivo

Una tabla en la pestaña KPIs con una fila por trabajador y lo que ha tenido de cada tipo de
ausencia en el periodo elegido: vacaciones, permisos, compensatorios e incapacidades.

## 2. Decisiones (cerradas en brainstorming)

- **Unidad:** días laborables para vacaciones, compensatorios e incapacidades. Los permisos
  en horas, porque se suelen pedir por horas.
- **Permisos sin horas** (los de día completo y todos los anteriores a la migración 036 o
  importados de la hoja): se cuentan **aparte**, en días laborables, y la celda los enseña
  juntos: «6,5 h + 2 d». No se inventa una jornada: la app no la conoce y convertir días a
  horas exigiría suponer una.
- **Filtro:** el selector «Periodo» que ya tiene el panel (`?year=`). Con un año, ese año
  natural; con «Últimos 12 meses», la misma ventana que el resto del panel. Un solo selector:
  nunca dos periodos distintos en pantalla.

## 3. Datos y cálculo (hub-api)

- **Sin consulta nueva.** `repo.ausenciasParaKpi` —la de la gráfica de estacionalidad— ya
  devuelve lo que ocupa agenda (aprobadas e incapacidades registradas; sin pendientes, sin
  anuladas, sin otorgamientos) con persona, tipo y fechas, e incluye fichas de baja. Se le
  añaden `hora_inicio` y `hora_fin` (`TIME`, solo en permisos con hora).
- Esa consulta se pide con la ventana de estacionalidad, que siempre contiene la del periodo
  (24 meses frente a 12, o el mismo año). El resumen recorta a la ventana `general` en el
  motor, como hace la gráfica.
- **Función pura nueva `resumenPorPersona`** en `apps/hub-api/src/ausencias/kpis.ts`:
  - Vacaciones, compensatorios e incapacidades: días laborables dentro de la ventana, con el
    mismo reparto que `tramosPorMes` (una ausencia que cruza el cambio de año solo suma lo que
    cae dentro). Se reutiliza esa aritmética, no se reescribe.
  - Permisos con hora: `hora_fin − hora_inicio` en horas, con un decimal, si su fecha cae
    dentro de la ventana.
  - Permisos sin hora: días laborables dentro de la ventana, en un contador aparte.
  - **Filas:** toda la plantilla activa (la lista que el servicio ya carga para el pasivo),
    aunque no tenga nada; más las fichas de baja que tuvieron alguna ausencia en la ventana,
    marcadas `deBaja: true`. Orden alfabético español (`localeCompare(…, 'es')`, el mismo
    criterio que `ordenarNombres`). Se agrupa por id, no por nombre: dos personas pueden
    llamarse igual.
  - **Totales** de cada columna, calculados en el servidor para que la fila de total no pueda
    discrepar de las de arriba.
- **Respuesta:** un campo nuevo en `Kpis`:

  ```ts
  resumenPorPersona: {
    filas: {
      empleadoId: string;
      nombreCompleto: string;
      deBaja: boolean;
      vacaciones: number;      // días laborables
      permisoHoras: number;    // horas, un decimal
      permisoDias: number;     // días laborables de permisos sin hora
      compensatorio: number;   // días laborables
      incapacidad: number;     // días laborables
    }[];
    total: { vacaciones; permisoHoras; permisoDias; compensatorio; incapacidad };
  }
  ```

  Mismo endpoint (`GET /api/ausencias/kpis`) y mismo candado (`ve_kpis` o admin).

## 4. Pantalla (apps/ausencias)

- Sección nueva **«Resumen por persona»** en `PanelKpis.tsx`, justo debajo de «Cuándo se
  concentran las ausencias». El rótulo dice el periodo («en 2025», «en los últimos 12
  meses») a partir de `anio` de la respuesta.
- Columnas: Nombre · Vacaciones (días) · Permisos · Compensatorios (días) · Incapacidades
  (días). Números a la derecha con `tabular-nums`; cero = «—». Fila de total al final, en
  negrita. Las fichas de baja con «(de baja)» tras el nombre.
- Celda de permisos: «6,5 h», «2 d» o «6,5 h + 2 d»; «—» si las dos son cero. El formato vive
  en una función pura con tests (la app no tiene tests de componentes).
- Debajo, una línea: solo cuentan solicitudes aprobadas e incapacidades registradas; no entran
  pendientes, anuladas ni compensatorios concedidos.
- En móvil, la tabla se desplaza en horizontal dentro de su recuadro (`overflow-x-auto`); la
  página no.
- Si la respuesta no trae `resumenPorPersona` (portal desplegado antes que hub-api), la
  sección no se pinta.

## 5. Verificación

- Unitarios de `resumenPorPersona`: reparto en el cambio de año, horas frente a días
  completos, permiso con hora fuera de la ventana, fichas activas sin nada, fichas de baja
  con y sin ausencias, dos personas con el mismo nombre, totales.
- BD: `ausenciasParaKpi` devuelve `horaInicio`/`horaFin` de un permiso con hora y `null` en
  el resto.
- Front: tests del formato de la celda de permisos; `tsc` + `vite build`.
- Candados falsados rompiendo el código de verdad.

## 6. Despliegue

hub-api primero, portal después. Con solo hub-api, la respuesta trae un campo más que nadie
pinta.

## 7. Fuera de alcance

- Ordenar por columna, exportar la tabla, desglose por mes.
- Convertir días a horas (exigiría una jornada que la app no tiene).
