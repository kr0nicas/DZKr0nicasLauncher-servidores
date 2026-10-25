// Crea el par de la CI (11.6 g del launcher): la privada va directa al secreto LISTA_FIRMA_PRIVADA del
// environment `firma`, sin pasar por la pantalla, el disco ni una tubería de shell; la pública se añade
// a `claves-publicas.json` solo si `gh` la guardó bien. Si el secreto se pierde, GitHub no deja leerlo:
// se pasa a la clave de repuesto, o se crea otro par con --rotar y se fusiona en el acto la pública
// nueva (hasta entonces `firmar` falla y no publica), y el launcher necesita una versión con ella.
// Uso: node crear-clave-ci.mjs [--rotar]

import { execFileSync } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { keyId, parsePublicKeys, spkiBase64 } from './lib/firma.mjs'

const REPO = 'kr0nicas/DZKr0nicasLauncher-servidores'
const FILE = new URL('./claves-publicas.json', import.meta.url)
const HERE = dirname(fileURLToPath(import.meta.url))

function fail(text) {
  console.error(text)
  process.exit(1)
}

/** Las claves que hay. Solo un archivo que no existe es «ninguna»: uno roto para aquí, antes de tocar el secreto. */
function readKeys() {
  let text
  try {
    text = readFileSync(FILE, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return { claves: [] }
    throw error
  }
  const json = JSON.parse(text)
  parsePublicKeys(json)
  return json
}

/**
 * La ruta absoluta de `gh`, buscada en el PATH. En Windows, un programa sin ruta se busca antes en la
 * carpeta actual: un `gh.exe` puesto en este clon recibiría la privada (seguridad, M3).
 */
function ghPath() {
  const finder = process.platform === 'win32' ? 'where.exe' : 'which'
  let found
  try {
    found = execFileSync(finder, ['gh'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  } catch {
    fail('No se encuentra gh. Instálalo (https://cli.github.com) y ejecuta gh auth login.')
  }
  const gh = found.find((p) => isAbsolute(p) && !resolve(p).startsWith(resolve(HERE)))
  if (gh === undefined) fail('El gh que hay está dentro de este clon: no se usa. Instálalo fuera.')
  return gh
}

const rotate = process.argv.includes('--rotar')
let keys
try {
  keys = readKeys()
} catch (error) {
  fail(`claves-publicas.json no se puede leer (${error.message}); arréglalo antes de crear la clave`)
}
if (keys.claves.some((k) => k.uso === 'ci') && !rotate)
  fail('Ya hay una clave de la CI en claves-publicas.json. Para cambiarla: --rotar')

const gh = ghPath()
const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const input = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64')
try {
  // Sin shell y con la privada solo por stdin: ni en la línea de comandos ni en la salida. Lo que
  // escribe gh por su salida de error (no lleva el secreto) se enseña tal cual.
  execFileSync(gh, ['secret', 'set', 'LISTA_FIRMA_PRIVADA', '--env', 'firma', '--repo', REPO], {
    input,
    stdio: ['pipe', 'ignore', 'inherit']
  })
} catch (error) {
  fail(
    `gh no guardó el secreto (salida ${error.status ?? '?'}). Mira su mensaje de arriba; si no has iniciado sesión, ejecuta gh auth login. No se ha cambiado nada.`
  )
}

const entry = { id: keyId(publicKey), spki: spkiBase64(publicKey), uso: 'ci' }
const claves = [...keys.claves.filter((k) => k.uso !== 'ci'), entry]
try {
  writeFileSync(FILE, `${JSON.stringify({ claves }, null, 2)}\n`)
} catch (error) {
  // El secreto ya cambió: sin esta pública, `firmar` fallará (cerrado) hasta que se añada a mano.
  console.error(`El secreto ya cambió, pero no se pudo escribir claves-publicas.json (${error.message}).`)
  console.error(`Añade a mano: ${JSON.stringify(entry)}`)
  process.exit(1)
}
console.log(`Secreto guardado. Clave de la CI: ${entry.id}`)
console.log(`Pública (SPKI): ${entry.spki}`)
if (rotate) console.log('Fusiona ya claves-publicas.json en main: hasta entonces, firmar falla y no publica.')
