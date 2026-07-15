# Laboratorios Ambientales

Buscador y análisis de los laboratorios ambientales acreditados por el IDEAM,
sobre el dataset abierto [`2waz-acaa`](https://www.datos.gov.co/resource/2waz-acaa.json)
de datos.gov.co (~19.000 acreditaciones).

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
| `src/services/api.ts` | Descarga paginada del dataset + cache de 24 h en `localStorage`. |
| `src/lib/normalize.ts` | Valores canónicos de estado, matriz, componente y actividad. |
| `src/lib/filters.ts` | Filtrado y opciones en cascada. |
| `src/lib/pagination.ts` | Paginación de la tabla de resultados. |
| `src/lib/equipment.ts` | Catálogo de 46 equipos de calidad del aire. |
| `src/lib/brands.ts` | Agrupación laboratorio→equipos del Análisis de Marcas. |
| `src/pages/` | Vistas: `Buscador` y `Dashboard` (Análisis de Marcas). |
| `src/App.tsx` | Shell: carga, errores y navegación. |

La lógica pura vive en `src/lib/` con tests unitarios; los componentes de
`src/pages/` solo la orquestan.

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

## Mejoras pendientes

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
