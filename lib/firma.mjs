// La firma de la lista (11.6 g del launcher): un sobre con la lista dentro, firmado con Ed25519.
// Sin dependencias: solo node:crypto. El launcher verifica lo mismo con sus claves públicas.
//
// Esta clave solo firma `lista-global/1`. Si un día se firma otra cosa (versiones del launcher, una
// lista de otro formato), va con otro prefijo y otra clave.

import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'

export const SOBRE_FORMATO = 1
export const PREFIJO = 'DZKr0nicasLauncher/lista-global/1\n'
const ID = /^[0-9a-f]{16}$/
const FIRMA_B64 = /^[A-Za-z0-9+/]{86}==$/

/** La clave pública en DER SPKI, en base64: lo que guardan `claves-publicas.json` y el launcher. */
export function spkiBase64(publicKey) {
  return publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
}

/** El id de una clave: los 8 primeros bytes, en hex, del SHA-256 de su DER SPKI. */
export function keyId(publicKey) {
  const der = publicKey.export({ type: 'spki', format: 'der' })
  return createHash('sha256').update(der).digest('hex').slice(0, 16)
}

/** Los bytes que se firman: el prefijo y la lista, tal cual. */
export function mensaje(lista) {
  return Buffer.from(PREFIJO + lista, 'utf8')
}

/**
 * La privada de la variable de entorno: PKCS#8 DER en base64, de una línea. Los errores no llevan nada
 * del material de la clave.
 */
export function loadPrivateKey(base64) {
  if (typeof base64 !== 'string' || base64.trim().length === 0) throw new Error('falta la clave de firma')
  let key
  try {
    key = createPrivateKey({ key: Buffer.from(base64.trim(), 'base64'), format: 'der', type: 'pkcs8' })
  } catch {
    throw new Error('la clave de firma no se puede leer')
  }
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('la clave de firma no es Ed25519')
  return key
}

/**
 * Las claves públicas aceptadas, de `claves-publicas.json`: `{ "claves": [{ "id", "spki", "uso" }] }`.
 * Comprueba que cada id corresponde a su clave.
 */
export function parsePublicKeys(json) {
  if (typeof json !== 'object' || json === null || !Array.isArray(json.claves) || json.claves.length === 0)
    throw new Error('claves-publicas.json no tiene claves')
  return json.claves.map((entry) => {
    if (typeof entry?.spki !== 'string' || typeof entry.id !== 'string' || typeof entry.uso !== 'string')
      throw new Error('claves-publicas.json tiene una entrada mal formada')
    const key = createPublicKey({ key: Buffer.from(entry.spki, 'base64'), format: 'der', type: 'spki' })
    if (key.asymmetricKeyType !== 'ed25519' || keyId(key) !== entry.id || spkiBase64(key) !== entry.spki)
      throw new Error(`la clave ${entry.id} de claves-publicas.json no cuadra`)
    return { id: entry.id, uso: entry.uso, key }
  })
}

/**
 * El sobre firmado. La privada tiene que ser la de una de las públicas aceptadas: un secreto vacío,
 * truncado o de otro par falla aquí, y no se publica nada (sigue en línea la última lista buena).
 */
export function firmarSobre(lista, privateKey, accepted) {
  if (typeof lista !== 'string' || !lista.isWellFormed()) throw new Error('la lista no es texto bien formado')
  const publicKey = createPublicKey(privateKey)
  const id = keyId(publicKey)
  const known = accepted.find((k) => k.id === id && spkiBase64(k.key) === spkiBase64(publicKey))
  if (known === undefined) throw new Error(`la clave de firma (${id}) no está en claves-publicas.json`)
  const firma = sign(null, mensaje(lista), privateKey).toString('base64')
  const sobre = JSON.stringify({ formato: SOBRE_FORMATO, clave: id, firma, lista })
  if (abrirSobre(sobre, accepted) !== lista) throw new Error('el sobre recién firmado no verifica')
  return { sobre, id }
}

/**
 * La lista de un sobre si su firma vale con una de las claves aceptadas; si no, null. Las mismas reglas
 * que el launcher: solo las cuatro claves, firma en base64 canónico y lista bien formada.
 */
export function abrirSobre(text, accepted) {
  let json
  try {
    json = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return null
  if (Object.keys(json).sort().join(',') !== 'clave,firma,formato,lista') return null
  const { formato, clave, firma, lista } = json
  if (formato !== SOBRE_FORMATO || typeof clave !== 'string' || !ID.test(clave)) return null
  if (typeof firma !== 'string' || !FIRMA_B64.test(firma) || typeof lista !== 'string') return null
  if (!lista.isWellFormed()) return null
  const bytes = Buffer.from(firma, 'base64')
  if (bytes.length !== 64 || bytes.toString('base64') !== firma) return null
  const known = accepted.find((k) => k.id === clave)
  if (known === undefined) return null
  try {
    return verify(null, mensaje(lista), known.key, bytes) ? lista : null
  } catch {
    return null
  }
}
