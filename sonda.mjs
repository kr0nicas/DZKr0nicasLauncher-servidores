// La sonda (11.6 b1): una sola petición a la Web API de Steam, para saber si Steam contesta a las
// máquinas de GitHub. Imprime solo el código HTTP, el recuento y el tiempo. Nunca la URL, el cuerpo
// ni la clave. Sin dependencias.

import { pathToFileURL } from 'node:url'
import { FILTER, STEAM_CAP, fetchSteam } from './lib/steam.mjs'

export { FILTER, STEAM_CAP }

/** Cuántos servidores trae una respuesta de GetServerList. */
export function countServers(json) {
  const list = json?.response?.servers
  if (!Array.isArray(list)) throw new Error('la respuesta no trae response.servers como lista')
  return list.length
}

/** Una petición a Steam y su recuento. */
export async function probe({ key, fetchImpl = fetch, now = () => Date.now() }) {
  const { status, text, ms } = await fetchSteam({ key, fetchImpl, now })
  if (status !== 200) return { status, count: null, ms }
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error('Steam contestó algo que no es JSON válido')
  }
  return { status, count: countServers(json), ms }
}

/** La línea que se imprime: sin URL, sin cuerpo y sin clave. */
export function report({ status, count, ms }) {
  const lines = [`HTTP ${status}, ${count ?? '-'} servidores no vacíos, ${ms} ms`]
  if (count !== null && count >= STEAM_CAP)
    lines.push(`AVISO: llega a ${STEAM_CAP}, el tope de Steam por petición: estaría cortada`)
  if (status === 403) lines.push('Steam rechaza la clave (403): mal copiada, revocada o sin permiso')
  return lines.join('\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  probe({ key: process.env.STEAM_WEB_API_KEY })
    .then((result) => {
      console.log(report(result))
      if (result.status !== 200) process.exitCode = 1
    })
    .catch((error) => {
      console.error(`Error: ${error.message}`)
      process.exitCode = 1
    })
}
