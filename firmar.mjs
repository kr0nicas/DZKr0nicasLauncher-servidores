// El paso que firma (11.6 g del launcher), en su propio trabajo y sin la clave de Steam: lee la lista que
// dejó `generar.mjs`, la vuelve a validar con sus mismas funciones, la firma con la privada de la
// variable LISTA_FIRMA_PRIVADA y deja al lado `servidores-firmada.json`. Si algo no cuadra, falla y no se
// publica nada: sigue en línea la última lista buena.
// Imprime solo el id de la clave y el recuento: nada de la clave, ninguna IP, ningún nombre.
// Uso: node firmar.mjs <carpeta con servidores.json e index.html>

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { FUTURE_SLACK_S, MAX_SERVERS, MIN_SERVERS, parseBase } from './generar.mjs'
import { firmarSobre, loadPrivateKey, parsePublicKeys } from './lib/firma.mjs'

/** Solo se firma una lista recién hecha: un `_site` viejo (una caché, una restauración) no. */
export const SIGN_MAX_AGE_S = 15 * 60
export const SIGNED_NAME = 'servidores-firmada.json'
const EXPECTED = ['index.html', SIGNED_NAME, 'servidores.json'].join(',')

/** Por qué esta lista no se firma, o null si se puede firmar. */
export function whyNotSign(lista, nowS) {
  let json
  try {
    json = JSON.parse(lista)
  } catch {
    return 'la lista no es JSON válido'
  }
  // `parseBase` ya mira el formato, el `generado`, el futuro y cada entrada.
  const base = parseBase(json, nowS)
  if (base.count === null) return `la lista no vale: ${base.reason}`
  if (base.count < MIN_SERVERS || base.count > MAX_SERVERS) return `el recuento (${base.count}) está fuera de los topes`
  if (nowS - base.generado > SIGN_MAX_AGE_S) return 'la lista no es de esta pasada'
  if (base.generado > nowS + FUTURE_SLACK_S) return 'la lista viene del futuro'
  return null
}

/** Firma la carpeta: escribe el sobre y comprueba que quedan justo los tres archivos. */
export function signSite(dir, privateKeyBase64, publicKeysJson, nowS) {
  const lista = readFileSync(join(dir, 'servidores.json'), 'utf8')
  const why = whyNotSign(lista, nowS)
  if (why !== null) throw new Error(why)
  const accepted = parsePublicKeys(publicKeysJson)
  const { sobre, id } = firmarSobre(lista, loadPrivateKey(privateKeyBase64), accepted)
  writeFileSync(join(dir, SIGNED_NAME), sobre)
  const files = readdirSync(dir).sort().join(',')
  if (files !== EXPECTED) throw new Error('la carpeta de salida no tiene justo los tres archivos')
  return { id, count: JSON.parse(lista).servidores.length }
}

function main() {
  const [dirArg] = process.argv.slice(2)
  if (!dirArg) throw new Error('uso: firmar.mjs <carpeta>')
  const dir = resolve(dirArg)
  if (!dir.startsWith(resolve('.') + sep)) throw new Error('la carpeta tiene que estar dentro del repositorio')
  const publicKeys = JSON.parse(readFileSync(new URL('./claves-publicas.json', import.meta.url), 'utf8'))
  const nowS = Math.floor(Date.now() / 1000)
  const { id, count } = signSite(dir, process.env.LISTA_FIRMA_PRIVADA, publicKeys, nowS)
  console.log(`Firmada con la clave ${id}: ${count} servidores`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch (error) {
    // Los mensajes de error de este paso no llevan nada de la clave (lib/firma.mjs).
    console.error(`NO SE FIRMA: ${error.message}`)
    process.exitCode = 1
  }
}
