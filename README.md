# DZKr0nicasLauncher-servidores

La lista de servidores de DayZ que tienen jugadores, para el buscador de DZKr0nicasLauncher, un launcher de DayZ para Windows. La saca de la Web API de Steam una tarea de GitHub Actions y la publica en GitHub Pages. El launcher no lleva ninguna clave dentro: baja esta lista.

**Datos de [Steam](https://store.steampowered.com/).** Este proyecto no está respaldado por Valve ni por Steam, ni tiene relación con ellos. Los datos se dan **tal cual**, sin ninguna garantía: pueden estar incompletos o viejos. La lista es para los usuarios del launcher y su uso personal.

## Qué hay

| Archivo | Qué hace |
| --- | --- |
| `sonda.mjs` | Una sola petición a Steam, lanzada a mano (workflow «Sonda»), para saber si Steam contesta a las máquinas de GitHub. Imprime solo el código HTTP, el recuento y el tiempo |
| `sonda.test.mjs` | Sus pruebas, sin red (`node --test`) |

La tarea que publica la lista cada 15 minutos llega en el paso siguiente. El plan está en el repositorio privado del launcher: sprint 11, tarea 11.6 (b), y el ADR-003.

## Cómo se trata la clave

- Va solo como secreto `STEAM_WEB_API_KEY` del environment `steam`, que solo acepta la rama `main` y no se pueden saltar los administradores.
- Solo la ve el paso que llama a Steam. La manda por cabecera, sin seguir redirecciones, y nunca la imprime.
- Nada de lo que se publica lleva la clave.

**Para revocarla:** en `steamcommunity.com/dev/apikey`, «Revoke My Steam Web API Key». Después, el secreto nuevo:

```
gh secret set STEAM_WEB_API_KEY --env steam --repo kr0nicas/DZKr0nicasLauncher-servidores
```
