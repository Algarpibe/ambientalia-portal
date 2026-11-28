# Diseño — Base instalada de aire (Laboratorios ambientales)

Aprobado el 2026-11-27.

## Objetivo

Ambientalia vende equipos y servicios de calidad del aire, pero la app de
Laboratorios hoy solo tiene un estudio de mercado para el agua (Prospectos de
grasas y aceites). Esta pieza añade una vista **«Base instalada de aire»**: una
fila por cada equipo de aire acreditado en Colombia, con su dueño, dónde está,
su marca y modelo, su número de serie y si el dueño es cliente nuestro.

La vista sirve tres usos a la vez:

- conocer la base instalada de la competencia: quién tiene qué marca y dónde,
  para ofrecer reposición;
- encontrar equipos Horiba, nuestros o no, para ofrecer servicio, calibración y
  repuestos;
- planificar visitas por región.

## Contexto

Cifras del dataset `2waz-acaa` de datos.gov.co, contadas en vivo el 2026-11-27:

- **Componentes con equipos.** Solo dos componentes del aire traen equipos con
  número de serie real: calidad del aire y olores ofensivos (analizadores de
  H₂S, TRS y NH₃). En fuentes fijas, ruido y vibraciones el campo de equipo dice
  «No aplica» en casi todas las filas.
- **Tamaño.** Son unos 1.234 equipos (laboratorio + serie) de 64 laboratorios en
  14 departamentos. 237 de esos equipos están asociados a una estación de
  monitoreo.
- **Varias series por fila.** Una fila del dataset puede listar varias series a
  la vez, por ejemplo una red con 30 muestreadores de PM2.5. Por eso se cuenta
  por equipo y no por fila.
- **Códigos de designación EPA.** La marca y el modelo solo se deducen del
  código EPA que cita el método: `RFPS-0202-141`, por ejemplo, es el muestreador
  Tisch TE-6070.
  - Las filas de aire citan 75 grafías de código distintas: 74 códigos, más una
    errata, «RFNA 0506-158», que se lee como un código de más.
  - La tabla de la app (`EQUIPMENT_MAP`) tiene 44 códigos, y 37 de ellos
    aparecen en el dataset.
  - 73 de los 74 están en la lista oficial de la EPA. El que no está,
    `RFNA-1289-070`, se queda sin identificar.
- **La lista oficial** es la «List of Designated Reference and Equivalent
  Methods» de la EPA, con fecha de emisión del 28 de julio de 2026:
  `https://www.epa.gov/system/files/documents/2026-07/amtic-list-july-2026_508-compliant.pdf`.
  - Es un PDF. Se pasa a texto con `pdftotext -layout`.
  - Algunos códigos cubren a dos fabricantes. `RFPS-0202-141` corresponde a
    «Tisch Environmental Model TE-6070 or New Star Environmental Model NS-6070».
- **La app hoy** descarga el dataset entero (unos 18.000 registros) y lo guarda
  en `localStorage` con la clave versionada `labs_cache_v2_*`, que ocupa unos
  3 MB. `mapRecord` no conserva ni la estación ni el número de serie.
- **El cruce con Zoho** (`POST /api/laboratorios/clientes`) ya existe. Acepta
  hasta 150 NIT por petición y 5 peticiones por minuto y usuario, y lo protege
  `requireApp('laboratorios-ambientales')`. Esta vista lo reutiliza tal cual,
  sin cambios en hub-api.

## Reglas

**Valor vacío.** Un texto del dataset cuenta como vacío si, tras recortarlo:

- queda en blanco;
- son solo guiones;
- es «No aplica», «N/A» o «NA», sin distinguir mayúsculas.

**Qué registro entra.** Entran los registros que cumplen todo esto:

- estado `Activa`;
- matriz `Aire`;
- componente normalizado «Calidad del Aire» u «Olores Ofensivos», es decir,
  cualquier grafía del dataset después de `normalizeComponente`;
- un número de serie no vacío.

**Series.** El campo de equipo se parte por comas, puntos y comas y saltos de
línea, y también por un guion, raya (`–`, `—`) o `/` con un espacio al menos en
un lado («1001 - 1002», «2001 -2002», «3001- 3002», «4001 / 4002»). Cada trozo
se recorta y los vacíos se descartan. Un guion o `/` pegado por los dos lados es
parte de la serie, y tampoco se parte por espacios solos: hay series como
«XY-12345-678/2».

