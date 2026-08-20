# Requirements Document

## Introduction

El Dashboard del Portal Ambientalia actualmente es un directorio estático de enlaces a las apps del monorepo. Esta feature lo convierte en un panel de control operativo con widgets configurables: cada app del monorepo puede exportar sus propios componentes React como widgets, el usuario elige cuáles anclar en el dashboard, en qué posición y con qué tamaño, y la configuración se persiste por usuario. El sistema respeta el modelo de permisos existente basado en el campo `apps` del JWT, de modo que solo se pueden anclar widgets de apps asignadas al usuario.

## Glosario

- **Widget**: Componente React autocontenido exportado por una app del monorepo, que incluye su propia lógica de carga de datos, formateo y renderizado, y que puede montarse de forma independiente en el Dashboard del Portal.
- **WidgetDescriptor**: Contrato de interfaz TypeScript que toda app debe implementar para registrar un widget. Incluye los campos `id`, `appId`, `name`, `description`, `defaultSize` y `component`.
- **WidgetRegistry**: Módulo del Portal que agrega los `WidgetDescriptor` exportados por las apps asignadas al usuario actual y los expone al Dashboard.
- **Layout**: Posición y dimensiones (columna, fila, ancho en columnas, alto en filas) de cada widget anclado en el grid del Dashboard para un usuario dado.
- **LayoutConfig**: Estructura de datos que persiste el conjunto de widgets anclados y sus propiedades de Layout para un usuario.
- **Dashboard**: Página principal del Portal (`/`) que muestra el grid de widgets configurables del usuario.
- **Portal**: Aplicación `apps/portal` que actúa como host/grid y orquesta el montaje de las apps del monorepo.
- **AppGuard**: Componente del Portal que impide el acceso a rutas de apps no asignadas al usuario en el JWT.
- **Grid**: Área del Dashboard donde se renderizan y reposicionan los widgets mediante drag-and-drop y resize, implementada con `react-grid-layout`.
- **Modo Edición**: Estado del Dashboard en el que el usuario puede mover, redimensionar, añadir o eliminar widgets del grid.
- **Panel de Catálogo**: Componente del Dashboard que muestra los widgets disponibles (de apps asignadas) que aún no están anclados en el grid.
- **JWT**: Token de autenticación emitido por `hub-api` cuyo campo `apps` lista los IDs de apps asignadas al usuario.
- **localStorage**: Almacenamiento de clave-valor del navegador donde se persiste el `LayoutConfig` del usuario para el MVP.
- **appId**: Identificador string de una app del monorepo, coincidente con los valores del catálogo `APPS` en `apps/portal/src/lib/apps.ts` (p. ej. `"customer-valuation"`).

---

## Requerimientos

### Requerimiento 1: Contrato de Widget (`WidgetDescriptor`)

**User Story:** Como desarrollador de una app del monorepo, quiero implementar una interfaz tipada estándar para exponer widgets, de modo que el Portal pueda descubrirlos y montarlos sin conocer los internos de cada app.

#### Criterios de Aceptación

1. THE Portal SHALL exportar desde `apps/portal/src/widgets/types.ts` el tipo `WidgetDescriptor` con los campos obligatorios: `id: string`, `appId: string`, `name: string`, `description: string`, `defaultSize: { w: number; h: number }` y `component: React.ComponentType`.
2. THE Portal SHALL exportar desde `apps/portal/src/widgets/types.ts` el tipo `WidgetSize` definido como `{ w: number; h: number }` donde `w` y `h` son enteros positivos en el rango [1, 12].
3. WHEN una app exporta un array de `WidgetDescriptor` desde su punto de entrada de widgets, THE Portal SHALL ser capaz de importar ese array mediante un import dinámico lazy sin modificar el código del Portal para cada nueva app.
4. IF el campo `component` de un `WidgetDescriptor` no es un componente React válido al momento del registro, THEN THE WidgetRegistry SHALL omitir ese descriptor, registrar un error en consola que identifique el `id` y el `appId` del descriptor afectado, y continuar procesando los descriptores restantes sin interrumpir el arranque del Dashboard.
5. IF el campo `id` de un `WidgetDescriptor` coincide exactamente con el `id` de un descriptor ya registrado, THEN THE WidgetRegistry SHALL conservar la primera ocurrencia, descartar la duplicada, y registrar una advertencia en consola que identifique el `id` duplicado y el `appId` del descriptor descartado.
6. IF el import dinámico del módulo de widgets de una app falla o el módulo no exporta un array válido de `WidgetDescriptor`, THEN THE WidgetRegistry SHALL omitir todos los widgets de esa app, registrar un error en consola indicando la app afectada, y continuar cargando los módulos de las demás apps sin interrumpir el arranque del Dashboard.

---

### Requerimiento 2: WidgetRegistry — Agregación y Filtrado por Permisos

**User Story:** Como usuario del Portal, quiero que el Dashboard solo muestre widgets de las apps que tengo asignadas, de modo que no vea contenido al que no tengo acceso.

#### Criterios de Aceptación

