// El paso sin clave de la tarea que publica (11.6 b2): valida la respuesta cruda de Steam, la compara
// con la última lista publicada y, si todo cuadra, deja en la carpeta de salida solo `servidores.json`
// e `index.html`. Si algo no cuadra, falla y no escribe nada: sigue en línea la lista anterior.
// Imprime solo cifras: ninguna IP, ningún nombre, nada que venga de Steam. Sin dependencias.
// Uso: node generar.mjs <respuesta cruda de Steam> <carpeta de salida>
//
// Las reglas son las de la prueba de cobertura del launcher (spikes/master-list/web-api-cobertura.mts)
// y del ADR-003, escritas otra vez porque este repositorio es público y el del launcher no. El launcher
// vuelve a validar todo lo que baja: no se fía de esta validación.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { STEAM_CAP, readCapped } from './lib/steam.mjs'

export const FORMATO = 1
/** Una IP con más servidores que esto se descarta entera (decisión del autor, 24-oct). */
export const MAX_PER_IP = 512
/** Topes absolutos del recuento publicado: fuera de ellos, algo va mal. */
export const MIN_SERVERS = 1000
export const MAX_SERVERS = 8000
/** Lo más que se puede descartar de la respuesta, contando las IP de más de 512. */
export const MAX_DROPPED = 0.05
/** Lo más que puede cambiar el recuento respecto a la última lista publicada, sin `aceptar_cambio`. */
export const MAX_CHANGE = 0.5
/** Una lista publicada de hace más de esto no sirve para comparar. */
export const BASE_MAX_AGE_S = 3 * 3600
/** Holgura de reloj para un `generado` que viene del futuro. */
export const FUTURE_SLACK_S = 600
export const BASE_URL =
  'https://kr0nicas.github.io/DZKr0nicasLauncher-servidores/servidores.json'
const BASE_MAX_BYTES = 4 * 1024 * 1024
const BASE_TOO_BIG = 'la lista publicada pasa de 4 MB'
const BASE_TIMEOUT_MS = 20_000

export const MIN_PORT = 1024
/** Puertos que ninguna lista debe poder dirigir, aunque pasen de 1024 (ADR-003). */
export const DENIED_PORTS = new Set([53, 123, 161, 1900, 3702, 5353, 11211])
export const MAX_PLAYERS = 200
/** Las únicas etiquetas que se sacan de `gametype`. */
export const TAGS = ['battleye', 'no3rd', 'mod']
const NAME_MAX = 100
const MAP_MAX = 40
const VERSION_MAX = 20

// --- Direcciones: las mismas reglas que src/core/directory/endpoint.ts del launcher ---

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

/** IPv4 completa, con cada octeto entre 0 y 255 y sin ceros a la izquierda. */
export function isIpv4(text) {
  return (
    IPV4.exec(text)
      ?.slice(1)
      .every((octet) => Number(octet) <= 255 && (octet === '0' || !octet.startsWith('0'))) ?? false
  )
}

/** Una IPv4 de internet: ni privada, ni de este equipo, ni de enlace local, ni reservada. */
export function isPublicIpv4(ip) {
  if (!isIpv4(ip)) return false
  const [a, b, c] = ip.split('.').map(Number)
  if (a === 0 || a === 10 || a === 127) return false
  if (a === 100 && b >= 64 && b <= 127) return false
  if (a === 169 && b === 254) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && ((b === 0 && c === 0) || b === 168)) return false
  if (a === 198 && (b === 18 || b === 19)) return false
  if (a >= 224) return false
  if (a === 192 && b === 0 && c === 2) return false
  if (a === 192 && b === 88 && c === 99) return false
  if (a === 198 && b === 51 && c === 100) return false
  if (a === 203 && b === 0 && c === 113) return false
  return true
}

/** Un puerto que una lista puede dirigir: entero, de 1024 a 65535 y fuera de los denegados. */
export const goodPort = (p) =>
  Number.isInteger(p) && p >= MIN_PORT && p <= 65535 && !DENIED_PORTS.has(p)

// --- Textos: las mismas reglas que src/core/text/safe-name.ts (`cleanServerName`) del launcher ---