**Un equipo.** Es la pareja código de laboratorio + serie, con la serie en
mayúsculas para comparar. Todas las filas de esa pareja forman un solo equipo.
De esas filas salen sus datos:

- **Laboratorio**, NIT, ciudad, departamento y contacto (nombre, teléfono y
  correo): el primer valor no vacío, como en Prospectos.
- **Serie**: tal como aparece la primera vez.
- **Estación**: los nombres distintos que no estén vacíos. Si no hay ninguno,
  «Sin estación».
- **Marca y modelo**: los pares (marca, modelo) distintos que reconoce
  `extractEquipment` en los métodos. Si no hay ninguno, «Sin identificar». Un
  código con dos fabricantes trae los dos en el mismo texto de marca («Tisch
  Environmental / New Star Environmental»), igual que hoy «Ecotech / Acoem».
- **Códigos EPA**: los distintos que citan sus métodos, reconocidos o no.
- **Variables**: las distintas, ordenadas.
- **Vigencia más próxima**: la fecha `hasta` más temprana, con el mismo estado
  de vigencia que Prospectos (vencida, vence en menos de 6 meses, vigente o sin
  fecha).

**Orden.** Por departamento, ciudad, nombre del laboratorio, estación («Sin
estación» al final) y serie, comparando con `localeCompare(…, 'es')`.

**Filtros**, que se combinan:

- **Búsqueda.** Busca en el nombre del laboratorio, el NIT, la estación o la
  serie, con la misma normalización que la búsqueda de Prospectos.
- **Departamento.**
- **Ciudad.** Si hay un departamento elegido, solo se ofrecen sus ciudades; al
  cambiar de departamento la ciudad se vacía.
- **Marca.** Ofrece las marcas presentes, ordenadas, y al final «Sin
  identificar». Un equipo pasa si alguno de sus pares tiene esa marca.
- **Cliente.** Los mismos estados que en Prospectos. Está deshabilitado mientras
  el cruce no esté listo.

**Recuento.** «N equipos de M laboratorios» sobre lo filtrado. Mientras llega el
cruce se añade « · Consultando Zoho…».

**Excel.** Exporta lo que se está viendo.

- Hoja: «Base instalada de aire».
- Fichero: `base-instalada-aire-AAAA-MM-DD.xlsx`.
- Columnas: Laboratorio, NIT, Código, Ciudad, Departamento, Estación, Marca,
  Modelo, Códigos EPA, Variables, Serie, Vigencia más próxima, Estado de la
  vigencia, Contacto, Teléfono, Correo, Cliente y Última factura.
- Las listas van unidas con «; ».

## Diseño técnico

Todo va en `apps/laboratorios-ambientales`. hub-api no cambia.

### Datos (`types/index.ts`, `services/api.ts`)

- **Campos nuevos.** `Laboratorio` gana dos campos opcionales: `estacion?` (de
  `nombre_de_la_estaci_n`) y `serie?` (de `identificaci_n_de_equipo`).
  `mapRecord` solo los pone cuando el valor no está vacío según la regla de
  arriba; si no, la clave no existe. Así la caché crece solo en los
  aproximadamente 1.000 registros que los traen.
- **Versión de la caché.** `CACHE_VERSION` pasa de `v2` a `v3`, y
  `labs_cache_v2_data` y `labs_cache_v2_timestamp` se añaden a
  `LEGACY_CACHE_KEYS`. Hay que borrarlas activamente: si quedan, los 3 MB de la
  v2 impedirían escribir la v3.
- **Coordenadas.** Las coordenadas (`latitud` y `longitud`) no se mapean
  todavía. Son para el mapa de la fase 2.

### Tabla de códigos (`lib/equipment.ts`)

- **Códigos nuevos.** Se añaden los 36 códigos que cita el dataset de aire, que
  están en la lista de la EPA y que faltan en la tabla. Marca, modelo y
  contaminante salen del texto de la lista.
- **Revisión de los existentes.** Se revisan también los 44 existentes contra la
  lista y se corrige el que no cuadre.
- **Fuente.** Un comentario en el fichero cita la edición de la lista (28 de
  julio de 2026) y su URL.
- **Forma.** La forma `Equipo` no cambia. El Análisis de Marcas
  (`lib/brands.ts`) gana marcas y modelos sin tocar su código.

