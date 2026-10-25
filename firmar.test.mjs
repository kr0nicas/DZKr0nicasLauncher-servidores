// Pruebas de la firma (firmar.mjs y lib/firma.mjs), sin red. Los pares se crean en cada prueba: en el
// repositorio solo hay claves públicas.
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { SIGNED_NAME, signSite, whyNotSign } from './firmar.mjs'
import { buildSite, parseSteam, writeSite } from './generar.mjs'
import { PREFIJO, abrirSobre, firmarSobre, keyId, loadPrivateKey, parsePublicKeys, spkiBase64 } from './lib/firma.mjs'

const NOW = 1_793_000_000

const steamList = (n) =>
  Array.from({ length: n }, (_, i) => ({
    addr: `172.111.51.${1 + (i % 16)}:${3000 + Math.floor(i / 16)}`,
    gameport: 2302,
    name: `S${i}`,
    map: 'chernarusplus',
    players: 5,
    max_players: 60,
    version: '1.30.164200',
    region: 3,
    gametype: 'battleye'
  }))

const site = (generado = NOW - 60, n = 1200) =>
  buildSite(parseSteam({ response: { servers: steamList(n) } }).servers, generado)

function pair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  return {
    privateKey,
    privateB64: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
    entry: { id: keyId(publicKey), spki: spkiBase64(publicKey), uso: 'ci' }
  }
}

function withSite(content, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'firma-'))
  try {
    writeSite(dir, content)
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true })
  }
}

test('una lista recién hecha se firma, y el sobre lleva justo esa lista y verifica', () => {
  const ci = pair()
  const spare = pair()
  const keys = { claves: [ci.entry, { ...spare.entry, uso: 'repuesto' }] }
  const content = site()
  withSite(content, (dir) => {
    const { id, count } = signSite(dir, ci.privateB64, keys, NOW)
    assert.equal(id, ci.entry.id)
    assert.equal(count, 1200)
    assert.deepEqual(readdirSync(dir).sort(), ['index.html', SIGNED_NAME, 'servidores.json'])
    const sobre = readFileSync(join(dir, SIGNED_NAME), 'utf8')
    const json = JSON.parse(sobre)
    assert.deepEqual(Object.keys(json), ['formato', 'clave', 'firma', 'lista'])
    assert.equal(json.lista, content['servidores.json'])
    assert.equal(abrirSobre(sobre, parsePublicKeys(keys)), content['servidores.json'])
    // Nada de la privada en el sobre.
    assert.ok(!sobre.includes(ci.privateB64))
  })
  // Y la de repuesto también firma.
  withSite(site(), (dir) => assert.equal(signSite(dir, spare.privateB64, keys, NOW).id, spare.entry.id))
})

test('sin la clave, con otra clave o con una que no es Ed25519, no se firma', () => {
  const ci = pair()
  const keys = { claves: [ci.entry] }
  const rsa = generateKeyPairSync('rsa', { modulusLength: 1024 })
    .privateKey.export({ type: 'pkcs8', format: 'der' })
    .toString('base64')
  for (const [secret, why] of [
    [undefined, /falta la clave/],
    ['', /falta la clave/],
    ['no es base64 de nada', /no se puede leer/],
    [ci.privateB64.slice(0, 20), /no se puede leer/],
    [rsa, /no es Ed25519/],
    [pair().privateB64, /no está en claves-publicas/]
  ])
    withSite(site(), (dir) => {
      assert.throws(() => signSite(dir, secret, keys, NOW), why)
      assert.deepEqual(readdirSync(dir).sort(), ['index.html', 'servidores.json'])
    })
})

test('una lista vieja, del futuro, mala o fuera de los topes no se firma', () => {
  assert.equal(whyNotSign(site()['servidores.json'], NOW), null)
  assert.match(whyNotSign(site(NOW - 16 * 60)['servidores.json'], NOW), /no es de esta pasada/)
  assert.match(whyNotSign(site(NOW + 3600)['servidores.json'], NOW), /no vale/)
  assert.match(whyNotSign(site(NOW - 60, 999)['servidores.json'], NOW), /fuera de los topes/)
  assert.match(whyNotSign('{', NOW), /no es JSON/)
  const bad = JSON.parse(site()['servidores.json'])
  bad.servidores[0].ip = '10.0.0.1'
  assert.match(whyNotSign(JSON.stringify(bad), NOW), /no vale/)
})

test('un sobre tocado no verifica: firma, lista, clave, formato, claves de más o base64 no canónico', () => {
  const ci = pair()
  const accepted = parsePublicKeys({ claves: [ci.entry] })
  const lista = site()['servidores.json']
  const { sobre } = firmarSobre(lista, ci.privateKey, accepted)
  const json = JSON.parse(sobre)
  assert.equal(abrirSobre(sobre, accepted), lista)
  const flip = (s, i) => s.slice(0, i) + (s[i] === 'A' ? 'B' : 'A') + s.slice(i + 1)
  const variants = [
    { ...json, firma: flip(json.firma, 10) },
    { ...json, lista: lista.replace('S1"', 'S2"') },
    { ...json, clave: '0000000000000000' },
    { ...json, formato: 2 },
    { ...json, extra: 1 },
    // El último carácter antes del relleno lleva bits sobrantes: otra forma de la misma firma.
    { ...json, firma: json.firma.slice(0, 85) + String.fromCharCode(json.firma.charCodeAt(85) ^ 1) + '==' },
    { ...json, lista: `${lista}\ud800` }
  ]
  for (const v of variants) assert.equal(abrirSobre(JSON.stringify(v), accepted), null)
  assert.equal(abrirSobre('no es json', accepted), null)
  assert.equal(abrirSobre('[]', accepted), null)
  // Lo firmado lleva el prefijo: la misma firma sobre la lista sola no vale.
  assert.ok(PREFIJO.endsWith('\n'))
  assert.throws(() => firmarSobre(`${lista}\ud800`, ci.privateKey, accepted), /bien formado/)
})

test('claves-publicas.json: un id que no cuadra con su clave se rechaza', () => {
  const ci = pair()
  assert.throws(() => parsePublicKeys({ claves: [{ ...ci.entry, id: '0000000000000000' }] }), /no cuadra/)
  assert.throws(() => parsePublicKeys({ claves: [] }), /no tiene claves/)
  assert.throws(() => parsePublicKeys({ claves: [{ id: 'x' }] }), /mal formada/)
  assert.throws(() => loadPrivateKey(null), /falta/)
})

test('las claves públicas del repositorio son Ed25519 y sus ids cuadran', () => {
  const keys = JSON.parse(readFileSync(new URL('./claves-publicas.json', import.meta.url), 'utf8'))
  const parsed = parsePublicKeys(keys)
  assert.ok(parsed.some((k) => k.uso === 'ci'))
})

test('firmar.mjs no escribe nada fuera de la carpeta ni deja archivos de más', () => {
  const ci = pair()
  withSite(site(), (dir) => {
    writeFileSync(join(dir, 'sobra.txt'), 'x')
    assert.throws(() => signSite(dir, ci.privateB64, { claves: [ci.entry] }, NOW), /tres archivos/)
  })
})
