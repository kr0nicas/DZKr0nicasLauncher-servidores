// La segunda comprobación (11.6 g, seguridad I3), después de «Firmar» y sin la privada: abre el sobre con
// las públicas de `claves-publicas.json`, con las mismas reglas que el launcher, y exige que su lista sea
// `servidores.json` tal cual y que la carpeta tenga justo los tres archivos. Si `firmar.mjs` hubiera
// salido sin firmar, aquí falla y no se publica nada.
// Sin guarda de «módulo principal»: solo se ejecuta, no se importa, así que siempre corre.
// Uso: node verificar-sitio.mjs <carpeta> [claves.json]   (las claves de otro archivo, solo en las pruebas;
// la CI lo llama sin él, y lo comprueba workflows.test.mjs)

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { abrirSobre, parsePublicKeys } from './lib/firma.mjs'

try {
  const dir = process.argv[2]
  if (!dir) throw new Error('uso: verificar-sitio.mjs <carpeta> [claves.json]')
  const files = readdirSync(dir).sort().join(',')
  if (files !== 'index.html,servidores-firmada.json,servidores.json')
    throw new Error('la carpeta no tiene justo los tres archivos')
  const keysFile = process.argv[3] ?? new URL('./claves-publicas.json', import.meta.url)
  const keys = parsePublicKeys(JSON.parse(readFileSync(keysFile, 'utf8')))
  const lista = abrirSobre(readFileSync(join(dir, 'servidores-firmada.json'), 'utf8'), keys)
  if (lista === null) throw new Error('el sobre no verifica con claves-publicas.json')
  if (lista !== readFileSync(join(dir, 'servidores.json'), 'utf8'))
    throw new Error('la lista del sobre no es servidores.json')
  console.log('Sitio verificado: el sobre abre con claves-publicas.json y lleva servidores.json')
} catch (error) {
  console.error(`NO SE PUBLICA: ${error.message}`)
  process.exitCode = 1
}