const IGNORABLE = /[\p{Default_Ignorable_Code_Point}ᅟᅠㅤﾠ]/gu
// eslint-disable-next-line no-control-regex -- se buscan los de control a propósito, para quitarlos
const ANSI = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)?)/g
const NOT_SERVER_NAME_CHAR = /[^\p{L}\p{N} _./@()[\]#+\-|:!&',~*–—…]/gu

/** Un texto en lo imprimible y seguro, recortado por puntos de código (no parte un emoji ni un par). */
export function cleanText(raw, max) {
  if (typeof raw !== 'string') return ''
  const clean = raw
    .replace(ANSI, '')
    .replace(IGNORABLE, '')
    .replace(/\s+/gu, ' ')
    .replace(NOT_SERVER_NAME_CHAR, '')
    .replace(/ {2,}/g, ' ')
    .trim()
  return [...clean].slice(0, max).join('').trim()
}

const int = (v) => (typeof v === 'number' && Number.isInteger(v) ? v : null)

// --- La respuesta de Steam ---

/**
 * Pasa la respuesta de GetServerList a la forma publicada. Descarta entrada a entrada lo que no vale y,
 * al final, las IP que pasan de MAX_PER_IP, enteras. Ordena por jugadores, para que la salida sea
 * estable entre pasadas iguales.
 */
export function parseSteam(raw) {
  const list = raw?.response?.servers
  if (!Array.isArray(list)) throw new Error('la respuesta no trae response.servers como lista')
  const dropped = {
    forma: 0,
    ip: 0,
    puerto: 0,
    'puerto-juego': 0,
    region: 0,
    repetida: 0,
    'tope-por-ip': 0
  }
  const seen = new Set()
  const perIp = new Map()
  const kept = []
  for (const item of list) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      dropped.forma++
      continue
    }
    const m = /^([0-9.]{7,15}):(\d{1,5})$/.exec(typeof item.addr === 'string' ? item.addr : '')
    const ip = m?.[1] ?? ''
    const query = m ? Number(m[2]) : null
    if (!isPublicIpv4(ip)) {
      dropped.ip++
      continue
    }
    if (!goodPort(query)) {
      dropped.puerto++
      continue
    }
    const gameRaw = item.gameport === undefined || item.gameport === null ? null : int(item.gameport)
    if (item.gameport !== undefined && item.gameport !== null && !goodPort(gameRaw)) {
      dropped['puerto-juego']++
      continue
    }
    const regionRaw = item.region === undefined || item.region === null ? null : int(item.region)
    if (item.region !== undefined && item.region !== null && (regionRaw === null || regionRaw < 0 || regionRaw > 255)) {
      dropped.region++
      continue
    }
    const key = `${ip}:${query}`
    if (seen.has(key)) {
      dropped.repetida++
      continue
    }
    seen.add(key)
    perIp.set(ip, (perIp.get(ip) ?? 0) + 1)
    const maxPlayers = Math.min(Math.max(0, int(item.max_players) ?? 0), MAX_PLAYERS)
    const players = int(item.players)
    const version = typeof item.version === 'string' ? item.version : ''
    const gametype = typeof item.gametype === 'string' ? item.gametype.split(',') : []
    kept.push({
      ip,
      query,
      game: gameRaw,
      name: cleanText(item.name, NAME_MAX),
      map: cleanText(item.map, MAP_MAX),
      // Unos jugadores imposibles se dejan en 0, no se descarta la entrada.
      players: players !== null && players >= 0 && players <= maxPlayers ? players : 0,
      maxPlayers,
      version: version.length <= VERSION_MAX && /^\d+(\.\d+){1,3}$/.test(version) ? version : '',
      region: regionRaw,
      etiquetas: TAGS.filter((t) => gametype.includes(t))
    })
  }
  const overCap = new Set([...perIp].filter(([, n]) => n > MAX_PER_IP).map(([ip]) => ip))
  const servers = kept
    .filter((s) => !overCap.has(s.ip))
    .sort((a, b) => b.players - a.players || (a.ip < b.ip ? -1 : a.ip > b.ip ? 1 : a.query - b.query))
  dropped['tope-por-ip'] = kept.length - servers.length
  return { servers, dropped, total: list.length, overCapIps: overCap.size }
}

// --- La última lista publicada (la base) ---