1. THE WidgetRegistry SHALL exponer un hook `useWidgetRegistry(): WidgetDescriptor[]` que devuelva únicamente los widgets de apps cuyos `appId` estén incluidos en el array `apps` del JWT del usuario de la sesión activa.
2. WHEN el campo `apps` del JWT cambia (p. ej. por un nuevo login), THE WidgetRegistry SHALL recalcular la lista de widgets disponibles de forma sincrónica, de modo que el siguiente render del Dashboard ya refleje la lista actualizada.
3. WHILE el WidgetRegistry está cargando los módulos de widgets de forma asíncrona, THE Dashboard SHALL mostrar un spinner o esqueleto de grid en lugar del grid; IF la carga supera 10 segundos, THEN THE Dashboard SHALL mostrar un estado de error indicando que no fue posible cargar los widgets.
4. IF una app asignada no exporta un módulo de widgets, THEN THE WidgetRegistry SHALL omitir esa app sin interrumpir la carga del resto de módulos ni lanzar un error al usuario.
5. IF el array `apps` del JWT está ausente, el JWT está expirado, o el JWT no contiene el claim `apps`, THEN THE WidgetRegistry SHALL devolver un array vacío de widgets disponibles.
6. THE WidgetRegistry SHALL filtrar widgets de modo que el conjunto de apps accesibles via `useWidgetRegistry` sea idéntico al conjunto autorizado por `AppGuard` para el mismo JWT, usando los mismos `appId` del catálogo `APPS` de `apps/portal/src/lib/apps.ts`.

---

### Requerimiento 3: Grid Configurable — Drag, Resize y Layout

**User Story:** Como usuario del Portal, quiero reorganizar los widgets del dashboard arrastrándolos y redimensionándolos libremente, de modo que pueda construir una vista operativa adaptada a mis necesidades.

#### Criterios de Aceptación

1. THE Dashboard SHALL renderizar los widgets anclados en un grid de 12 columnas usando `react-grid-layout` con una altura de fila de 80px.
2. WHEN el Dashboard está en Modo Edición, THE Grid SHALL permitir al usuario mover cada widget arrastrándolo a una nueva posición dentro del grid.
3. WHEN el Dashboard está en Modo Edición, THE Grid SHALL permitir al usuario redimensionar cada widget usando el handle de resize con un tamaño mínimo de 2 columnas × 2 filas y un tamaño máximo de 12 columnas × 10 filas.
4. WHEN el usuario suelta un widget tras moverlo o redimensionarlo, THE Dashboard SHALL actualizar el Layout en memoria de forma inmediata y persistirlo en localStorage en un plazo máximo de 500 ms.
5. IF el Layout no puede ser persistido en localStorage tras un movimiento o redimensionado, THEN THE Dashboard SHALL mostrar un mensaje de error indicando que los cambios no pudieron guardarse, sin revertir la posición visual del widget.
6. WHEN el usuario arrastra un widget hasta el borde del grid, THE Grid SHALL impedir que el widget se coloque fuera del área de 12 columnas y lo reposicione en la última posición válida disponible.
7. WHILE el Dashboard NO está en Modo Edición, THE Grid SHALL deshabilitar el drag y el resize de todos los widgets.
8. THE Dashboard SHALL mostrar un botón "Editar Dashboard" que alterna entre Modo Edición activo e inactivo.
9. WHEN el Dashboard entra en Modo Edición, THE Grid SHALL mostrar en cada widget un handle de resize visible y un borde diferenciado que indique que el widget es arrastrable y redimensionable.
10. THE Dashboard SHALL ser responsivo: WHEN el ancho del viewport es inferior a 768px, THE Grid SHALL renderizar cada widget apilado verticalmente con ancho completo (12 columnas), ignorando el Layout guardado de columnas múltiples.

---

### Requerimiento 4: Añadir y Eliminar Widgets del Dashboard

**User Story:** Como usuario del Portal, quiero elegir qué widgets anclar en mi dashboard y poder eliminar los que no necesito, de modo que el panel muestre solo la información relevante para mí.

#### Criterios de Aceptación

1. WHILE el Dashboard está en Modo Edición, THE Dashboard SHALL mostrar un botón "Añadir Widget" visible en el área de controles del Dashboard.
2. WHEN el usuario activa el botón "Añadir Widget", THE Dashboard SHALL abrir el Panel de Catálogo mostrando únicamente los widgets del WidgetRegistry que no están anclados en el grid del usuario en ese momento.
3. WHEN el usuario selecciona un widget del Panel de Catálogo, THE Dashboard SHALL añadir ese widget al grid en la primera posición libre disponible usando el `defaultSize` definido en el WidgetRegistry para ese widget.
4. WHILE el Dashboard está en Modo Edición, THE Grid SHALL mostrar un botón de eliminar (×) en la esquina superior derecha de cada widget anclado en el grid.
5. WHEN el usuario pulsa el botón de eliminar (×) de un widget, THE Dashboard SHALL mostrar una confirmación antes de proceder con la eliminación.
6. WHEN el usuario confirma la eliminación de un widget, THE Dashboard SHALL remover ese widget del grid y persistir el Layout actualizado en localStorage dentro de los 500 ms siguientes a la confirmación.
7. IF el Layout persistido en localStorage no puede ser actualizado tras la eliminación, THEN THE Dashboard SHALL mostrar un mensaje de error indicando que los cambios no pudieron guardarse y revertir el widget al grid.
8. IF todos los widgets del WidgetRegistry ya están anclados en el grid del usuario, THEN THE Panel de Catálogo SHALL mostrar un mensaje indicando que no hay más widgets disponibles para añadir.
9. IF el grid no tiene ningún widget anclado, THEN THE Dashboard SHALL mostrar un estado vacío con instrucciones para añadir el primer widget mediante el botón "Añadir Widget".

