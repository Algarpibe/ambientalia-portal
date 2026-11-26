# Diseño — Prospectos de grasas y aceites (Laboratorios ambientales)

Aprobado el 2026-11-26.

## Objetivo

La app de Laboratorios ambientales sirve para el estudio de mercado: a partir de
las técnicas que cada laboratorio tiene acreditadas se deduce si es un cliente
potencial. Esta pieza añade una vista, **«Prospectos de grasas y aceites»**, que
lista los laboratorios con esa acreditación y los separa según tengan o no un
método por infrarrojo. Ambientalia vende el Horiba OCMA-500 para esa
determinación:

- **Con infrarrojo:** ya tienen un equipo IR. Si es un OCMA, la oportunidad es
  servicio y consumibles; si es de otra marca, reposición.
- **Solo gravimetría:** candidatos a comprar un OCMA-500.

## Contexto

Cifras del dataset `2waz-acaa` de datos.gov.co, consultado en vivo el 2026-11-26:

- 90 laboratorios (por código de laboratorio) tienen una acreditación **Activa**
  en grasas y aceites. Son 85 NIT: una misma empresa puede tener varias sedes
  acreditadas.
- 26 tienen al menos un método por infrarrojo (técnica «Fotometría»: SM 5520 C,
  NTC 3362 C). Los otros 64 usan solo gravimetría (SM 5520 B y D, EPA 9071 B).
- Matrices: sobre todo agua, también suelo, sedimento y lodo.
- La variable llega con varias grafías: «Aceites y Grasas» (116 filas),
  «Grasas y Aceites» (35), «Aceites y grasas» y «Grasas y aceites». Hoy el
  Buscador solo unifica mayúsculas y espacios (`variableKey` en
  `src/lib/filters.ts`), así que «Aceites y Grasas» y «Grasas y Aceites» salen
  como dos casillas distintas.
- El dataset **no identifica el equipo** en grasas y aceites: el campo
  `identificaci_n_de_equipo` vale siempre «No Aplica», y ningún método ni rango
  de todo el dataset menciona OCMA ni Horiba. Por eso la vista no puede decir
  quién tiene un OCMA; eso solo lo dirían los registros propios (Zoho, Desk 2.0),
  que quedan fuera de esta pieza.
- `hasta` (fin de la vigencia) llega como fecha ISO
  (`2027-04-21T00:00:00.000`) o como «---». En grasas y aceites, 5 laboratorios
  no tienen ninguna fecha y 4 tienen alguna acreditación que vence antes del
  2027-05-26.
- Todos los campos que hacen falta (`codigo`, `nit`, `tecnica`, `metodo`,
  `matriz`, `hasta`, contacto) ya los mapea `mapRecord`: no cambia la forma del
  cache ni su versión.

## Reglas

**Qué es una acreditación de grasas y aceites.** Estado `Activa` y una variable
que, en minúsculas, sin tildes y con los espacios colapsados, contiene «grasa» y
«aceite». Vale para cualquier matriz.

**Técnica de cada acreditación.**
- **Infrarrojo** si la técnica (en minúsculas y sin tildes) contiene «fotometr» o
  «infrarroj».
- Si la técnica no informa nada (vacía, «---» o «no aplica»), se mira el método:
  es infrarrojo si contiene `5520 C`, `NTC 3362` seguido de C (con o sin
  «Método»/«Métodos» delante) o `D7066`.
- En cualquier otro caso cuenta como **no infrarrojo**.

**Laboratorio.** Las acreditaciones se agrupan por `codigo`; si viene vacío, por
`nombreLaboratorio`. Cada laboratorio lleva:

- nombre, NIT, código, ciudad, departamento, contacto, teléfono y correo. Para
  cada campo se toma el primer valor no vacío entre sus acreditaciones, en el
  orden del dataset;
- matrices y métodos distintos, ordenados con `localeCompare(…, 'es')`;
- **grupo**: `infrarrojo` si alguna de sus acreditaciones de grasas y aceites lo
  es; si no, `gravimetria`. La pestaña de este segundo grupo se llama «Solo
  gravimetría» porque hoy los 64 laboratorios son gravimétricos. Si alguno usara
  otra técnica sin infrarrojo, también caería aquí, y la columna de métodos lo
  dejaría a la vista;
- **vigencia más próxima**: la fecha más temprana (`AAAA-MM-DD`) entre los `hasta`
  válidos de sus acreditaciones de grasas y aceites, o `null` si no hay ninguno.

**Estado de la vigencia**, con `hoy` (`AAAA-MM-DD`) pasado como argumento:
- `sin-fecha`: no hay fecha;
- `vencida`: la fecha es anterior a `hoy`;
- `pronto`: la fecha está entre `hoy` y `hoy` + 6 meses de calendario
  (este límite excluido);
- `vigente`: el resto.

**Orden.** Por vigencia más próxima, de la más cercana a la más lejana, con
`sin-fecha` al final. A igual fecha, por nombre (`localeCompare(…, 'es')`).

**Filtros.**
- Pestaña de grupo: «Usan infrarrojo» y «Solo gravimetría». Por defecto, la
  primera.