/** Si una entrada tiene la forma publicada; para revalidar la base. */
export function isPublishedEntry(s) {
  return (
    typeof s === 'object' &&
    s !== null &&
    isPublicIpv4(s.ip) &&
    goodPort(s.query) &&
    (s.game === null || goodPort(s.game)) &&
    typeof s.name === 'string' &&
    [...s.name].length <= NAME_MAX &&
    typeof s.map === 'string' &&
    [...s.map].length <= MAP_MAX &&
    Number.isInteger(s.maxPlayers) &&
    s.maxPlayers >= 0 &&
    s.maxPlayers <= MAX_PLAYERS &&
    Number.isInteger(s.players) &&
    s.players >= 0 &&
    s.players <= s.maxPlayers &&
    typeof s.version === 'string' &&
    s.version.length <= VERSION_MAX &&
    (s.region === null || (Number.isInteger(s.region) && s.region >= 0 && s.region <= 255)) &&
    Array.isArray(s.etiquetas) &&
    s.etiquetas.every((t) => TAGS.includes(t))
  )
}

const noBase = (reason) => ({ count: null, generado: null, reason })

/**
 * La base para comparar, o «sin base» con su porqué. Solo se usan su recuento y su `generado`. Una base
 * corrupta, de otro formato, del futuro o de hace más de 3 h cuenta como «sin base»: así una mala no
 * congela la publicación para siempre.
 */
export function parseBase(json, nowS) {
  if (json?.formato !== FORMATO) return noBase('de otro formato')
  if (!Number.isInteger(json.generado)) return noBase('sin «generado»')
  if (json.generado > nowS + FUTURE_SLACK_S) return noBase('con «generado» en el futuro')
  if (nowS - json.generado > BASE_MAX_AGE_S) return noBase('de hace más de 3 h')
  if (!Array.isArray(json.servidores) || !json.servidores.every(isPublishedEntry))
    return noBase('corrupta')
  return { count: json.servidores.length, generado: json.generado, reason: null }
}

/**
 * Baja la lista publicada. Un 404 es la primera publicación; demasiado grande o JSON roto, «sin base»;
 * cualquier otro error de red o HTTP falla, para no publicar a ciegas.
 */
export async function fetchBase({ fetchImpl = fetch, nowS }) {
  let res
  try {
    res = await fetchImpl(BASE_URL, {
      redirect: 'error',
      cache: 'no-store',
      headers: { 'User-Agent': 'DZKr0nicasLauncher-servidores' },
      signal: AbortSignal.timeout(BASE_TIMEOUT_MS)
    })
  } catch (error) {
    throw new Error(`no se pudo bajar la lista publicada (${error?.name ?? 'Error'})`)
  }
  if (res.status === 404) return noBase('no hay ninguna publicada todavía')
  if (res.status !== 200) throw new Error(`la lista publicada contestó HTTP ${res.status}`)
  let text
  try {
    text = await readCapped(res, BASE_MAX_BYTES, BASE_TOO_BIG)
  } catch (error) {
    if (error.message === BASE_TOO_BIG) return noBase('de más de 4 MB')
    throw error
  }
  let json
  try {
    json = JSON.parse(text)
  } catch {
    return noBase('corrupta')
  }
  return parseBase(json, nowS)
}

// --- Lo que se comprueba antes de publicar ---

/** Los motivos para no publicar; vacío si se puede. */
export function failures({ result, base, nowS, acceptChange }) {
  const out = []
  const { servers, dropped, total } = result
  if (total >= STEAM_CAP) out.push(`llegan ${total} entradas, el tope de Steam: estaría cortada`)
  const droppedCount = Object.values(dropped).reduce((a, b) => a + b, 0)
  if (total > 0 && droppedCount / total > MAX_DROPPED)
    out.push(`se descarta el ${pct(droppedCount / total)} de las entradas (más del ${pct(MAX_DROPPED)})`)
  if (servers.length < MIN_SERVERS || servers.length > MAX_SERVERS)
    out.push(`quedan ${servers.length} servidores, fuera de ${MIN_SERVERS} a ${MAX_SERVERS}`)
  if (base.count !== null) {
    if (nowS <= base.generado) out.push('«generado» no avanza respecto a la lista publicada')
    const change = Math.abs(servers.length - base.count) / Math.max(1, base.count)
    if (change > MAX_CHANGE && !acceptChange)
      out.push(
        `el recuento cambia un ${pct(change)} (de ${base.count} a ${servers.length}); si es real, lánzalo a mano con «aceptar_cambio»`
      )
  }
  return out
}

const pct = (x) => `${(100 * x).toFixed(1).replace('.', ',')} %`

