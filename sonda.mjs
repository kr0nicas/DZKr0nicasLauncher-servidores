// La sonda (11.6 b1): una sola petición a la Web API de Steam, para saber si Steam contesta a las
// máquinas de GitHub antes de montar la tarea programada.
//
// Imprime solo el código HTTP, el recuento y el tiempo. Nunca la URL, el cuerpo ni la clave: la clave
// va por cabecera, solo en la variable de entorno STEAM_WEB_API_KEY del paso que la ejecuta.
// Sin dependencias.

import { pathToFileURL } from 'node:url'

const API = 'https://api.steampowered.com/IGameServersService/GetServerList/v1/'
/** Solo los servidores que no están vacíos: la parte que se publicará (ADR-003). */
export const FILTER = '\\appid\\221100\\empty\\1'
/** Lo más que da Steam en una petición (medido el 24-oct). Llegar a él es salir cortada. */
export const STEAM_CAP = 10000
const MAX_BYTES = 32 * 1024 * 1024
const TOO_BIG = `la respuesta pasa de ${MAX_BYTES / 1048576} MB`
const TIMEOUT_MS = 60_000
const KEY = /^[0-9A-Fa-f]{32}$/

/** Cuántos servidores trae una respuesta de GetServerList. */
export function countServers(json) {
  const list = json?.response?.servers
  if (!Array.isArray(list)) throw new Error('la respuesta no trae response.servers como lista')
  return list.length
}

/** Lee el cuerpo en trozos y con tope: no se lee entero algo que no debería ser tan grande. */
async function readCapped(res) {
  const chunks = []
  let size = 0
  for await (const chunk of res.body ?? []) {
    size += chunk.length
    if (size > MAX_BYTES) throw new Error(TOO_BIG)
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Una petición a Steam. Los errores nunca llevan la URL, el cuerpo ni la causa original, que
 * podrían llevar la clave.
 */
export async function probe({ key, fetchImpl = fetch, now = () => Date.now() }) {
  if (!KEY.test(key ?? '')) throw new Error('falta STEAM_WEB_API_KEY (32 caracteres hexadecimales)')
  const url = new URL(API)
  url.searchParams.set('filter', FILTER)
  url.searchParams.set('limit', String(STEAM_CAP))
  const started = now()
  let res
  try {
    res = await fetchImpl(url, {
      // Una redirección no se sigue: la cabecera de la clave iría con ella a otro sitio.
      redirect: 'error',
      headers: { 'x-webapi-key': key, 'User-Agent': 'DZKr0nicasLauncher-servidores' },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
  } catch (error) {
    throw new Error(`no se pudo llamar a Steam (${error?.name ?? 'Error'})`)
  }
  const ms = now() - started
  if (res.status !== 200) return { status: res.status, count: null, ms }
  if (!(res.headers.get('content-type') ?? '').includes('json'))
    throw new Error('Steam no contestó con JSON')
  let text
  try {
    text = await readCapped(res)
  } catch (error) {
    // Un corte a mitad del cuerpo sale con un mensaje fijo, sin el original.
    throw new Error(
      error?.message === TOO_BIG ? TOO_BIG : `no se pudo leer la respuesta (${error?.name ?? 'Error'})`
    )
  }
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error('Steam contestó algo que no es JSON válido')
  }
  return { status: 200, count: countServers(json), ms }
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
