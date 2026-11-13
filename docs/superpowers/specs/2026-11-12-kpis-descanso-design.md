# Ausencias — KPIs: cuánto lleva cada uno sin descansar

**Fecha:** 2026-11-12
**Estado:** implementado (plan: `docs/superpowers/plans/2026-11-12-kpis-descanso.md`); pendiente
de desplegar hub-api y el portal. Tras la revisión: el contador de alarma se rotula «12 meses o
más», va en rojo y el de aviso en ámbar (como sus filas); a quien está de vacaciones ahora no se
le enseña «último día» (sería el de sus vacaciones anteriores); un saldo negativo sale en rojo.
**Depende de:** el panel de KPIs de Vacaciones y Permisos (`PanelKpis.tsx`, `service/kpis.ts`,
`kpis.ts`, `repo/kpis.ts`), en producción.

## 1. Objetivo

Sustituir la tarjeta «Quién acumula de más» por **«Cuánto lleva cada uno sin descansar»**: el
tiempo que ha pasado desde el último día de vacaciones de cada persona de la plantilla activa.

## 2. Decisiones (cerradas en brainstorming)

- **Toda la plantilla activa**, ordenada de quien más tiempo lleva sin descansar a quien menos
  (opción A). No solo quien pasa un umbral.
- **Tramos:** más de 12 meses (rojo), de 6 a 12 meses (ámbar), menos de 6 (normal). Contadores
  de los tres arriba de la lista.
- **Solo vacaciones** aprobadas ya disfrutadas; compensatorios y permisos no cuentan como
  descanso.
- **Sin vacaciones registradas** = arriba del todo (es el caso más grave, no «hace 0 días»).
- **De vacaciones ahora** = al final y en verde. Sin esto la tarjeta diría «descansó hace 8
  meses» de alguien que está de vacaciones hoy.
- **Bajo cada nombre:** fecha del último día de vacaciones, saldo de vacaciones y lo que ya
  tiene pedido («15 días ya pedidos» / «sin nada previsto»): separa a quien lleva mucho sin
  descansar pero ya tiene el viaje reservado.
- **No depende del selector «Periodo»:** es una foto de hoy, como la tarjeta actual.
- **«Quién acumula de más» desaparece de la pantalla**; hub-api sigue calculando
  `acumulacion` (función pura sobre datos que ya carga, sin consulta extra), igual que se hizo
  con el absentismo.

## 3. Datos y cálculo (hub-api)

- `repo.planificacionDeVacaciones(db, hoy)` ya devuelve, para **cada ficha activa**,
  `ultimasVacaciones` (el `MAX(fecha_fin)` de las vacaciones que ocupan agenda con
  `fecha_fin <= hoy`) y `diasProgramados`. Se le añade **`deVacacionesAhora: boolean`**:
  existe una vacación que ocupa agenda con `fecha_inicio <= hoy <= fecha_fin`.
- **Función pura nueva `descansoPorPersona`** en `apps/hub-api/src/ausencias/kpis.ts`:
  - Entrada: las fichas activas con nombre y saldo disponible (la lista `saldos` que el
    servicio ya calcula para el pasivo), la planificación y `hoy`.
  - Por ficha: `diasSinVacaciones` (con `diasDesde`, `null` = nunca), `mesesSinVacaciones` =
    `floor(dias × 12 / 365)` (`null` si nunca), `deVacacionesAhora`, `ultimoDia`,
    `diasProgramados`, `saldo` y `tramo`:
    - `ahora` si está de vacaciones hoy;
    - `nunca` si no tiene ninguna;
    - `alarma` si `mesesSinVacaciones >= 12`;
    - `aviso` si `>= 6`;
    - `ok` en el resto.
  - Los tramos se deciden con los **meses** y no con los días para que la etiqueta («hace 12
    meses») y el color nunca discrepen: con `floor(dias × 12 / 365)`, 365 días son 12 meses y
    183 son 6.
  - Orden: `nunca` primero; luego de más a menos días; `ahora` al final. Empate: nombre
    (`localeCompare 'es'`).
  - Contadores: cuántos en `alarma`, `aviso` y `ok`. Los `nunca` cuentan en `alarma` (es lo
    más grave) y los `ahora` en `ok` (están descansando).
  - Umbrales (6 y 12 meses) como constantes del servicio y devueltos en la respuesta, para que
    la pantalla los diga sin reinventarlos.
- **Respuesta:** campo nuevo `descanso` en `Kpis`:

  ```ts
  descanso: {
    filas: {
      empleadoId: string;
      nombreCompleto: string;
      tramo: 'nunca' | 'alarma' | 'aviso' | 'ok' | 'ahora';
      diasSinVacaciones: number | null;
      mesesSinVacaciones: number | null;
      ultimoDia: string | null;     // YYYY-MM-DD
      deVacacionesAhora: boolean;
      diasProgramados: number;
      saldo: number;                // días disponibles, un decimal
    }[];
    conteo: { alarma: number; aviso: number; ok: number };
    umbralAvisoMeses: number;       // 6
    umbralAlarmaMeses: number;      // 12
  }
  ```

  Mismo endpoint y mismo candado (`ve_kpis` o admin).

## 4. Pantalla (apps/ausencias)

- `PanelKpis.tsx`: la sección nueva va donde estaba `AcumulacionExcesiva`, que deja de
  pintarse (y su componente se borra del front).
- Título «Cuánto lleva cada uno sin descansar». Subtítulo: tiempo desde el último día de
  vacaciones disfrutadas; solo cuentan vacaciones, no compensatorios ni permisos.
- Tres contadores: «Más de 12 meses» (rojo si > 0), «De 6 a 12 meses» (ámbar si > 0), «Menos
  de 6 meses».
- Lista: nombre y, a la derecha, el tiempo:
  - `nunca` → «sin vacaciones registradas» (rojo);
  - `ahora` → «de vacaciones ahora» (verde);
  - resto → «hace N días» si < 60 días, «hace N meses» si < 24 meses, «hace N años» después,
    con el color del tramo.
  - Debajo, en pequeño: «último día: 3 oct 2026» (si hay), «saldo 28,8 días» y «15 días ya
    pedidos» (verde) / «sin nada previsto» (ámbar).
- El texto del tiempo vive en una función pura con tests (`textoDeDescanso`).
- `descanso` es opcional en el tipo del front: si la respuesta no lo trae (portal desplegado
  antes que hub-api), la sección no se pinta.

## 5. Verificación

- BD: `planificacionDeVacaciones` marca `deVacacionesAhora` con una vacación que abarca hoy
  (incluido el primer y el último día) y no con una ya terminada ni con una futura.
- Unitarios de `descansoPorPersona`: los cinco tramos, los bordes (182/183 y 364/365 días),
  el orden, los contadores, empate por nombre.
- Ruta: la respuesta trae `descanso` con toda la plantilla.
- Front: tests de `textoDeDescanso`; `tsc` + `vite build`.
- Candados falsados rompiendo el código de verdad.

## 6. Despliegue

hub-api primero, portal después. Sin migración.

## 7. Fuera de alcance

- Fecha de ingreso para distinguir «recién entrado» de «nunca ha descansado» (la ficha no la
  tiene).
- Quitar `acumulacion` de hub-api.