// --- Lo que se publica ---

/** La página: estática, sin JavaScript y sin ningún texto que venga de Steam. */
export function indexHtml(generado, count) {
  if (!Number.isInteger(generado) || !Number.isInteger(count)) throw new Error('página sin cifras')
  const when = new Date(generado * 1000).toISOString().slice(0, 16).replace('T', ' ')
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="referrer" content="no-referrer">
<title>Servidores de DayZ con jugadores</title>
<style>
body { font: 16px/1.5 system-ui, sans-serif; max-width: 42rem; margin: 2rem auto; padding: 0 1rem; color: #1b1b1f; background: #fafafa; }
@media (prefers-color-scheme: dark) { body { color: #e7e7ea; background: #16161a; } a { color: #9ab8ff; } }
code { font-size: .95em; }
</style>
</head>
<body>
<h1>Servidores de DayZ con jugadores</h1>
<p>La lista de servidores de DayZ que tenían jugadores, para el buscador del launcher DZKr0nicasLauncher. Solo están los que no estaban vacíos: un servidor vacío no sale.</p>
<p><strong>Actualizada:</strong> ${when} UTC. <strong>Servidores:</strong> ${count}. El archivo: <a href="servidores.json"><code>servidores.json</code></a>.</p>
<p><strong>Datos de <a href="https://store.steampowered.com/">Steam</a>.</strong> Este proyecto no está respaldado por Valve ni por Steam, ni tiene relación con ellos. Los datos se dan tal cual, sin ninguna garantía: pueden estar incompletos o viejos. La lista es para los usuarios del launcher y su uso personal.</p>
</body>
</html>
`
}

/** Los dos archivos que se publican, y nada más. */
export function buildSite(servers, nowS) {
  const json = JSON.stringify({
    formato: FORMATO,
    generado: nowS,
    fuente: 'Steam Web API',
    vacios: false,
    servidores: servers
  })
  return { 'servidores.json': json, 'index.html': indexHtml(nowS, servers.length) }
}

/** Escribe la carpeta de salida desde cero y comprueba que solo quedan esos dos archivos. */
export function writeSite(outDir, site) {
  if (existsSync(outDir)) rmSync(outDir, { recursive: true })
  mkdirSync(outDir, { recursive: true })
  for (const [name, content] of Object.entries(site)) writeFileSync(join(outDir, name), content)
  const files = readdirSync(outDir).sort()
  if (files.join(',') !== 'index.html,servidores.json')
    throw new Error(`la carpeta de salida tiene otros archivos: ${files.length}`)
}

async function main() {
  const [input, outArg] = process.argv.slice(2)
  if (!input || !isAbsolute(input) || !outArg) throw new Error('uso: generar.mjs <respuesta absoluta> <carpeta>')
  const outDir = resolve(outArg)
  if (!outDir.startsWith(resolve('.') + sep))
    throw new Error('la carpeta de salida tiene que estar dentro del repositorio')
  const nowS = Math.floor(Date.now() / 1000)
  const acceptChange = process.env.ACEPTAR_CAMBIO === 'true'

  let raw
  try {
    raw = JSON.parse(readFileSync(input, 'utf8'))
  } catch {
    throw new Error('la respuesta de Steam no es JSON válido')
  }
  const result = parseSteam(raw)
  const base = await fetchBase({ nowS })

  const droppedText = Object.entries(result.dropped)
    .map(([k, v]) => `${k} ${v}`)
    .join(', ')
  console.log(`Steam: ${result.total} entradas; quedan ${result.servers.length}`)
  console.log(`Descartadas: ${droppedText}; IP de más de ${MAX_PER_IP}: ${result.overCapIps}`)
  console.log(
    base.count === null
      ? `Sin base para comparar: ${base.reason}`
      : `Base: ${base.count} servidores, de hace ${Math.round((nowS - base.generado) / 60)} min`
  )
  if (acceptChange) console.log('Con «aceptar_cambio»: no se compara el recuento con la base')

  const why = failures({ result, base, nowS, acceptChange })
  if (why.length > 0) {
    for (const w of why) console.error(`NO SE PUBLICA: ${w}`)
    process.exitCode = 1
    return
  }
  writeSite(outDir, buildSite(result.servers, nowS))
  console.log(`Listo para publicar: ${result.servers.length} servidores`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Error: ${error.message}`)
    process.exitCode = 1
  })
}