### Lógica nueva

- **`lib/fechas.ts`.** Recibe `fechaDeHasta`, que hoy es privada de
  `lib/prospects.ts`, para que la usen las dos vistas. Prospectos la importa
  desde ahí.
- **`lib/baseInstalada.ts`** (nuevo, funciones puras):
  - `esValorVacio`;
  - `separarSeries`;
  - `esRegistroDeEquipoAire`;
  - `agruparEquipos(data) → EquipoInstalado[]`;
  - `ordenarEquipos`;
  - `filtrarEquipos(equipos, filtros, cruce)`;
  - `opcionesDeFiltro(equipos, departamento) → { departamentos, ciudades, marcas }`.

  La normalización de la búsqueda se reutiliza de Prospectos: se exporta la
  función, no se copia.
- **`lib/exportBaseInstalada.ts`** (nuevo): `COLUMNAS_EXCEL`, `filasExcel`,
  `nombreDeFichero` y `HOJA_EXCEL`, con el mismo patrón que
  `lib/exportProspects.ts`.
- **`lib/clientes.ts`.** `nitsParaConsultar` y `filtrarPorCliente` pasan a
  aceptar cualquier lista de elementos con `nit` (genérico sobre
  `{ nit: string }`). No cambia lo que hacen.

### Cruce con Zoho

- **`hooks/useCruceZoho.ts`** (nuevo). Sale de `pages/Prospectos.tsx` y recibe
  la lista de NIT. Devuelve `{ cruce, estadoCruce, reintentar }`. Conserva:
  - la petición cancelable al desmontar o al cambiar los NIT;
  - el resultado con clave `{clave, cruce}` junto con `estadoDelCruce`, para que
    nunca se enseñe un cruce viejo como actual;
  - el contador de intentos de «Reintentar»;
  - el `console.warn` al fallar.

  Prospectos pasa a usarlo y se comporta igual que hoy.
- **`components/CeldaCliente.tsx`.** Gana la opción `conOcma` (por defecto
  `true`). La vista de aire pasa `false` y solo enseña el estado y la última
  factura.

### Vista

- **`pages/BaseInstalada.tsx`** (nueva y fina): filtros, recuento, tabla a todo
  el ancho, botón de Excel, y el mismo aviso ámbar con «Reintentar» que
  Prospectos cuando falla el cruce. La columna «Cliente» va después de
  Laboratorio.
- **`lib/view.ts`.** Nueva vista `'base-aire'` con el hash `#base-aire`.
- **`App.tsx`.** Cuarta tarjeta en el menú, «Base instalada de aire», que solo
  se abre cuando los datos están listos, como las demás.

## Errores

- **Falla la descarga del dataset.** Se comporta como las otras vistas, porque
  la gestiona `App.tsx`.
- **Falla el cruce con Zoho.** Incluye el 429 por pasar el límite. Sale el aviso
  ámbar con «Reintentar» y la columna muestra «—». Filtros, tabla y Excel siguen
  funcionando; el Excel sale sin cliente.
- **Código EPA que no está en la tabla.** La marca sale «Sin identificar» y el
  código aparece en la columna «Códigos EPA» del Excel.
- **Fecha `hasta` con «---» o con un formato raro.** «Sin fecha», como en
  Prospectos.

## Tests

Se escriben primero, siempre con datos ficticios, porque el repo es público:
nombres, NIT y series inventados.

- **`services/api.test.ts`:**
  - `mapRecord` pone `estacion` y `serie` cuando hay valor y omite la clave con
    «No aplica», «---» o vacío;
  - las claves de la v2 se borran.
- **`lib/equipment.test.ts`:**
  - varios códigos nuevos (un muestreador de PM, un analizador de olores) dan
    su marca y modelo;
  - un código de dos fabricantes trae los dos;
  - `RFNA-1289-070` no se reconoce.
- **`lib/fechas.test.ts`:** `fechaDeHasta`, con los casos que hoy prueba
  Prospectos.
- **`lib/baseInstalada.test.ts`:**
  - **Valores vacíos y series.** Casos de `esValorVacio` y `separarSeries`
    (coma, punto y coma, salto de línea, `/` dentro de la serie).
  - **Qué entra.** Componentes que entran y que no; registros suspendidos
    fuera.
  - **Agrupado.** Un analizador repetido en tres filas da un equipo con tres
    variables; la misma serie en dos laboratorios da dos equipos.
  - **Datos del equipo.** Estación, «Sin estación», marca sin identificar y
    vigencia más próxima.
  - **Orden, filtros y opciones.** El orden; cada filtro y su combinación; la
    ciudad dependiente del departamento; la marca «Sin identificar».
