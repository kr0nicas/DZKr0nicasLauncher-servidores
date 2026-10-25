// Crea el par de la CI (11.6 g del launcher): la privada va directa al secreto LISTA_FIRMA_PRIVADA del
// environment `firma`, sin pasar por la pantalla, el disco ni una tubería de shell; la pública se añade
// a `claves-publicas.json` solo si `gh` la guardó bien. Si el secreto se pierde, GitHub no deja leerlo:
// se pasa a la clave de repuesto o se crea otro par con --rotar (y el launcher necesita la pública nueva).
// Uso: node crear-clave-ci.mjs [--rotar]

import { execFileSync } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { keyId, spkiBase64 } from './lib/firma.mjs'

const REPO = 'kr0nicas/DZKr0nicasLauncher-servidores'
const FILE = new URL('./claves-publicas.json', import.meta.url)

function readKeys() {
  try {
    return JSON.parse(readFileSync(FILE, 'utf8'))
  } catch {
    return { claves: [] }
  }
}

const rotate = process.argv.includes('--rotar')
const keys = readKeys()
if (keys.claves.some((k) => k.uso === 'ci') && !rotate) {
  console.error('Ya hay una clave de la CI en claves-publicas.json. Para cambiarla: --rotar')
  process.exit(1)
}

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const input = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64')
try {
  // Sin shell y con la privada solo por stdin: ni en la línea de comandos ni en la salida.
  execFileSync('gh', ['secret', 'set', 'LISTA_FIRMA_PRIVADA', '--env', 'firma', '--repo', REPO], {
    input,
    stdio: ['pipe', 'ignore', 'pipe']
  })
} catch (error) {
  console.error(`gh no guardó el secreto (salida ${error.status ?? '?'}); no se cambia nada`)
  process.exit(1)
}

const entry = { id: keyId(publicKey), spki: spkiBase64(publicKey), uso: 'ci' }
const claves = [...keys.claves.filter((k) => k.uso !== 'ci'), entry]
writeFileSync(FILE, `${JSON.stringify({ claves }, null, 2)}\n`)
console.log(`Secreto guardado. Clave de la CI: ${entry.id}`)
console.log(`Pública (SPKI): ${entry.spki}`)
