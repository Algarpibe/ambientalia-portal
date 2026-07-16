# Privacidad, retención y borrado — antigravity-suite

> Cierra **PRIV-002** de la auditoría (retención/supresión). Ámbito: la réplica
> **zoho-hub** y las apps del portal que la leen. La política de tratamiento a
> nivel organizacional y el aviso de privacidad público (PRIV-003) son un asunto
> legal aparte; aquí se documenta la parte técnica y el proceso operativo.
>
> Campos marcados **`[Definir]`** son decisiones de negocio/legales que deben
> completar el responsable de tratamiento y el área legal — no se asumen aquí.

## 1. Marco legal

Ley 1581 de 2012 (Colombia) y Decreto 1074 de 2015. Derechos del titular
(art. 8): **conocer, actualizar, rectificar y suprimir** sus datos, y revocar la
autorización. Este documento define cómo se atienden **rectificación y
supresión** en esta capa técnica.

- **Responsable del tratamiento:** `[Definir: razón social + NIT de Ambientalia]`
- **Área/rol que atiende solicitudes de titulares:** `[Definir: p. ej. protecciondedatos@ambientalia.com.co]`
- **Plazo legal de respuesta:** consulta ≤ 10 días hábiles; reclamo ≤ 15 días
  hábiles (Ley 1581, arts. 14–15).

## 2. Inventario de datos en el hub

`zoho-hub` es una **réplica read-only** de Zoho (CRM/Books/Desk). El API
`hub-api` expone, de esa réplica, únicamente:

- **`customer_name`** (razón social del cliente, campo "Cliente"). Para clientes
  persona natural puede constituir dato personal.
- **Cifras agregadas**: facturas, pagos, ítems/SKU, montos, fechas.

**No** se expone email, teléfono, cédula ni dirección (minimización verificada en
auditoría, FASE 8).

**El NIT es la única excepción, y solo en la app WO-sales.** Es una columna
obligatoria (`Encab: Tercero Externo`) del archivo plano que World Office importa
para crear los pedidos: sin él la carga es imposible. Finalidad contable, base
legal en la ejecución de la relación comercial. Para clientes persona natural el
NIT constituye dato personal (Ley 1581 de 2012).

Medidas asociadas:

- **Acceso restringido por app**: los endpoints `/api/wo-sales/*` comprueban
  `apps[]` del JWT en el servidor mediante `requireApp('WO-sales')`, no solo en el
  frontend. Es el único endpoint de datos del portal que lo hace; el resto se
  conforma con `requireAuth`, porque no exponen PII más allá de `customer_name`.
- **Se lee de `books.contacts.nit`**, solo para las OV vivas del rango consultado.
  No se almacena ni se cachea: el CSV se genera bajo demanda y se descarga.

Los `query params` son fechas y un nombre de cliente opcional.

## 3. Arquitectura del dato (clave para retención/borrado)

```
Zoho (FUENTE DE VERDAD)  ──sync (worker @algarpibe/zoho-sync, ~cada 3 min)──▶  zoho-hub (réplica read-only)  ──▶  hub-api  ──▶  portal
```

- **Sistema de registro = Zoho.** El hub es un derivado; **no** se edita ni se
  borra directamente en el hub (el usuario de DB solo tiene `SELECT`).
- Cualquier rectificación o supresión debe hacerse **en Zoho**, y **propagarse**
  al hub por el worker de sincronización.

## 4. Política de retención

- El hub **no define una retención propia**: refleja lo que exista en Zoho. El
  dato vive en el hub mientras exista en Zoho.
- **Retención en Zoho (fuente):** `[Definir: periodo de conservación de datos de
  clientes/facturación — típicamente ligado a obligaciones contables/tributarias,
  p. ej. conservación de soportes contables]`.
- Al vencer la retención (o ante una supresión aprobada) el registro se elimina
  o anonimiza **en Zoho**, y el cambio debe reflejarse en el hub (§5, §6).

## 5. Proceso de rectificación / supresión (paso a paso)

1. **Recepción**: la solicitud del titular llega al canal definido (`[Definir]`).
2. **Verificación de identidad** del solicitante: `[Definir método]`.
3. **Procedencia legal**: validar que no aplique una excepción (p. ej. deber
   legal de conservar soportes contables/tributarios). `[Legal]`.
4. **Acción en Zoho** (sistema de registro): rectificar o suprimir/anonimizar el
   registro del cliente.
5. **Propagación al hub**: asegurar que el cambio llegue a `zoho-hub` (ver §6 —
   hoy hay una brecha técnica a cerrar).
6. **Verificación**: confirmar que el hub ya no expone el dato (query de §7).
7. **Registro y respuesta**: documentar la solicitud y responder al titular
   dentro del plazo legal.

## 6. Brecha técnica a cerrar (propagación de borrados)

El worker de sync (`@algarpibe/zoho-sync`, **fuera de este repo**) sincroniza
Zoho → hub. **Requisito a verificar/implementar en el worker:**

- Si el worker solo hace **upsert** (insert/update) y **nunca borra**, un
  registro **eliminado en Zoho quedaría huérfano** en el hub indefinidamente —
  incumpliendo una supresión. Esto es lo que PRIV-002 marca como pendiente.
- **Recomendación para el worker** (elegir una):
  - **Reconciliación por barrido**: tras cada sync, borrar del hub las filas
    cuyo identificador ya no exista en el conjunto traído de Zoho (delete-by-diff).
  - **Tombstones**: que Zoho marque bajas y el worker propague el borrado.
  - Como mínimo, un **job periódico de reconciliación** (p. ej. diario) que
    elimine huérfanos.

> Acción: confirmar el comportamiento actual del worker y, si solo hace upsert,
> implementar el borrado propagado. Se rastrea como tarea del repo del worker.

## 7. Verificación / auditoría

Consulta de control para detectar si un cliente **suprimido en Zoho sigue en el
hub** (ejecutar en la DB `zoho-hub`, ajustando el nombre):

```sql
-- ¿El cliente "X" todavía aparece en la réplica?
SELECT 'invoices' AS origen, count(*) FROM books.invoices        WHERE customer_name ILIKE '%X%'
UNION ALL
SELECT 'payments',            count(*) FROM books.customer_payments WHERE customer_name ILIKE '%X%';
```

Si tras la supresión en Zoho + sync estas cuentas no llegan a 0, la propagación
de borrado (§6) no está funcionando.

## 8. Relacionados

- **PRIV-003** (aviso de privacidad público en el portal): pendiente, asunto
  legal — publicar la política de tratamiento y el canal de derechos del titular.
- **Minimización**: no añadir email/NIT/teléfono a las queries del hub sin revisar
  esta política. Única excepción vigente: el NIT en WO-sales (ver §2), por finalidad
  contable y con acceso restringido por app. Cualquier otra ampliación de la
  superficie de PII debe decidirse de forma explícita y quedar documentada aquí, no
  colarse dentro de una query.