- **`lib/exportBaseInstalada.test.ts`:**
  - columnas en orden;
  - filas con y sin cruce;
  - listas unidas con «; »;
  - nombre del fichero.
- **`lib/clientes.test.ts`:** las funciones genéricas siguen pasando sus casos
  con prospectos y también aceptan equipos.
- **Verificación general:** `npm test`, `npm run build` y `npm run lint` de la
  app, y la build del portal.
- **En el navegador.** La app no tiene pruebas de componentes, así que el hook y
  la página se comprueban allí. La prueba la hace el usuario tras desplegar.

## Despliegue

- **Solo el portal.** No hay migraciones, variables de entorno ni cambios en
  hub-api.
- **Primera carga.** Tras desplegar, cada usuario vuelve a descargar el dataset
  completo una vez, por el cambio de versión de la caché (puede tardar hasta
  60 s).
- **Documentación:**
  - el README de la app: nueva vista, reglas y ampliación de la tabla de
    códigos;
  - `docs/PRIVACY-RETENTION.md`: el cruce con Zoho se usa también en esta
    vista, con la misma finalidad de prospección comercial.

## Fuera de alcance

- El mapa de estaciones y las coordenadas, que son la fase 2. Necesitan Leaflet,
  autorizar las teselas de OpenStreetMap en la CSP del portal (`img-src` en
  `apps/portal/nginx.conf`) y aceptar peticiones a un servicio externo.
- Fuentes fijas, ruido y vibraciones, porque no traen equipos.
- Equipos sin número de serie.
- Deducir la marca a partir del formato de la serie.
- Cruzar la serie con el maestro de equipos de Desk 2.0.

## Decisiones tomadas con el usuario

1. Usos: los tres a la vez (competencia, equipos Horiba y visitas por región).
2. Una tabla y no un mapa. El mapa queda como fase 2.
3. La tabla de códigos se amplía con la lista oficial de la EPA dentro de esta
   pieza.
4. Columna «Cliente» reutilizando el cruce con Zoho, sin las fechas del OCMA.
5. Los datos salen de la descarga que la app ya hace (caché v3), no de una
   consulta aparte ni de hub-api.

## Cambios acordados durante la implementación

Aprobados por el usuario después de aprobar este diseño:

- `separarSeries` también parte por `-`, `–`, `—` o `/` cuando ese carácter
  tiene un espacio al menos a un lado; pegado por los dos lados, queda en la
  serie.
- El orden desempata también por código de laboratorio.
- Nueva regla de marcas, `marcasDe` en `lib/marcas.ts`: el texto de marca se
  parte por « / » y una lista explícita (`GRUPOS_DE_EMPRESA`) junta los
  nombres de una misma empresa con una etiqueta fija.
- «Thermo Scientific» absorbe a Thermo Environmental, Thermo Andersen y
  Rupprecht & Patashnick; «Teledyne API» absorbe a Advanced Pollution
  Instrumentation (Teledyne Monitor Labs sigue aparte).
- El Análisis de Marcas (`listBrands`, `listModels`, `groupLabsByEquipment`)
  usa la misma regla de marcas.
- Correcciones de la tabla contra la lista de la EPA (28 de julio de 2026),
  con variantes de modelo para EQOA-0193-091, EQSA-0193-092 y RFNA-0118-249, y
  el BAM 1020-1.
- Marcas blancas: Horiba APDA-371, Spirant BAM1000/BAM1100 (Ecotech/Acoem) y
  Sibata GBAM son el Met One BAM con otro nombre; en Colombia son Met One y no
  cuentan como esa marca.
- `normalizarCodigosEpa` pasa a `equipment.ts`, la usa `extractEquipment` y
  aplica un mapa de erratas (`ERRATAS_DE_CODIGO`): «RFNA 0506-158» es
  RFCA-0506-158.
- La tabla de la página es un componente local memoizado, con filas por `id`
  de la agrupación y los códigos EPA uno por línea.
- El cruce con Zoho vive en `hooks/useCruceZoho.ts`, que usa también
  Prospectos; `reintentar` es estable.
