# DZKr0nicasLauncher-servidores

La lista de servidores de DayZ que tienen jugadores, para el buscador de DZKr0nicasLauncher, un launcher de DayZ para Windows. La saca de la Web API de Steam una tarea de GitHub Actions y la publica en GitHub Pages. El launcher no lleva ninguna clave dentro: baja esta lista.

**Datos de [Steam](https://store.steampowered.com/).** Este proyecto no está respaldado por Valve ni por Steam, ni tiene relación con ellos. Los datos se dan **tal cual**, sin ninguna garantía: pueden estar incompletos o viejos. La lista es para los usuarios del launcher y su uso personal.

## Qué hay

**La lista:** <https://kr0nicas.github.io/DZKr0nicasLauncher-servidores/servidores.json>, cada 15 minutos (GitHub puede retrasar o saltarse alguna pasada).

| Archivo | Qué hace |
| --- | --- |
| `.github/workflows/publicar.yml` | Cada 15 minutos: pide la lista, la valida y la publica en Pages. El trabajo que lleva la clave no despliega, y el que despliega no ve ningún secreto |
| `lib/steam.mjs` | La única petición con la clave: `GetServerList` con `\appid\221100\empty\1`, por cabecera, sin seguir redirecciones |
| `pedir-a-steam.mjs` | El paso con la clave: escribe la respuesta cruda en `$RUNNER_TEMP` y nada más |
| `generar.mjs` | El paso sin clave: valida, compara con la última lista publicada y deja en `_site/` solo `servidores.json` e `index.html` |
| `sonda.mjs` | Una sola petición a Steam, lanzada a mano (workflow «Sonda»): código HTTP, recuento y tiempo |
| `fixtures/hostil.json` y `hostil.esperado.json` | Una respuesta hostil y lo que tiene que salir de ella. El launcher usa las mismas en sus pruebas |
| `*.test.mjs` | Las pruebas, sin red (`node --test`) |

## Formato de `servidores.json` (formato 1)

```json
{ "formato": 1, "generado": 1792905023, "fuente": "Steam Web API", "vacios": false, "servidores": [ … ] }
```

- **`generado`:** la hora de la pasada, en segundos Unix.
- **`vacios: false`:** solo están los servidores con jugadores.
- **Cada servidor** lleva:
  - `ip` y `query`;
  - `game`, el puerto de juego: `null` si Steam no lo da;
  - `name` y `map`;
  - `players` y `maxPlayers`;
  - `version`;
  - `region`, el código de región de Steam (0 a 255) o `null`;
  - `etiquetas`: solo `battleye`, `no3rd` (solo primera persona) y `mod`.
- **Dentro del formato 1 solo se añaden campos.** Un cambio incompatible sale como otro archivo, nunca en esta URL.

## Cuándo no se publica

Si pasa cualquiera de estas cosas, la pasada falla y sigue en línea la lista anterior:
- Steam no contesta bien;
- llegan 10 000 entradas (estaría cortada);
- se descarta más del 5 % de las entradas;
- quedan menos de 1000 o más de 8000 servidores;
- con una lista publicada de menos de 3 h, el recuento cambia más del 50 % o `generado` no avanza.

Una IP con más de 512 servidores se descarta entera y se publica el resto.

**Si una caída es real:** Actions → «Publicar» → «Run workflow», con «aceptar_cambio» marcado. Se salta solo la comparación con la lista anterior; los topes de 1000 y 8000 siguen.

El plan está en el repositorio privado del launcher: sprint 11, tarea 11.6 (b), y el ADR-003.

## Cómo se trata la clave

- Va solo como secreto `STEAM_WEB_API_KEY` del environment `steam`, que solo acepta la rama `main` y no se pueden saltar los administradores.
- Solo la ve el paso que llama a Steam. La manda por cabecera, sin seguir redirecciones, y nunca la imprime.
- Nada de lo que se publica lleva la clave.

**Para revocarla:** en `steamcommunity.com/dev/apikey`, «Revoke My Steam Web API Key». Después, el secreto nuevo:

```
gh secret set STEAM_WEB_API_KEY --env steam --repo kr0nicas/DZKr0nicasLauncher-servidores
```
