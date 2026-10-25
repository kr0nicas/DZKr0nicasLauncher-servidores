// El paso que firma (11.6 g del launcher), en su propio trabajo y sin la clave de Steam: lee la lista que
// dejó `generar.mjs`, exige que sea byte a byte la que esa tarea escribiría en esta pasada, rehace
// `index.html`, la firma con la privada de la variable LISTA_FIRMA_PRIVADA y deja al lado
// `servidores-firmada.json`. Si algo no cuadra, falla y no se publica nada: sigue en línea la última
// lista buena. Imprime solo el id de la clave y el recuento: nada de la clave, ninguna IP, ningún nombre.
// Uso: node firmar.mjs <carpeta con servidores.json e index.html>

import { lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { indexHtml, isMain, whyNotPublishable } from './generar.mjs'
import { firmarSobre, loadPrivateKey, parsePublicKeys } from './lib/firma.mjs'

/** Solo se firma una lista recién hecha: un `_site` viejo (una caché, una restauración) no. */
export const SIGN_MAX_AGE_S = 15 * 60
export const SIGNED_NAME = 'servidores-firmada.json'
const BEFORE = 'index.html,servidores.json'
const AFTER = ['index.html', SIGNED_NAME, 'servidores.json'].join(',')

/** Por qué esta lista no se firma, o null si se puede firmar. */
export function whyNotSign(lista, nowS) {
  const why = whyNotPublishable(lista, nowS)
  if (why !== null) return why
  if (nowS - JSON.parse(lista).generado > SIGN_MAX_AGE_S) return 'la lista no es de esta pasada'
  return null
}

/** Los archivos de la carpeta, que tienen que ser archivos normales (sin enlaces simbólicos). */
function filesOf(dir) {
  const names = readdirSync(dir).sort()
  for (const name of names)
    if (!lstatSync(join(dir, name)).isFile()) throw new Error('la carpeta tiene algo que no es un archivo')
  return names.join(',')
}

/** Firma la carpeta: comprueba los dos archivos, rehace la página y escribe el sobre. */
export function signSite(dir, privateKeyBase64, publicKeysJson, nowS) {
  if (filesOf(dir) !== BEFORE) throw new Error('la carpeta no tiene justo servidores.json e index.html')
  const lista = readFileSync(join(dir, 'servidores.json'), 'utf8')
  const why = whyNotSign(lista, nowS)
  if (why !== null) throw new Error(why)
  const accepted = parsePublicKeys(publicKeysJson)
  const { sobre, id } = firmarSobre(lista, loadPrivateKey(privateKeyBase64), accepted)
  const { generado, servidores } = JSON.parse(lista)
  // La página no se publica tal como llegó del otro trabajo: se rehace aquí.
  writeFileSync(join(dir, 'index.html'), indexHtml(generado, servidores.length))
  writeFileSync(join(dir, SIGNED_NAME), sobre)
  if (filesOf(dir) !== AFTER) throw new Error('la carpeta de salida no tiene justo los tres archivos')
  return { id, count: servidores.length }
}

function main() {
  if (typeof ''.isWellFormed !== 'function') throw new Error('hace falta Node 20 o más')
  const [dirArg] = process.argv.slice(2)
  if (!dirArg) throw new Error('uso: firmar.mjs <carpeta>')
  const dir = resolve(dirArg)
  if (!dir.startsWith(resolve('.') + sep)) throw new Error('la carpeta tiene que estar dentro del repositorio')
  const publicKeys = JSON.parse(readFileSync(new URL('./claves-publicas.json', import.meta.url), 'utf8'))
  const nowS = Math.floor(Date.now() / 1000)
  const { id, count } = signSite(dir, process.env.LISTA_FIRMA_PRIVADA, publicKeys, nowS)
  console.log(`Firmada con la clave ${id}: ${count} servidores`)
}

if (isMain(import.meta.url)) {
  try {
    main()
  } catch (error) {
    // Los mensajes de error de este paso no llevan nada de la clave (lib/firma.mjs).
    console.error(`NO SE FIRMA: ${error.message}`)
    process.exitCode = 1
  }
}