---

### Requerimiento 5: Persistencia del Layout por Usuario

**User Story:** Como usuario del Portal, quiero que mi configuración del dashboard se recuerde entre sesiones, de modo que no tenga que reorganizar los widgets cada vez que accedo al portal.

#### Criterios de Aceptación

1. THE Dashboard SHALL usar la clave `dashboard_layout_{user_id}` en localStorage para almacenar el `LayoutConfig` del usuario, donde `user_id` proviene del campo `user_id` del JWT.
2. WHEN el usuario carga el Dashboard, THE Dashboard SHALL leer el `LayoutConfig` de localStorage y restaurar los widgets anclados con sus posiciones y tamaños guardados.
3. WHEN un widget anclado en el `LayoutConfig` guardado ya no está disponible (porque la app fue desasignada del usuario), THE Dashboard SHALL omitir silenciosamente ese widget al restaurar el layout.
4. WHEN el usuario modifica el layout (mueve, redimensiona, añade o elimina widgets), THE Dashboard SHALL persistir el `LayoutConfig` actualizado en localStorage en un plazo máximo de 2 segundos tras la última modificación, usando debounce.
5. IF el valor en localStorage bajo la clave del usuario no puede ser parseado como JSON o no contiene los campos `widgets` (array) y `version` (número), THEN THE Dashboard SHALL ignorarlo y presentar un dashboard vacío sin mostrar un error al usuario.
6. THE Dashboard SHALL serializar y deserializar el `LayoutConfig` como JSON de forma que los campos `widgets`, `version`, y las propiedades de posición y tamaño de cada widget (columna, fila, ancho, alto) se preserven sin pérdida tras un ciclo `JSON.parse(JSON.stringify(layoutConfig))`.

---

### Requerimiento 6: Renderizado Aislado de Widgets

**User Story:** Como usuario del Portal, quiero que un error en un widget no derrumbe todo el dashboard, de modo que el resto de la información siga visible.

#### Criterios de Aceptación

1. THE Dashboard SHALL envolver cada widget anclado en un `ErrorBoundary` independiente de React.
2. WHEN un widget lanza un error durante el renderizado, THE ErrorBoundary SHALL mostrar en el espacio del widget un estado de error que incluya el nombre del widget y la descripción del error, sin desmontar ni afectar a los demás widgets del grid.
3. WHEN un widget lanza un error durante el renderizado, THE ErrorBoundary SHALL invocar `captureError` con el contexto `{ widgetId, appId }` antes de renderizar el estado de error.
4. THE Dashboard SHALL cargar el componente de cada widget de forma lazy mediante `React.lazy`, de modo que el código del widget solo se descargue cuando ese widget vaya a ser montado en el grid.
5. WHILE el componente de un widget se está cargando de forma lazy, THE Grid SHALL mostrar un skeleton placeholder que ocupe el mismo número de columnas y filas del grid asignadas a ese widget.
6. IF la carga lazy del componente de un widget falla (error de red o módulo no encontrado), THEN THE ErrorBoundary SHALL mostrar el estado de error localizado para ese widget sin afectar a los demás widgets del grid.

---

### Requerimiento 7: Compatibilidad con el Dashboard Estático Existente

**User Story:** Como usuario del Portal, quiero que el nuevo dashboard configurable coexista con el directorio de apps existente, de modo que no pierda acceso a la navegación rápida a las apps mientras adopto los widgets.

#### Criterios de Aceptación

1. IF el grid de widgets no tiene ningún widget anclado, THEN THE Dashboard SHALL mostrar el directorio de apps (herramientas y aplicaciones) en la posición principal, expandido por defecto.
2. WHEN el grid de widgets tiene al menos un widget anclado, THE Dashboard SHALL mostrar el grid de widgets en la posición principal (superior) y el directorio de apps en una sección colapsable secundaria; el estado expandido o colapsado de esa sección SHALL persistir en localStorage entre sesiones.
3. THE Dashboard SHALL respetar el filtrado de permisos existente basado en `isRouteAssigned` para el directorio de apps, preservando su posición, contenido y comportamiento sin modificaciones.
4. THE Dashboard SHALL mantener el encabezado de bienvenida, la barra de búsqueda y el footer de estado del sistema existentes en el nuevo layout, preservando su posición, contenido y comportamiento sin modificaciones.
5. IF el valor de estado colapsado/expandido del directorio de apps en localStorage no puede ser leído, THEN THE Dashboard SHALL mostrar el directorio expandido por defecto.

