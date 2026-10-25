// Pruebas de la firma (firmar.mjs, verificar-sitio.mjs y lib/firma.mjs), sin red. Los pares se crean en
// cada prueba: en el repositorio solo hay claves públicas.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { SIGNED_NAME, signSite, whyNotSign } from './firmar.mjs'
import { MAX_PER_IP, MAX_SERVERS, buildSite, indexHtml, parseSteam, whyNotPublishable, writeSite } from './generar.mjs'
import { PREFIJO, abrirSobre, firmarSobre, keyId, loadPrivateKey, parsePublicKeys, spkiBase64 } from './lib/firma.mjs'

const NOW = 1_793_000_000
const HERE = fileURLToPath(new URL('.', import.meta.url))

const steamList = (n, ips = 16) =>
  Array.from({ length: n }, (_, i) => ({
    addr: `172.111.51.${1 + (i % ips)}:${3000 + Math.floor(i / ips)}`,
    gameport: 2302,
    name: `S${i}`,
    map: 'chernarusplus',
    players: 5,
    max_players: 60,
    version: '1.30.164200',
    region: 3,
    gametype: 'battleye'
  }))

const site = (generado = NOW - 60, n = 1200, ips = 16) =>
  buildSite(parseSteam({ response: { servers: steamList(n, ips) } }).servers, generado)
const listOf = (generado, n, ips) => site(generado, n, ips)['servidores.json']

function pair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  return {
    privateKey,
    privateB64: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
    entry: { id: keyId(publicKey), spki: spkiBase64(publicKey), uso: 'ci' }
  }
}

function withSite(content, fn, parent = tmpdir()) {
  const dir = mkdtempSync(join(parent, 'firma-'))
  try {
    writeSite(dir, content)
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true })
  }
}

test('el prefijo es exactamente el que comprueba el launcher', () => {
  assert.equal(PREFIJO, 'DZKr0nicasLauncher/lista-global/1\n')
})

test('el vector fijo, el mismo que prueba el launcher: el bueno abre; sin prefijo o con un sustituto, no', () => {
  const vector = JSON.parse(readFileSync(new URL('./fixtures/sobre-de-prueba.json', import.meta.url), 'utf8'))
  const keys = parsePublicKeys({ claves: [vector.publica] })
  assert.equal(abrirSobre(vector.bueno, keys), vector.lista)
  assert.equal(abrirSobre(vector.sinPrefijo, keys), null)
  // Sin la regla de la lista bien formada, este verificaría: los bytes firmados son los mismos.
  assert.equal(abrirSobre(vector.sustituto, keys), null)
  assert.equal(abrirSobre(vector.bueno, parsePublicKeys({ claves: [pair().entry] })), null)
})

test('una lista recién hecha se firma: el sobre lleva justo esa lista, verifica y la página se rehace', () => {
  const ci = pair()
  const spare = pair()
  const keys = { claves: [ci.entry, { ...spare.entry, uso: 'repuesto' }] }
  const content = site()
  withSite({ ...content, 'index.html': '<script>alert(1)</script>' }, (dir) => {
    const { id, count } = signSite(dir, ci.privateB64, keys, NOW)
    assert.equal(id, ci.entry.id)
    assert.equal(count, 1200)
    assert.deepEqual(readdirSync(dir).sort(), ['index.html', SIGNED_NAME, 'servidores.json'])
    assert.equal(readFileSync(join(dir, 'index.html'), 'utf8'), indexHtml(NOW - 60, 1200))
    const sobre = readFileSync(join(dir, SIGNED_NAME), 'utf8')
    const json = JSON.parse(sobre)
    assert.deepEqual(Object.keys(json), ['formato', 'clave', 'firma', 'lista'])
    assert.equal(json.lista, content['servidores.json'])
    assert.equal(abrirSobre(sobre, parsePublicKeys(keys)), content['servidores.json'])
    assert.ok(!sobre.includes(ci.privateB64))
  })
  // Y la de repuesto también firma.
  withSite(site(), (dir) => assert.equal(signSite(dir, spare.privateB64, keys, NOW).id, spare.entry.id))
})

