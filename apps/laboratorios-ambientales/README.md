# Laboratorios Ambientales

Buscador y análisis de los laboratorios ambientales acreditados por el IDEAM,
sobre el dataset abierto [`2waz-acaa`](https://www.datos.gov.co/resource/2waz-acaa.json)
de datos.gov.co (~19.000 acreditaciones). Las vistas de prospectos y de base
instalada de aire cruzan además cada laboratorio con Zoho Books por NIT, a
través de hub-api.

## Cómo se ejecuta

Esta app **no tiene entrada standalone**: es un conjunto de vistas que monta el
portal, que es además quien compila su CSS de Tailwind
(`apps/portal/tailwind.config.js`). Para verla:

```bash
npm run dev          # desde la raíz del monorepo: levanta el portal
```

y navegar a `/laboratorios-ambientales`.

```bash
npm run build --workspace=apps/laboratorios-ambientales   # typecheck (tsc -b), sin bundle
npm test  --workspace=apps/laboratorios-ambientales       # tests unitarios
```

El script `build` es solo `tsc -b` a propósito: no hay `index.html` que empaquetar
porque el bundle lo produce el portal.

## Estructura

| Ruta | Responsabilidad |
|---|---|
| `src/services/api.ts` | Descarga paginada del dataset + cache de 24 h en `localStorage` (ver «Carga y cache»). |
| `src/lib/normalize.ts` | Valores canónicos de estado, matriz, componente y actividad. |
| `src/lib/filters.ts` | Filtrado y opciones en cascada. |
| `src/lib/pagination.ts` | Paginación de la tabla de resultados. |
| `src/lib/equipment.ts` | Catálogo de 82 códigos de equipos de calidad del aire, normalización de códigos escritos con espacios y fe de erratas (ver «El catálogo de equipos se mantiene a mano»). |
| `src/lib/marcas.ts` | La regla de marcas que comparten la Base instalada y el Análisis de Marcas (`marcasDe`). |
| `src/lib/brands.ts` | Agrupación laboratorio→equipos del Análisis de Marcas. |
| `src/lib/prospects.ts` | Prospectos de grasas y aceites: qué acreditación cuenta, infrarrojo o gravimetría, agrupación por laboratorio, vigencia, orden y filtros. |
| `src/lib/exportProspects.ts` | Filas y nombre de fichero del Excel de prospectos. |
| `src/lib/clientes.ts` | Cruce con Zoho: NIT base, estado de cliente (36 meses), filtro y estado de la consulta (`estadoDelCruce`). |
| `src/services/clientesZoho.ts` | Consulta del cruce a hub-api (`POST /api/laboratorios/clientes`), con el JWT del portal y tope de tiempo. |
| `src/lib/baseInstalada.ts` | Base instalada de aire: valor vacío, series, qué registro entra, agrupación por equipo, códigos EPA, orden, filtros, opciones y recuento. |
| `src/lib/exportBaseInstalada.ts` | Filas y nombre de fichero del Excel de la base instalada. |
| `src/lib/fechas.ts` | Fecha local de hoy, suma de meses de calendario y la fecha de `hasta` (`fechaDeHasta`). |
| `src/lib/view.ts` | La vista abierta, en el hash de la URL (`#buscador`, `#marcas`, `#prospectos`, `#base-aire`). |
| `src/hooks/useCruceZoho.ts` | La consulta del cruce con Zoho de una vista: cancelable, con «Reintentar» estable y sin enseñar nunca un cruce viejo como actual. |
| `src/pages/` | Vistas: `Buscador`, `Dashboard` (Análisis de Marcas), `Prospectos` y `BaseInstalada`. |
| `src/components/` | Piezas de vista: `CeldaCliente`, la celda de la columna «Cliente» (con o sin las fechas del OCMA). |
| `src/App.tsx` | Shell: carga, errores y navegación. |

La lógica pura vive en `src/lib/` con tests unitarios; `src/hooks/`,
`src/pages/` y `src/components/` solo la orquestan y la pintan.

## Carga y cache

`fetchLaboratorios` guarda el dataset en `localStorage` durante 24 h y decide
según lo que encuentre al arrancar:

| Cache | Qué pasa |
|---|---|
| Fresco (< 24 h) | Se usa tal cual; no se toca la red. |
| Caducado | Sus datos se enseñan al momento y la descarga va en segundo plano, sin spinner. Al terminar, App cambia los datos por los nuevos; los filtros se conservan porque viven en App. Si esa descarga falla, se sigue con lo rancio sin avisar. |
| No hay | Descarga en primer plano con el contador de registros. Si falla, sale el error con Reintentar. |

- **Un timestamp corrupto o en el futuro cuenta como caducado.** El cache es
  fresco solo si su edad es un número finito entre 0 y 24 h. Antes, un `NaN` o
  un reloj mal puesto lo dejaban fresco para siempre y la app no volvía a
  descargar nunca.
- **Si lo guardado no es un array, no hay cache**, ni fresco ni rancio: App hace
  `data.map` y un objeto la reventaría.
- **Cada página tiene un tope de 60 s** (`REQUEST_TIMEOUT_MS`), que cubre también
  la lectura del cuerpo. Si datos.gov.co no contesta, la carga falla con
  «datos.gov.co no respondió en 60 s» en vez de dejar el spinner girando sin
  botón de Reintentar.
- **La clave va versionada (`labs_cache_v3_*`).** Al cambiar la forma de
  `Laboratorio` se sube `CACHE_VERSION` y las claves viejas se borran
  activamente (`LEGACY_CACHE_KEYS`): sus ~3 MB impedirían escribir las nuevas.
  La v3 (2026-11-27) añadió `estacion` y `serie`. Al desplegarla, cada usuario
  vuelve a descargar el dataset entero una vez.

## Notas sobre los datos

Todas las cifras de aquí están verificadas contra la API en vivo (2026-07-15).

- **Un registro es un parámetro acreditado, no un laboratorio.** Un laboratorio
  aparece en tantas filas como variables tenga acreditadas. Por eso la portada
  distingue «laboratorios» de «acreditaciones».
- **`estado` solo toma dos valores:** `Activa` (18.689) y `Suspendida` (367).
  Cualquier otro se normaliza a cadena vacía.
- **La paginación de la API usa `$order=:id`.** Sin un orden explícito, SODA
  puede repetir u omitir filas entre páginas. Son 4 peticiones de 5.000.
- **La API sirve CORS abierto** (`Access-Control-Allow-Origin: *`): no hacen
  falta proxies.

### ⚠️ El dataset es de captura manual y las grafías divergen

Es la característica que más condiciona este código. La misma categoría aparece
escrita de varias formas, y sin unificarla se convierte en varias opciones de
filtro para lo mismo:

| Campo | Ejemplo real |
|---|---|
| `componente` | `Calidad del Aire` (1302) vs `Calidad de aire` (15) |
| `componente` | `Biota Acuática Marina` / `Biota acuática marina` / `Biota acuática Marina` |
| `matriz` | `Aceite Dieléctrico` (78) vs `Aceite dieléctrico` (8) |
| `actividad` | `Determinación directa` (631) vs `Determinación Directa` (37) |
| `variable` | `Plomo` vs `plomo` — 98 grupos así |

**`normalize.ts` aplica title-case Unicode-aware** a `matriz`, `componente` y
`actividad`, más reglas explícitas donde los datos las exigen (RESPEL, calidad
del aire). Tres avisos para quien lo toque:

- **No uses `\b\w`** para el title-case: `\w` es solo ASCII y en «análisis» abre
  un límite de palabra falso → `AnáLisis`. Este dataset va lleno de tildes.
- **No apliques title-case a `variable`.** Es nomenclatura técnica: rompería
  `pH`→`Ph`, `DQO`→`Dqo`, `n-Decano`→`N-Decano` y 71 nombres más. Sus grafías
  divergentes se resuelven **al cotejar** (`filters.ts` agrupa por clave en
  minúsculas y muestra la grafía más frecuente), no al normalizar.
- **Regla explícita solo cuando los datos la exijan.** Nada de colapsar por
  subcadena «por si acaso»: `includes('agua')` parece inofensivo hasta que
  `Agua de Poro` —que existe como componente— se colapsa a `Agua` y desaparece
  una faceta.

Antes de dar por bueno cualquier literal de faceta, compruébalo:

```bash
curl -s "https://www.datos.gov.co/resource/2waz-acaa.json?\$select=componente,count(*)&\$group=componente"
```

### El catálogo de equipos se mantiene a mano

`equipment.ts` mapea códigos de designación (US EPA / UNE-EN) a marca/modelo/
contaminante. Esos códigos se buscan como subcadena dentro del texto libre del
campo «método». Si el IDEAM acredita un equipo nuevo, hay que añadirlo aquí o
no aparecerá en el Análisis de Marcas ni tendrá marca en la Base instalada.

- **Fuente:** la «List of Designated Reference and Equivalent Methods» de la
  EPA, edición del 28 de julio de 2026
  ([PDF](https://www.epa.gov/system/files/documents/2026-07/amtic-list-july-2026_508-compliant.pdf)).
  Se pasa a texto con `pdftotext -layout`. Marca, modelo y contaminante salen
  del texto de cada designación.
- **Estado (2026-11-27):** 82 códigos: los 46 del prototipo (dos son la norma
  UNE-EN 16450) y 36 que cita el dataset de aire y faltaban. Las filas de aire
  citan 74 códigos EPA distintos y 73 están en la tabla. El otro, que el
  dataset escribe «RFNA-1289-0704», no está en la lista de la EPA y sale «Sin
  identificar».
- **Varios fabricantes:** un código que cubre varios los trae unidos con « / »
  («Tisch Environmental / New Star Environmental»).
- **Marcas (`marcasDe`, en `src/lib/marcas.ts`):** el texto de marca se parte
  por « / » y cada fabricante es una opción. Una lista explícita
  (`GRUPOS_DE_EMPRESA`) junta, con una etiqueta fija, los nombres de una misma
  empresa:
  - «Environnement S.A. / ENVEA»;
  - «BGI Inc. / Mesa Laboratories Inc.»;
  - «Ecotech / Acoem»;
  - «Graseby Andersen / Sierra-Andersen / General Metal Works»;
  - «Thermo Scientific», que incluye Thermo Environmental, Thermo Andersen y
    Rupprecht & Patashnick;
  - «Teledyne API», que incluye Advanced Pollution Instrumentation. Teledyne
    Monitor Labs queda aparte.

  El Análisis de Marcas (`listBrands`, `listModels`, `groupLabsByEquipment`)
  usa la misma regla.
- **Contaminante:** PM10, PM2.5 y PM10-2.5 son «Partículas». Los analizadores
  de olores (H₂S, TRS, NH₃) se acreditan con su designación de SO₂ o de NOx, y
  así salen.
- **Códigos con espacios y erratas:** `normalizarCodigosEpa` (en
  `equipment.ts`, la usa `extractEquipment`) pasa a guiones los códigos escritos
  con espacios («EQPM 0311-195») y aplica un mapa explícito de erratas,
  `ERRATAS_DE_CODIGO`. Hoy tiene una entrada: «RFNA 0506-158» es en realidad
  RFCA-0506-158, el monitor de CO Horiba APMA-370.
- **Marcas blancas:** el Horiba APDA-371, los Spirant BAM1000 y BAM1100
  (Ecotech/Acoem) y el Sibata GBAM son el Met One BAM vendido con otro nombre.
  En Colombia son Met One, así que no cuentan como esas marcas: el filtro
  «Horiba» solo enseña equipos Horiba reales. La tabla deja fuera otras marcas
  blancas a propósito.
- **Corregido el 2026-11-27:** nueve entradas del prototipo no cuadraban con la
  lista de la EPA. EQPM-0308-170, EQPM-0715-266, RFSA-0616-237 y EQPM-0923-262
  tenían la marca o el modelo de otro código. A EQPM-0798-122 le faltaban
  Horiba y los demás fabricantes, y a los cuatro Horiba, su modelo -380. Se
  añadieron además variantes de modelo a EQOA-0193-091, EQSA-0193-092 y
  RFNA-0118-249, y el BAM 1020-1.

## Prospectos de grasas y aceites

Vista `#prospectos`, para el estudio de mercado del Horiba OCMA-500 (cifras del
2026-11-26: 90 laboratorios, 85 NIT). Lista los laboratorios, por código de
laboratorio, con una acreditación **Activa** cuya variable contiene «grasa» y
«aceite» (sin tildes ni mayúsculas, en cualquier matriz), y los separa en dos
pestañas:

| Pestaña | Regla |
|---|---|
| Usan infrarrojo (26) | Alguna acreditación tiene una técnica con «fotometr» o «infrarroj»; o, si la técnica no informa nada (vacía, «---», «No Aplica»), un método `5520 C`, `NTC 3362 C` o `D7066`. |
| Solo gravimetría (64) | El resto. Hoy todos son gravimétricos (SM 5520 B y D, EPA 9071 B); si apareciera otra técnica, caería aquí y se vería en la columna de métodos. |

- **El dataset no identifica el equipo.** En grasas y aceites,
  `identificaci_n_de_equipo` vale siempre «No Aplica» y ningún método nombra
  OCMA ni Horiba: el dataset no sabe quién tiene un OCMA. Lo que dice Zoho va
  en la columna «Cliente» (ver abajo); Desk 2.0 queda fuera.
- **Vigencia más próxima:** la fecha `hasta` más temprana de sus acreditaciones
  de grasas y aceites («---» no cuenta). «Vence en menos de 6 meses» va de hoy a
  hoy + 6 meses de calendario, con el límite fuera; si ese día no existe, el
  límite es el último del mes (31 de agosto → 28 de febrero, o 29 en bisiesto).
- **Orden:** de la vigencia más cercana a la más lejana, los sin fecha al final;
  a igual fecha, por nombre.
- **Filtros:** departamento y búsqueda por nombre o NIT, sin mayúsculas ni
  tildes; el NIT también se encuentra sin puntos ni guion. El estado de la
  vista es local: se pierde al volver al menú.
- **Exportar a Excel** descarga lo que se ve (pestaña, filtros y orden) en
  `prospectos-grasas-aceites-<infrarrojo|gravimetria>-<AAAA-MM-DD>.xlsx`, con una
  hoja «Prospectos». SheetJS se carga al pulsar. Todas las celdas son texto.
  **El Excel lleva los datos de contacto**, que son datos personales (Ley 1581
  de 2012): se aprobó así.
- **En el Buscador,** «Aceites y Grasas» y «Grasas y Aceites» son una sola
  casilla: `variableKey` lleva un sinónimo explícito, solo para ese par.

### Cruce con Zoho (columna «Cliente»)

Al abrir la vista, la app envía a hub-api (`POST /api/laboratorios/clientes`,
con el JWT del portal y `requireApp('laboratorios-ambientales')`) los NIT base
de los 90 laboratorios. Responde, de los que están en Zoho, tres fechas y nada
más: ni importes, ni nombres, ni identificadores.

| Estado | Cuándo |
|---|---|
| Cliente activo | Última factura (sin borradores ni anuladas) en los últimos 36 meses, límite incluido. |
| Cliente antiguo | Última factura más antigua. |
| En Zoho sin compras | Hay un contacto de tipo cliente con ese NIT, sin facturas. |
| No está en Zoho | Ningún contacto de tipo cliente tiene ese NIT. |
| Sin NIT | El dataset no trae NIT, o no da de 6 a 10 dígitos. |

- **NIT base:** lo de antes del primer «-», solo dígitos (`900.000.001-7` →
  `900000001`). Es el formato de `cf_nit` en Zoho. Varios contactos con el
  mismo NIT se suman. La regla está dos veces, en
  `src/lib/clientes.ts` y en `apps/hub-api/src/laboratorios/clientes.ts`, con
  las mismas pruebas: si se separan, hub-api rechaza la petición entera.
- **OCMA vendido** y **Repuestos OCMA:** la factura más reciente con un artículo
  de la categoría «OCMA-500 Series» o «C&R OCMA-500». Solo cuentan los que
  facturó Ambientalia. La categoría «Opcional OCMA-500» (un artículo) no
  cuenta como repuesto.
- **Si hub-api falla,** la vista funciona igual: aviso con «Reintentar», la
  columna vacía, el filtro «Cliente» desactivado y el Excel sin el cruce. Un
  resultado viejo nunca se enseña como actual: si los NIT cambian tras un
  refresco o se reintenta, la columna vuelve a «Consultando…»
  (`estadoDelCruce`).
- **El Excel** lleva cuatro columnas más al final: Cliente, Última factura,
  OCMA vendido y Últimos repuestos OCMA.
- hub-api cachea el cruce completo 2 minutos y solo devuelve los NIT pedidos.
  El servidor no sabe cuáles son prospectos, así que frena el barrido por
  volumen: como mucho 150 NIT por petición y 5 peticiones por minuto y usuario
  (después, 429). Hoy la vista envía unos 85.
- **Calidad del dato (2026-11-27):** los 85 NIT del dataset traen guion; en
  Zoho, de 609 contactos con NIT, uno de un laboratorio de la lista lleva el
  dígito de verificación pegado (10 dígitos) y no cruza hasta que se corrija
  en Zoho.

## Base instalada de aire

Vista `#base-aire`: una fila por equipo de aire acreditado (cifras del
2026-11-27: 1.275 equipos de 64 laboratorios en 14 departamentos; 39 «Sin
identificar» y 85 Horiba). Sirve para conocer la base instalada de la
competencia, encontrar equipos Horiba y planificar visitas por región.

- **Qué entra:** registros `Activa`, matriz `Aire`, componente «Calidad del
  Aire» u «Olores Ofensivos» (cualquier grafía, tras `normalizeComponente`) y
  con número de serie. Fuentes fijas, ruido y vibraciones no traen equipos.
- **Valor vacío:** en blanco, solo guiones, o «No aplica», «N/A» o «NA», sin
  distinguir mayúsculas (`esValorVacio`). `mapRecord` solo guarda `estacion` y
  `serie` cuando traen valor.
- **Un equipo** es la pareja código de laboratorio + serie, con la serie en
  mayúsculas para comparar. El campo de equipo se parte (`separarSeries`) por
  comas, puntos y comas y saltos de línea, porque una fila puede listar 30
  muestreadores. También se parte por `-`, `–`, `—` o `/` cuando ese carácter
  tiene un espacio al menos a un lado («1001 - 1002»). Un guion o una
  barra pegados por los dos lados siguen dentro de la serie («XY-12345-678/2»). Sin
  código de laboratorio, el equipo se agrupa por el nombre.
- **Ficha:** cada dato es el primero con valor entre sus filas. Las
  estaciones, las variables y los códigos EPA van sin repetir; la vigencia más
  próxima es la fecha `hasta` más temprana.
- **Marca y modelo** salen del código EPA que cita el método, con la regla de
  marcas de «El catálogo de equipos se mantiene a mano». Un código escrito con
  espacios («EQPM 0311-195») también vale. Si un código cubre varios
  fabricantes, salen juntos, porque el dataset no dice cuál es. Sin código
  conocido, «Sin identificar»; el código queda en la columna «Códigos EPA».
- **Filtros:**
  - búsqueda por laboratorio, NIT, estación o serie, sin tildes ni mayúsculas;
  - departamento y ciudad (solo las del departamento elegido);
  - marca: cada fabricante por separado, también los que comparten código,
    las empresas con varios nombres como una sola opción, y «Sin
    identificar»;
  - cliente.
- **Orden:** departamento, ciudad, laboratorio, código de laboratorio,
  estación («Sin estación» al final) y serie.
- **Tabla:** los códigos EPA se enseñan uno por línea. Es un componente local
  memoizado y sus filas llevan por clave el `id` de la agrupación, para que
  `useDeferredValue` funcione y escribir en la búsqueda no se trabe.
- **Columna «Cliente»:** el mismo cruce con Zoho que Prospectos
  (`useCruceZoho`), sin las fechas del OCMA. Si falla, sale el aviso con
  «Reintentar» y la vista sigue funcionando.
- **Excel:**
  - lo que se ve, en `base-instalada-aire-<AAAA-MM-DD>.xlsx`, con una hoja
    «Base instalada de aire» de 18 columnas;
  - las listas van unidas con «; », y la marca n.º i va con el modelo n.º i;
  - lleva los datos de contacto, como el de Prospectos.
- **Sin paginar:** son ~1.300 filas. Si en el navegador se nota lenta, se
  pagina con `lib/pagination.ts` (ver «Mejoras pendientes»).

## Mejoras pendientes

- Cruce con Zoho:
  - El límite de 5 peticiones por minuto y usuario lo comparten ahora dos
    vistas, y cada una consulta al abrirse: ir y volver entre el Buscador,
    Prospectos y la Base instalada seis veces en un minuto da 429. Sale el
    aviso genérico y «Reintentar» falla hasta que pasa el minuto. Mejoras
    posibles: guardar el último cruce en memoria unos minutos, o un mensaje
    propio del 429 («espera un minuto»).
  - «Reintentar» desaparece al pulsarlo y el foco de teclado se pierde, en
    las dos vistas. Una solución es un componente compartido, `AvisoErrorZoho`,
    que conserve el foco.
  - Si el dataset pasara de 150 laboratorios de grasas y aceites, hub-api
    rechazaría la petición (400): habría que partirla.
- El cache completo (~3 MB) va a `localStorage`, que comparte los ~5 MB del
  origen con el resto del portal. Si empieza a fallar por cuota, migrar a
  IndexedDB. Hoy degrada limpio: si no cabe, se sigue con los datos en memoria.
- Los fallthroughs de `normalize.ts` aplican title-case a cualquier valor nuevo,
  así que un acrónimo futuro (`COV`, `HAP`) se degradaría en silencio a `Cov`.
  Los 39 valores actuales están verificados uno a uno; cuando aparezca uno
  nuevo, se le añade su regla explícita.
- El typo de origen `Muestreo Intregrado` (27 registros, 4 variantes) no se
  corrige: es un error de la fuente oficial y no nos toca inventar ortografía.
- La tabla del Buscador no ordena por columna ni permite saltar a una página
  concreta. Se dejó fuera a propósito; los filtros cubren el caso de uso.
- El módulo de «Análisis con IA» se eliminó (llamaba a Gemini desde el navegador,
  lo que exigía la API key en el bundle, y ejecutaba código del modelo con
  `new Function`). Si se retoma, debe ir tras un proxy en `hub-api` con la key
  server-side y sin ejecutar código generado.
- Base instalada de aire:
  - Fase 2, el mapa de estaciones. Necesita mapear `latitud` y `longitud`,
    Leaflet, autorizar las teselas de OpenStreetMap en la CSP del portal
    (`img-src` en `apps/portal/nginx.conf`) y aceptar peticiones a un servicio
    externo.
  - No se cruza la serie con el maestro de equipos de Desk 2.0, ni se deduce
    la marca del formato de la serie.
  - Comprobar en el navegador la velocidad al escribir con unas 1.275 filas
    sin paginar; si va lenta, paginar con `lib/pagination.ts`.
  - Mover `clave`, `distintos` y `compararTexto` de `lib/prospects.ts` a
    `lib/texto.ts`, y `nitCoincide` a `lib/clientes.ts`. Hoy `baseInstalada.ts`
    importa `clave`, `distintos` y `nitCoincide` de `prospects.ts`, y
    `compararTexto` está duplicada en los dos ficheros.
