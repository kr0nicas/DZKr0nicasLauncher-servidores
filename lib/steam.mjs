// La única petición con la clave: GetServerList de la Web API de Steam, solo con los servidores que no
// están vacíos. La usan la sonda y la tarea que publica. Sin dependencias.
//
// La clave va por la cabecera `x-webapi-key`, nunca en la URL, y sin seguir redirecciones: en una
// redirección, `fetch` solo quita `Authorization` y `Cookie`, no una cabecera propia. Ningún error
// lleva la URL, el cuerpo ni la causa original, que podrían llevar la clave.

const API = 'https://api.steampowered.com/IGameServersService/GetServerList/v1/'
/** Solo los servidores que no están vacíos: la parte que se publica (ADR-003). */
export const FILTER = '\\appid\\221100\\empty\\1'
/** Lo más que da Steam en una petición (medido el 24-oct). Llegar a él es salir cortada. */
export const STEAM_CAP = 10000
export const MAX_BYTES = 32 * 1024 * 1024
export const TOO_BIG = `la respuesta pasa de ${MAX_BYTES / 1048576} MB`
const TIMEOUT_MS = 60_000
const KEY = /^[0-9A-Fa-f]{32}$/

/** Lee un cuerpo en trozos y con tope; un corte a mitad sale con un mensaje fijo. */
export async function readCapped(res, maxBytes, tooBig) {
  const chunks = []
  let size = 0
  try {
    for await (const chunk of res.body ?? []) {
      size += chunk.length
      if (size > maxBytes) throw new Error(tooBig)
      chunks.push(chunk)
    }
  } catch (error) {
    throw new Error(
      error?.message === tooBig ? tooBig : `no se pudo leer la respuesta (${error?.name ?? 'Error'})`
    )
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Pide la lista a Steam. Devuelve el código HTTP, el texto del cuerpo (solo con 200 y JSON) y el
 * tiempo. No interpreta el JSON: eso lo hace quien lo valida, sin la clave.
 */
export async function fetchSteam({ key, fetchImpl = fetch, now = () => Date.now() }) {
  if (!KEY.test(key ?? '')) throw new Error('falta STEAM_WEB_API_KEY (32 caracteres hexadecimales)')
  const url = new URL(API)
  url.searchParams.set('filter', FILTER)
  url.searchParams.set('limit', String(STEAM_CAP))
  const started = now()
  let res
  try {
    res = await fetchImpl(url, {
      redirect: 'error',
      headers: { 'x-webapi-key': key, 'User-Agent': 'DZKr0nicasLauncher-servidores' },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
  } catch (error) {
    throw new Error(`no se pudo llamar a Steam (${error?.name ?? 'Error'})`)
  }
  if (res.status !== 200) return { status: res.status, text: null, ms: now() - started }
  if (!(res.headers.get('content-type') ?? '').includes('json'))
    throw new Error('Steam no contestó con JSON')
  const text = await readCapped(res, MAX_BYTES, TOO_BIG)
  return { status: 200, text, ms: now() - started }
}
