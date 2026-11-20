# Equipos en taller — «Mis equipos» al entrar desde el celular (diseño)

Fecha: 19/11/2026. Estado: aprobado por el dueño, pendiente de plan. Antecedentes: el tablero kanban (cambio SDD `tablero-kanban-taller`, specs en `openspec/specs/taller-*`) y el Responsable asignado desde la tabla (`docs/superpowers/specs/2026-11-19-equipos-responsable-design.md`).

## Por qué

El modelo de vista para el usuario del PDF de diseño (`apps/equipos-taller/diseño-kanban/`, fuera de git) ya está construido como «Mis equipos» en `/equipos-taller/mis-equipos` (`apps/equipos-taller/src/MisEquipos.tsx`). Le faltan dos cosas para lo que se pide:

1. **No hay forma de llegar a esa vista.** Ningún menú ni botón enlaza a ella. Quien abre «Equipos en taller» en el celular ve la tabla de escritorio.
2. **No muestra solo lo suyo.** «Cambiar» y «¿Quién eres?» dejan ver los equipos de otro técnico eligiendo su nombre de Desk.

## Decisiones

- **D1. Entrada automática.** Al abrir la app en un celular se muestra «Mis equipos» directamente.
- **D2. Celular = pantalla de menos de 768 px.** Se decide con `matchMedia('(max-width: 767px)')` al abrir la app. Se descarta detectar el tipo de navegador porque esa información es cada vez menos fiable. Una ventana de escritorio muy estrecha también salta; desde «Mis equipos» se vuelve a la tabla.
- **D3. Solo salta si la dirección no elige vista.** Con `?vista=` en la dirección, la app respeta esa vista en cualquier ancho. Así no hay bucles y quien elige la tabla en el celular se queda en ella aunque recargue.
- **D4. Solo lo suyo.** Las tarjetas de un usuario son:
  - las que le asignaron en el portal (por su cuenta, `tecnico.userId`);
  - las que tienen como Encargado de Desk un nombre que coincide con el suyo **sin ambigüedad** (`coincideTecnico` con un único nombre del tablero).

  Desaparecen «Cambiar», «¿Quién eres?» y el nombre recordado en el dispositivo. Si a alguien no le sale nada porque su nombre de Desk es distinto, la vía es asignarle sus equipos desde la tabla con el Responsable.
- **D5. «Escanear S/N» y «Ver taller completo» no cambian.** Siguen mostrando cualquier equipo del taller, como en el modelo. «Solo lo suyo» se refiere a la lista que aparece al entrar, no es una restricción de seguridad: cualquiera con la app ve la tabla completa.
- **D6. Siguen fuera los botones de acción y la cámara** («Cliente aprobó → En proceso», «Subir remisión firmada»). Escriben en Desk 2.0, que el portal solo puede leer. Llegarán con el cambio futuro de escritura en Desk.

## Entrada desde el celular (`apps/equipos-taller/src/App.tsx`)

- Al montar la app, si la dirección no tiene `vista` y la pantalla mide menos de 768 px, se navega a `/equipos-taller/mis-equipos` **sustituyendo** la entrada del historial (`replace`). «Atrás» vuelve a donde estaba el usuario.
- La comprobación se hace una sola vez, al abrir. Girar el teléfono o cambiar el ancho de la ventana después no mueve a nadie.
- El botón «Tabla» pasa a escribir `?vista=tabla` en lugar de borrar el parámetro. `?vista=tablero` sigue igual. Cualquier otro valor, o ninguno, se lee como tabla, como hoy (salvo el salto de D1 cuando no hay parámetro).
- A la tabla se llega desde «Mis equipos» como en el modelo: «Ver taller completo» abre `?vista=tablero` y desde ahí está el botón «Tabla». No se añaden botones.

## «Mis equipos» (`apps/equipos-taller/src/MisEquipos.tsx`)

- **Filtro:** `esMia(t, { userId, nombre: reconocido })`, donde `reconocido` es el único nombre del tablero que casa con el del usuario, o `null` si no casa ninguno o casan varios.
- **Se quitan:**
  - el componente `Selector` («¿Quién eres?») y el botón «Cambiar»;
  - la lectura y escritura de `CLAVE_TECNICO` en `localStorage`. Si existe, se borra al abrir (en `try/catch`, sin romper la vista si no hay almacenamiento). Sin esto, un nombre recordado de otra persona seguiría mostrando sus equipos.
- **Cabecera:** el nombre del portal del usuario (`nombre`) y sus iniciales, aunque no tenga equipos. Hoy salen de la primera tarjeta. Las iniciales se calculan del nombre con la misma regla que las tarjetas, y el color del avatar es el neutro cuando no hay tarjetas.
- **Sin equipos:** «No tienes equipos asignados. Si falta alguno, pide que te lo asignen desde la tabla.»
- **Sin cambios:** contadores, tarjetas, agrupación por columna, «Escanear S/N», «Ver taller completo», aviso de datos desactualizados y sondeo cada 60 s.
- `tecnicosDelTablero` (`tecnico.ts`) sigue existiendo: es la lista contra la que se busca el nombre reconocido.

## Pruebas (TDD estricto: la prueba primero y verla fallar)

- **`App.test.tsx`:**
  - sin `vista` y con pantalla de menos de 768 px, navega a `/equipos-taller/mis-equipos` con `replace`;
  - con `?vista=tabla` o `?vista=tablero` no salta en pantalla estrecha;
  - en pantalla ancha no salta;
  - «Tabla» escribe `?vista=tabla`.
- **`MisEquipos.test.tsx`:**
  - no aparecen «¿Quién eres?» ni «Cambiar»;
  - con un nombre recordado de otra persona en `localStorage`, no se ven sus equipos y la clave se borra;
  - con dos nombres de Desk que casan con el del usuario, no se muestra ninguno de los dos;
  - sin equipos, se ve el mensaje y la cabecera muestra el nombre y las iniciales del usuario;
  - siguen saliendo las tarjetas asignadas por cuenta y las del nombre que coincide sin ambigüedad.
- Datos de prueba inventados. Antes de cada commit: `cd apps/hub-api && node scripts/equipos-anonimizar.mjs verificar src/equipos/nucleo/fixtures-reales src/equipos scripts ../equipos-taller/src ../../docs`.

## Fuera de alcance

- Botones de acción y cámara (D6).
- Cambiar el diseño visual de «Mis equipos»: ya sigue el modelo.
- Un enlace a «Mis equipos» en el menú o en la app.

## Despliegue

Solo cambia el portal: sin migración y sin tocar hub-api. Rama `feat/equipos-movil` → fast-forward a `main` → push. El usuario despliega el portal en EasyPanel.