- Departamento: «Todos» por defecto. Las opciones salen de los 90 laboratorios.
- Búsqueda libre por nombre o NIT, sin distinguir mayúsculas ni tildes.
- El número de cada pestaña cuenta los laboratorios de ese grupo con el
  departamento y la búsqueda aplicados.
- Si no queda ninguno, se muestra «Ningún laboratorio con estos filtros».

**Exportar a Excel.** El botón descarga un `.xlsx` con lo que se está viendo
(pestaña, filtros y orden).
- Una hoja, «Prospectos».
- Nombre del fichero: `prospectos-grasas-aceites-<infrarrojo|gravimetria>-<AAAA-MM-DD>.xlsx`.
- Columnas: Laboratorio, NIT, Código, Ciudad, Departamento, Grupo, Matrices,
  Métodos, Vigencia más próxima, Estado de la vigencia, Contacto, Teléfono,
  Correo. Matrices y métodos se separan con «; ».

El Excel lleva los datos de contacto: así se aprobó, sabiendo que son datos
personales (Ley 1581 de 2012).

**Buscador.** `variableKey` trata «aceites y grasas» como «grasas y aceites», con
un sinónimo explícito y solo para ese par. La casilla muestra la grafía más
frecuente del recorte (hoy «Aceites y Grasas»), que es lo que la app ya hace con
cualquier grupo de grafías.

## Diseño técnico

| Pieza | Qué hace |
|---|---|
| `src/lib/prospects.ts` (nuevo) | Funciones puras: `esGrasasYAceites`, `esInfrarrojo`, `groupProspects`, `estadoVigencia`, `filterProspects`, `sortProspects` y el tipo `Prospecto`. |
| `src/lib/exportProspects.ts` (nuevo) | `filasExcel(prospectos)` (las filas, puras) y `nombreDeFichero(grupo, hoy)`. |
| `src/lib/filters.ts` | El sinónimo dentro de `variableKey`. |
| `src/lib/view.ts` | La vista `prospectos`, publicada como `#prospectos`. |
| `src/pages/Prospectos.tsx` (nuevo) | Pestañas, filtros, tabla y botón de exportar. |
| `src/App.tsx` | La tarjeta del menú y la vista. |
| `package.json` | La dependencia `xlsx`, con el mismo tarball de SheetJS 0.20.3 que ya usan las demás apps. |

- La librería `xlsx` se carga con `import('xlsx')` al pulsar «Exportar», para que
  no pese en la carga de la app.
- El estado de la vista (pestaña, departamento, búsqueda) es local de
  `Prospectos.tsx`. Si al volver del menú hiciera falta conservarlo, se subiría a
  App como los filtros del Buscador, pero esta pieza no lo necesita.
- Son 90 laboratorios como mucho: la tabla no se pagina. Va dentro de
  `overflow-x-auto`, como la del Buscador.
- Accesibilidad mínima:
  - `scope="col"` en las cabeceras;
  - el recuento de resultados con `aria-live="polite"`;
  - las pestañas como botones con `aria-pressed`;
  - los emojis, si se usan, con `aria-hidden`.
- Si falla la exportación (no carga la librería o falla la escritura), sale un
  aviso junto al botón y la vista sigue funcionando.

## Tests

Con TDD estricto, en `src/lib/prospects.test.ts`, `src/lib/exportProspects.test.ts`
y `src/lib/filters.test.ts`. Los registros salen de filas reales del dataset y
cubren:

- las cuatro grafías de la variable; una variable que tiene «grasa» pero no
  «aceite» queda fuera; una acreditación `Suspendida` queda fuera;
- técnica «Fotometría», técnica «Gravimetría», y técnica «---» con método
  `NTC 3362 Métodos C, F` y con `SM 5520 B`;
- un laboratorio con las dos técnicas cuenta como infrarrojo;
- un mismo NIT con dos códigos da dos laboratorios;
- un código vacío agrupa por nombre;
- la vigencia: la más temprana de varias, «---» ignorado, todas «---» dan `null`;
- `estadoVigencia` en los cuatro estados y en los dos bordes (`hoy`, y `hoy` + 6
  meses);
- el orden: fechas ascendentes, `sin-fecha` al final, desempate por nombre;
- los filtros: departamento y búsqueda por nombre o NIT sin tildes;
- las filas del Excel: columnas en orden y separador «; »; el nombre del fichero;
- el Buscador: con «Aceites y Grasas» marcado, salen también los registros
  «Grasas y Aceites», y al revés.

`Prospectos.tsx` y `App.tsx` no llevan tests, como el resto de páginas de la app
(no hay jsdom). Se comprueban con `npm run build` (`tsc -b`), con `tsc -b` del
portal y probándolos en el navegador.

## Fuera de alcance

- El cruce con Zoho por NIT (cliente o no cliente, si se le vendió un OCMA). La
  vista se deja preparada para añadir una columna «Cliente» sin rehacerla.
- El marcado manual de prospectos.
- La base instalada de aire por estación (número de serie, coordenadas).
- El detector de novedades (acreditaciones nuevas o retiradas).
- Conservar el estado de la vista al volver del menú.
