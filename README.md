# DZKr0nicasLauncher-servidores

La lista de servidores de DayZ que tienen jugadores, para el buscador de DZKr0nicasLauncher, un launcher de DayZ para Windows. La saca de la Web API de Steam una tarea de GitHub Actions y la publica en GitHub Pages. El launcher no lleva ninguna clave dentro: baja esta lista.

**Datos de [Steam](https://store.steampowered.com/).** Este proyecto no está respaldado por Valve ni por Steam, ni tiene relación con ellos. Los datos se dan **tal cual**, sin ninguna garantía: pueden estar incompletos o viejos. La lista es para los usuarios del launcher y su uso personal.

## Qué hay

**La lista**, cada 15 minutos (GitHub puede retrasar o saltarse alguna pasada):
- <https://kr0nicas.github.io/DZKr0nicasLauncher-servidores/servidores-firmada.json>, firmada con Ed25519: la lee el launcher desde la 0.5.0-beta.4;
- <https://kr0nicas.github.io/DZKr0nicasLauncher-servidores/servidores.json>, la misma sin firma, para las versiones anteriores. Se deja de publicar dos semanas después de repartir la 0.5.0-beta.4.

| Archivo | Qué hace |
| --- | --- |
| `.github/workflows/publicar.yml` | Cada 15 minutos: pide la lista, la valida, la firma y la publica en Pages. El trabajo con la clave de Steam no firma ni despliega, el que firma no tiene la clave de Steam, y el que despliega no ve ningún secreto |
| `lib/steam.mjs` | La única petición con la clave: `GetServerList` con `\appid\221100\empty\1`, por cabecera, sin seguir redirecciones |
| `pedir-a-steam.mjs` | El paso con la clave: escribe la respuesta cruda en `$RUNNER_TEMP` y nada más |
| `generar.mjs` | El paso sin clave: valida, compara con la última lista publicada y deja en `_site/` solo `servidores.json` e `index.html` |
| `firmar.mjs` y `lib/firma.mjs` | El paso que firma: vuelve a validar la lista con las funciones de `generar.mjs`, comprueba que la privada es la de una pública de `claves-publicas.json` y deja al lado `servidores-firmada.json` |
| `claves-publicas.json` | Las claves públicas aceptadas: la de la CI y la de repuesto. Son las mismas que lleva el launcher |
| `crear-clave-ci.mjs` | Crea el par de la CI: la privada va directa al secreto, sin pantalla ni disco, y la pública a `claves-publicas.json` |
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
  - `region`, el código de región de Steam (0 a 255) o `null` si no tiene (Steam da `-1`);
  - `etiquetas`: solo `battleye`, `no3rd` (solo primera persona) y `mod`.
- **Dentro del formato 1 solo se añaden campos.** Un cambio incompatible sale como otro archivo, nunca en esta URL.

## Cuándo no se publica

Si pasa cualquiera de estas cosas, la pasada falla y sigue en línea la lista anterior:
- Steam no contesta bien;
- llegan 10 000 entradas (estaría cortada);
- más del 5 % de las entradas están mal (sin contar las de una IP de más de 512, que se descarta entera);
- quedan menos de 1000 o más de 8000 servidores;
- con una lista publicada de menos de 3 h, el recuento cambia más del 50 % o `generado` no avanza.

Una IP con más de 512 servidores se descarta entera y se publica el resto.

**Sin una lista publicada de menos de 3 h** (la primera vez, tras un corte largo, o si la publicada está mal), no hay con qué comparar: solo cuentan los topes de 1000 y 8000. Es a propósito, para que una lista mala no congele la publicación para siempre.

## Que no se apague

GitHub apaga el `schedule` de un repositorio público tras 60 días sin actividad. Para evitarlo:
- **El trabajo `mantener`** de «Publicar» corre una vez al día (00:07 UTC). Sin clave, sin checkout y solo con el permiso de encender workflows, vuelve a encender «Publicar». Se puede lanzar a mano con «solo_mantener».
- **Sin comprobar:** que encenderlo así reinicie la cuenta de los 60 días. Se sabrá cuando pasen.
- **Los PR de Dependabot que se fusionan** cuentan como actividad.
- **Si la página dice una hora vieja,** se enciende a mano en Actions → «Publicar» → «Enable workflow», o con:

  `gh workflow enable publicar.yml --repo kr0nicas/DZKr0nicasLauncher-servidores`

El launcher marca como vieja una lista de más de 24 h y la oculta a los 7 días.

**Si una caída es real:** Actions → «Publicar» → «Run workflow», con «aceptar_cambio» marcado. Se salta solo la comparación con la lista anterior; los topes de 1000 y 8000 siguen.

El plan está en el repositorio privado del launcher: sprint 11, tarea 11.6 (b), y el ADR-003.

## Formato de `servidores-firmada.json` (sobre, formato 1)

```json
{ "formato": 1, "clave": "6c7d726e3d41f1e6", "firma": "<64 bytes en base64>", "lista": "<el texto de servidores.json>" }
```

- **Lo firmado** son los bytes UTF-8 de `DZKr0nicasLauncher/lista-global/1\n` seguidos de `lista`, tal cual.
- **`clave`** son los 8 primeros bytes, en hex, del SHA-256 de la clave pública en DER SPKI. Solo sirve para buscarla entre las que lleva el launcher.
- El launcher solo acepta esas cuatro claves, la firma en base64 canónico y una lista que, ya verificada, vuelve a pasar todas sus reglas.

## Cómo se trata la clave de firma

- **La privada de la CI** va solo como secreto `LISTA_FIRMA_PRIVADA` del environment `firma`, que solo acepta la rama `main`. Solo la ve el paso «Firmar», en un trabajo sin la clave de Steam. No se imprime nada de ella.
- **La de repuesto** la guarda el autor fuera de GitHub, en su gestor de contraseñas. Su pública está en `claves-publicas.json` y en el launcher.
- **Si se pierde el secreto** (GitHub no deja leerlo): se pone la de repuesto, `gh secret set LISTA_FIRMA_PRIVADA --env firma --repo kr0nicas/DZKr0nicasLauncher-servidores`, y se pega por la entrada estándar. Los launchers no se enteran.
- **Si se filtra una privada:** no hay revocación sin sacar versión. Se cambia el secreto (`node crear-clave-ci.mjs --rotar`, o la de repuesto), se saca un launcher sin la clave filtrada y se avisa por Discord. Hasta que todos actualicen, quien tenga la filtrada y además controle el nombre `kr0nicas.github.io` podría colar una lista.
- **Si la firma falla, no se publica nada:** sigue en línea la última lista buena, y GitHub manda el correo de fallo.

## Cómo se trata la clave de Steam

- Va solo como secreto `STEAM_WEB_API_KEY` del environment `steam`, que solo acepta la rama `main` y no se pueden saltar los administradores.
- Solo la ve el paso que llama a Steam. La manda por cabecera, sin seguir redirecciones, y nunca la imprime.
- Nada de lo que se publica lleva la clave.

**Para revocarla:** en `steamcommunity.com/dev/apikey`, «Revoke My Steam Web API Key». Después, el secreto nuevo:

```
gh secret set STEAM_WEB_API_KEY --env steam --repo kr0nicas/DZKr0nicasLauncher-servidores
```
