# Equipos en taller · Tablero TV en modo kiosco

Cómo dejar el tablero kanban del taller fijo en un televisor, y cómo cambiar o anular la llave con la que entra. El funcionamiento general del módulo está en [equipos-taller.md](equipos-taller.md).

## Qué es

`/equipos-taller/tv` es la pantalla de TV del tablero: pantalla completa, sin menú, **solo lectura**. Se diseña a 1920×1080 y se escala a cualquier televisor (Full HD o 4K) sin barras de desplazamiento. Se refresca cada 60 s; los datos cambian cada hora, con cada sincronización de n8n.

Puede entrar de dos maneras:

| Cómo | Para qué |
|---|---|
| Con sesión del portal (menú lateral → «Tablero TV») | Un usuario con la app `equipos-taller`, o un admin, que quiere verla en su equipo. La sesión caduca a los 7 días. |
| Con una **llave de kiosco**, sin sesión | El televisor del taller, que no tiene a nadie delante para iniciar sesión. |

## La llave de kiosco

- La genera un **admin** en Ajustes → «Equipos en taller · Kiosco».
- Abre **una sola cosa**: los datos del tablero. No sirve para ninguna otra pantalla ni ruta del portal.
- No caduca. Deja de valer cuando se **revoca**, en la siguiente petición de la TV.
- En la base solo se guarda su resumen (SHA-256), nunca la llave. Por eso **no se puede volver a ver**: si se pierde, se genera otra.
- Viaja en el fragmento de la dirección (`#k=`). El navegador no manda esa parte al servidor ni a otras páginas; la TV la envía en la cabecera `X-Kiosk-Token`. La ruta de datos rechaza cualquier llave escrita en la URL.

> Quien tenga la dirección completa ve el tablero (clientes, seriales, técnicos y tickets) hasta que se revoque. No la mandes por chat ni por correo si no hace falta.

### Generar una

1. Ajustes → «Equipos en taller · Kiosco».
2. Escribe un nombre que identifique el televisor (por ejemplo «TV Taller»). No puede haber dos llaves activas con el mismo nombre.
3. **Generar**. Aparece la dirección completa, **una sola vez**:

   ```text
   https://<portal>/equipos-taller/tv#k=tvk_EJEMPLO_NO_ES_UNA_LLAVE_REAL_000000000
   ```

4. **Copiar**, y ábrela en el televisor. Al pulsar **Cerrar** ya no se puede recuperar.

## Dejar la TV en modo kiosco (Chrome)

Lanza Chrome con `--kiosk` y la dirección completa, **entre comillas** (por el `#`):

```bat
"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk --noerrdialogs --user-data-dir=C:\tv-taller "https://<portal>/equipos-taller/tv#k=tvk_EJEMPLO_NO_ES_UNA_LLAVE_REAL_000000000"
```

En Linux: `google-chrome --kiosk --noerrdialogs --user-data-dir=$HOME/tv-taller "https://<portal>/equipos-taller/tv#k=…"`.

- `--user-data-dir` aparte evita que se mezcle con el perfil normal de Chrome de ese equipo.
- Para que arranque sola, pon ese comando en un acceso directo dentro de la carpeta de inicio (Windows: `Win + R` → `shell:startup`).
- Desactiva la suspensión de pantalla y el ahorro de energía del sistema.
- Para salir del modo kiosco: `Alt + F4`.
- La llave se queda en la dirección: si la TV se recarga (`F5`) o se reinicia, vuelve a entrar sola. En modo kiosco la barra de direcciones no se ve.

## Tema día / noche

- Por defecto es **automático**: noche de 18:00 a 06:00, hora de Bogotá, con un fundido suave. Las horas se cambian en Ajustes → «Equipos en taller · Tablero».
- Para forzarlo, añade `?tema=` **antes** del `#`:

  ```text
  https://<portal>/equipos-taller/tv?tema=noche#k=tvk_EJEMPLO_NO_ES_UNA_LLAVE_REAL_000000000
  ```

  Valores: `dia`, `noche` o `auto`. Cualquier otro valor se trata como `auto`.

## Cambiar la llave sin dejar la TV a oscuras

1. Genera una llave nueva con otro nombre (por ejemplo «TV Taller 2»).
2. Cambia la dirección en el acceso directo de la TV y reinicia Chrome.
3. Comprueba que el tablero se ve.
4. Revoca la llave vieja.

## Revocar una llave

Ajustes → «Equipos en taller · Kiosco» → **Revocar** en su fila → **¿Seguro? Revocar**.

Surte efecto en la siguiente petición de esa TV (como mucho 60 s). La pantalla deja de mostrar datos y dice: «La llave de esta pantalla no es válida o fue revocada. Pide una nueva en Ajustes.»

## Si algo falla

| La TV muestra | Qué pasa | Qué hacer |
|---|---|---|
| «La llave de esta pantalla no es válida o fue revocada…» | La llave se revocó, o la dirección se copió incompleta. | Generar otra llave y cambiar la dirección. |
| «Datos desactualizados desde HH:MM» | La TV no consigue hablar con el servidor desde hace más de 5 minutos (red o hub-api caído). Mantiene la última foto. | Se recupera sola al volver la conexión. Si dura, revisar la red de la TV y hub-api. |
| «datos de las HH:MM» con varias horas de atraso | El servidor responde, pero la copia de Drive o la corrida no se actualizan. | Ver los avisos de la pantalla y [equipos-taller.md](equipos-taller.md) (sincronización de n8n, causas de fallo). |
| No carga | La ruta de la TV admite 10 peticiones por minuto y por IP. Una TV pide 1 por minuto: el límite solo se nota con muchas TV detrás de la misma IP pública. | Recargar (`F5`); si son muchas TV, repartirlas o hablar con quien mantiene hub-api. |
| En blanco o congelada | Fallo del navegador. | `F5`. La llave sigue en la dirección. |

## Marcha atrás

Si hubiera que retirar el tablero TV: revocar **todas** las llaves, desplegar la versión anterior del portal y después la de hub-api. La migración 074 (`portal.equipos_tablero_config` y `portal.equipos_kiosco`) solo añade tablas y se puede quedar.