test('sin la clave, con otra clave o con una que no es Ed25519, no se firma ni se escribe nada', () => {
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

test('solo se firma una lista de esta pasada y dentro de los topes', () => {
  assert.equal(whyNotSign(listOf(NOW - 14 * 60), NOW), null)
  assert.match(whyNotSign(listOf(NOW - 16 * 60), NOW), /no es de esta pasada/)
  assert.match(whyNotSign(listOf(NOW + 3600), NOW), /no vale/)
  assert.match(whyNotSign(listOf(NOW - 60, 999), NOW), /fuera de los topes/)
  assert.match(whyNotSign(listOf(NOW - 60, MAX_SERVERS + 1, 32), NOW), /fuera de los topes/)
  assert.match(whyNotSign('{', NOW), /no es JSON/)
})

test('solo se firma lo que generar.mjs escribiría byte a byte (seguridad, I1)', () => {
  const good = listOf(NOW - 60)
  assert.equal(whyNotPublishable(good, NOW), null)
  const edit = (fn) => {
    const json = JSON.parse(good)
    fn(json)
    return JSON.stringify(json)
  }
  const cases = [
    // Un campo de más en una entrada.
    [edit((j) => (j.servidores[0].extra = 'x'.repeat(10))), /no es la que escribiría/],
    // Textos sin limpiar.
    [edit((j) => (j.servidores[0].name = 'S‮\u0007')), /sin limpiar/],
    [edit((j) => (j.servidores[0].version = '\u0001<script>')), /versión/],
    // Repetida, fuera de orden y etiquetas.
    [edit((j) => (j.servidores[1] = { ...j.servidores[0] })), /repetida/],
    [edit((j) => j.servidores.reverse()), /orden/],
    [edit((j) => (j.servidores[0].etiquetas = ['mod', 'battleye'])), /etiquetas/],
    // Una clave repetida en la raíz.
    [good.replace('"vacios":false', '"vacios":false,"vacios":false'), /no es la que escribiría/],
    // Espacios de más.
    [JSON.stringify(JSON.parse(good), null, 1), /no es la que escribiría/],
    [`${good}\n`, /no es la que escribiría/]
  ]
  for (const [text, why] of cases) assert.match(whyNotPublishable(text, NOW) ?? 'null', why)
  // Más de 512 en una IP, aunque cada entrada valga.
  const crowded = edit((j) => {
    for (const [i, s] of j.servidores.entries()) if (i <= MAX_PER_IP) s.ip = '172.111.51.200'
    j.servidores.sort((a, b) => b.players - a.players || (a.ip < b.ip ? -1 : a.ip > b.ip ? 1 : a.query - b.query))
  })
  assert.match(whyNotPublishable(crowded, NOW) ?? 'null', /repetida|más de 512/)
  assert.match(whyNotPublishable('x'.repeat(4 * 1024 * 1024 + 1), NOW), /4 MB/)
})

test('un sobre tocado no verifica: firma, lista, clave, formato, claves de más o base64 no canónico', () => {
  const ci = pair()
  const accepted = parsePublicKeys({ claves: [ci.entry] })
  const lista = listOf(NOW - 60)
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
    { ...json, firma: json.firma.slice(0, 85) + String.fromCharCode(json.firma.charCodeAt(85) ^ 1) + '==' }
  ]
  for (const v of variants) assert.equal(abrirSobre(JSON.stringify(v), accepted), null)
  assert.equal(abrirSobre('no es json', accepted), null)
  assert.equal(abrirSobre('[]', accepted), null)
  assert.equal(abrirSobre(' '.repeat(6 * 1024 * 1024), accepted), null)
  assert.throws(() => firmarSobre(`${lista}\ud800`, ci.privateKey, accepted), /bien formado/)
})

test('claves-publicas.json: un id que no cuadra o repetido se rechaza', () => {
  const ci = pair()
  assert.throws(() => parsePublicKeys({ claves: [{ ...ci.entry, id: '0000000000000000' }] }), /no cuadra/)
  assert.throws(() => parsePublicKeys({ claves: [ci.entry, ci.entry] }), /repetido/)
  assert.throws(() => parsePublicKeys({ claves: [] }), /no tiene claves/)
  assert.throws(() => parsePublicKeys({ claves: [{ id: 'x' }] }), /mal formada/)
  assert.throws(() => loadPrivateKey(null), /falta/)
})

test('las claves públicas del repositorio son Ed25519 y sus ids cuadran', () => {
  const keys = JSON.parse(readFileSync(new URL('./claves-publicas.json', import.meta.url), 'utf8'))
  const parsed = parsePublicKeys(keys)
  assert.deepEqual(parsed.map((k) => k.uso).sort(), ['ci', 'repuesto'])
})

test('una carpeta con algo de más no se firma, ni antes ni después', () => {
  const ci = pair()
  withSite(site(), (dir) => {
    writeFileSync(join(dir, 'sobra.txt'), 'x')
    assert.throws(() => signSite(dir, ci.privateB64, { claves: [ci.entry] }, NOW), /justo/)
    assert.ok(!readdirSync(dir).includes(SIGNED_NAME))
  })
})

test('firmar.mjs por la línea de comandos: falla con código 1 y no imprime nada de la clave', () => {
  const secret = pair().privateB64
  // Dentro del repositorio, como en la CI; la clave de prueba no está en claves-publicas.json.
  withSite(
    site(Math.floor(Date.now() / 1000) - 60),
    (dir) => {
      const run = spawnSync(process.execPath, ['firmar.mjs', dir], {
        cwd: HERE,
        env: { ...process.env, LISTA_FIRMA_PRIVADA: secret },
        encoding: 'utf8'
      })
      assert.equal(run.status, 1)
      assert.match(run.stderr, /^NO SE FIRMA: la clave de firma \([0-9a-f]{16}\) no está en claves-publicas\.json\n$/)
      assert.equal(run.stdout, '')
      assert.ok(!`${run.stdout}${run.stderr}`.includes(secret.slice(20, 60)))
      assert.ok(!readdirSync(dir).includes(SIGNED_NAME))
    },
    HERE
  )
  // Una carpeta fuera del repositorio no se toca.
  withSite(site(), (dir) => {
    const run = spawnSync(process.execPath, ['firmar.mjs', dir], { cwd: HERE, encoding: 'utf8' })
    assert.equal(run.status, 1)
    assert.match(run.stderr, /dentro del repositorio/)
  })
})

test('verificar-sitio.mjs: pasa con un sitio firmado y falla sin el sobre o con otra lista', () => {
  const vector = JSON.parse(readFileSync(new URL('./fixtures/sobre-de-prueba.json', import.meta.url), 'utf8'))
  const run = (dir, ...more) =>
    spawnSync(process.execPath, ['verificar-sitio.mjs', dir, ...more], { cwd: HERE, encoding: 'utf8' })
  const dir = mkdtempSync(join(tmpdir(), 'verificar-'))
  try {
    writeFileSync(join(dir, 'index.html'), 'x')
    writeFileSync(join(dir, 'servidores.json'), vector.lista)
    // Sin el sobre: falla (lo que pasaría si firmar.mjs saliera sin firmar).
    assert.equal(run(dir).status, 1)
    // Con un sobre que no abre con claves-publicas.json (el vector es de un par de prueba): falla.
    writeFileSync(join(dir, SIGNED_NAME), vector.bueno)
    const r = run(dir)
    assert.equal(r.status, 1)
    assert.match(r.stderr, /no verifica/)
    // Con las claves del vector, pasa; con otra lista en servidores.json, no.
    const keys = join(dir, '..', `claves-${process.pid}.json`)
    writeFileSync(keys, JSON.stringify({ claves: [vector.publica] }))
    try {
      const pass = run(dir, keys)
      assert.equal(pass.status, 0, pass.stderr)
      assert.match(pass.stdout, /^Sitio verificado/)
      writeFileSync(join(dir, 'servidores.json'), `${vector.lista} `)
      assert.match(run(dir, keys).stderr, /no es servidores\.json/)
    } finally {
      rmSync(keys)
    }
    mkdirSync(join(dir, 'otra'))
    assert.match(run(dir).stderr, /tres archivos/)
  } finally {
    rmSync(dir, { recursive: true })
  }
})
