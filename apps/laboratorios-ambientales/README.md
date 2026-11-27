# Laboratorios Ambientales

Buscador y análisis de los laboratorios ambientales acreditados por el IDEAM,
sobre el dataset abierto [`2waz-acaa`](https://www.datos.gov.co/resource/2waz-acaa.json)
de datos.gov.co (~19.000 acreditaciones). La vista de prospectos cruza además
cada laboratorio con Zoho Books por NIT, a través de hub-api.

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
| `src/lib/equipment.ts` | Catálogo de 46 equipos de calidad del aire. |
| `src/lib/brands.ts` | Agrupación laboratorio→equipos del Análisis de Marcas. |
| `src/lib/prospects.ts` | Prospectos de grasas y aceites: qué acreditación cuenta, infrarrojo o gravimetría, agrupación por laboratorio, vigencia, orden y filtros. |
| `src/lib/exportProspects.ts` | Filas y nombre de fichero del Excel de prospectos. |
| `src/lib/clientes.ts` | Cruce con Zoho: NIT base, estado de cliente (36 meses), filtro y estado de la consulta (`estadoDelCruce`). |
| `src/services/clientesZoho.ts` | Consulta del cruce a hub-api (`POST /api/laboratorios/clientes`), con el JWT del portal y tope de tiempo. |
| `src/lib/fechas.ts` | Fecha local de hoy y suma de meses de calendario. |
| `src/lib/view.ts` | La vista abierta, en el hash de la URL (`#buscador`, `#marcas`, `#prospectos`). |
| `src/pages/` | Vistas: `Buscador`, `Dashboard` (Análisis de Marcas) y `Prospectos`. |
| `src/components/` | Piezas de vista: `CeldaCliente`, la celda de la columna «Cliente». |
| `src/App.tsx` | Shell: carga, errores y navegación. |

La lógica pura vive en `src/lib/` con tests unitarios; los componentes de
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
campo «método». Estado real: **38 de los 46 códigos aparecen** en el dataset, y
**432 de los 1.306 registros** de calidad del aire (33%) citan alguno — el resto
usa normas internas sin código. Si el IDEAM acredita un equipo nuevo, hay que
añadirlo aquí o no aparecerá en el Análisis de Marcas.

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

## Mejoras pendientes

- Cruce con Zoho:
  - Cada vez que se abre `#prospectos` se hace una consulta: ir y volver entre
    el Buscador y Prospectos seis veces en un minuto da 429. Sale el aviso
    genérico y «Reintentar» falla hasta que pasa el minuto. Mejoras posibles:
    decir «espera un minuto», o guardar el último cruce en memoria unos
    minutos.
  - «Reintentar» desaparece al pulsarlo y el foco de teclado se pierde.
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
