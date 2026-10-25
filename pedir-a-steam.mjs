// El paso con la clave de la tarea que publica (11.6 b2): pide la lista a Steam y escribe la respuesta
// cruda en el archivo que se le da (en $RUNNER_TEMP). No la valida ni la interpreta: eso lo hace
// `generar.mjs`, en otro paso y sin la clave. Imprime solo el código, el tamaño y el tiempo.
// Uso: node pedir-a-steam.mjs <archivo de salida>

import { writeFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fetchSteam } from './lib/steam.mjs'

export async function fetchToFile({ key, out, fetchImpl = fetch, write = writeFileSync }) {
  if (!out || !isAbsolute(out)) throw new Error('falta el archivo de salida, con ruta absoluta')
  const { status, text, ms } = await fetchSteam({ key, fetchImpl })
  if (status !== 200) throw new Error(`Steam contestó HTTP ${status}`)
  write(out, text)
  return `HTTP ${status}, ${Math.round(Buffer.byteLength(text) / 1024)} KB, ${ms} ms`
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  fetchToFile({ key: process.env.STEAM_WEB_API_KEY, out: process.argv[2] })
    .then((line) => console.log(line))
    .catch((error) => {
      console.error(`Error: ${error.message}`)
      process.exitCode = 1
    })
}
