// Pruebas de generar.mjs y pedir-a-steam.mjs, sin red. Las direcciones son las de los servidores
// públicos de referencia del launcher, nunca IP de particulares.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  BASE_MAX_AGE_S,
  MAX_PER_IP,
  buildSite,
  failures,
  fetchBase,
  indexHtml,
  parseBase,
  parseSteam,
  writeSite
} from './generar.mjs'
import { fetchToFile } from './pedir-a-steam.mjs'

const FAKE_KEY = '0123456789abcdef0123456789abcdef'
const NOW = 1_793_000_000
/**
 * Las listas grandes se reparten por 16 IP del bloque del proveedor de dos servidores de referencia
 * (172.111.51.0/24), para no pasar del tope por IP: 8001 entradas son 501 por IP.
 */
const IPS = 16

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'))

/** `n` servidores válidos, sin pasar del tope por IP hasta unos 8000. */
const steamList = (n, players = 5) =>
  Array.from({ length: n }, (_, i) => ({
    addr: `172.111.51.${1 + (i % IPS)}:${3000 + Math.floor(i / IPS)}`,
    gameport: 2302,
    name: `S${i}`,
    map: 'chernarusplus',
    players,
    max_players: 60,
    version: '1.30.164200',
    region: 3,
    gametype: 'battleye'
  }))
const steam = (list) => ({ response: { servers: list } })
const noBase = { count: null, generado: null, reason: 'no hay ninguna publicada todavía' }

test('el fixture hostil da exactamente la salida esperada (la misma que comprobará el launcher)', () => {
  assert.deepEqual(parseSteam(read('./fixtures/hostil.json')), read('./fixtures/hostil.esperado.json'))
})

test('una IP con más de 512 servidores se descarta entera y se publica el resto', () => {
  const crowded = Array.from({ length: MAX_PER_IP + 1 }, (_, i) => ({
    addr: `172.111.51.4:${20000 + i}`,
    gameport: 2302,
    players: 3,
    max_players: 60
  }))
  const others = steamList(1200).filter((s) => !s.addr.startsWith('172.111.51.4:'))
  const r = parseSteam(steam([...crowded, ...others]))
  assert.equal(r.overCapIps, 1)
  assert.equal(r.dropped['tope-por-ip'], MAX_PER_IP + 1)
  assert.ok(r.servers.every((s) => s.ip !== '172.111.51.4'))
  assert.equal(r.servers.length, others.length)
  // Y se publica: lo que quita el tope por IP no cuenta en el 5 % (513 de 1638 sería un 31 %).
  assert.deepEqual(failures({ result: r, base: noBase, nowS: NOW, acceptChange: false }), [])
  // Con 512 justos, no.
  const r512 = parseSteam(steam(crowded.slice(0, MAX_PER_IP)))
  assert.equal(r512.overCapIps, 0)
  assert.equal(r512.servers.length, MAX_PER_IP)
})

test('se publica una lista normal sin base, y con una base parecida', () => {
  const result = parseSteam(steam(steamList(3000)))
  assert.deepEqual(failures({ result, base: noBase, nowS: NOW, acceptChange: false }), [])
  const base = { count: 2900, generado: NOW - 900, reason: null }
  assert.deepEqual(failures({ result, base, nowS: NOW, acceptChange: false }), [])
})

test('no se publica una lista cortada, con demasiado descarte o fuera de los topes', () => {
  const cut = parseSteam(steam(steamList(10000)))
  assert.match(failures({ result: cut, base: noBase, nowS: NOW }).join(), /estaría cortada/)
  const dirty = parseSteam(steam([...steamList(1500), ...Array(100).fill({ addr: '10.0.0.1:2303' })]))
  assert.match(failures({ result: dirty, base: noBase, nowS: NOW }).join(), /se descarta el/)
  const few = parseSteam(steam(steamList(999)))
  assert.match(failures({ result: few, base: noBase, nowS: NOW }).join(), /fuera de 1000 a 8000/)
  const many = parseSteam(steam(steamList(8001)))
  assert.match(failures({ result: many, base: noBase, nowS: NOW }).join(), /fuera de 1000 a 8000/)
})

test('una caída o una subida de más del 50 % no se publica, salvo con «aceptar_cambio»', () => {
  const result = parseSteam(steam(steamList(1200)))
  const base = { count: 3000, generado: NOW - 900, reason: null }
  assert.match(failures({ result, base, nowS: NOW, acceptChange: false }).join(), /aceptar_cambio/)
  assert.deepEqual(failures({ result, base, nowS: NOW, acceptChange: true }), [])
  const up = parseSteam(steam(steamList(4600)))
  const small = { count: 3000, generado: NOW - 900, reason: null }
  assert.match(failures({ result: up, base: small, nowS: NOW, acceptChange: false }).join(), /cambia un/)
  // «aceptar_cambio» no salta los topes absolutos ni el reloj.
  const few = parseSteam(steam(steamList(500)))
  assert.match(failures({ result: few, base, nowS: NOW, acceptChange: true }).join(), /fuera de 1000/)
  const stale = { count: 1200, generado: NOW, reason: null }
  assert.match(failures({ result, base: stale, nowS: NOW, acceptChange: true }).join(), /no avanza/)
})

test('una base mala cuenta como «sin base», para no congelar la publicación', () => {
  const good = buildSite(parseSteam(steam(steamList(1200))).servers, NOW - 900)
  const json = JSON.parse(good['servidores.json'])
  assert.equal(parseBase(json, NOW).count, 1200)
  assert.equal(parseBase({ ...json, formato: 2 }, NOW).reason, 'de otro formato')
  assert.equal(parseBase({ ...json, generado: NOW + 3600 }, NOW).reason, 'con «generado» en el futuro')
  assert.equal(parseBase({ ...json, generado: NOW - BASE_MAX_AGE_S - 1 }, NOW).reason, 'de hace más de 3 h')
  assert.equal(parseBase({ ...json, generado: '1' }, NOW).reason, 'sin «generado»')
  const bad = { ...json, servidores: [...json.servidores, { ...json.servidores[0], ip: '10.0.0.1' }] }
  assert.equal(parseBase(bad, NOW).reason, 'corrupta')
  assert.equal(parseBase(null, NOW).reason, 'de otro formato')
})

test('la base se baja sin seguir redirecciones; 404 es la primera, y otro error falla', async () => {
  const body = buildSite(parseSteam(steam(steamList(1200))).servers, NOW - 900)['servidores.json']
  let seen
  const ok = await fetchBase({
    nowS: NOW,
    fetchImpl: async (url, init) => {
      seen = { url: String(url), init }
      return new Response(body, { headers: { 'content-type': 'application/json' } })
    }
  })
  assert.equal(ok.count, 1200)
  assert.equal(seen.init.redirect, 'error')
  assert.equal(seen.init.cache, 'no-store')
  assert.equal(seen.url, 'https://kr0nicas.github.io/DZKr0nicasLauncher-servidores/servidores.json')
  const first = await fetchBase({ nowS: NOW, fetchImpl: async () => new Response('', { status: 404 }) })
  assert.equal(first.count, null)
  await assert.rejects(
    fetchBase({ nowS: NOW, fetchImpl: async () => new Response('', { status: 500 }) }),
    /HTTP 500/
  )
  await assert.rejects(
    fetchBase({
      nowS: NOW,
      fetchImpl: async () => {
        throw new TypeError('fetch failed https://x')
      }
    }),
    (e) => !e.message.includes('https://x')
  )
  const broken = await fetchBase({ nowS: NOW, fetchImpl: async () => new Response('{roto') })
  assert.equal(broken.reason, 'corrupta')
  const huge = await fetchBase({
    nowS: NOW,
    fetchImpl: async () => new Response(new Uint8Array(4 * 1024 * 1024 + 1))
  })
  assert.equal(huge.reason, 'de más de 4 MB')
})

test('lo publicado: dos archivos, sin JavaScript, con la atribución y sin nada con forma de clave', () => {
  const servers = parseSteam(read('./fixtures/hostil.json')).servers
  const site = buildSite(servers, NOW)
  const json = JSON.parse(site['servidores.json'])
  assert.deepEqual(Object.keys(json), ['formato', 'generado', 'fuente', 'vacios', 'servidores'])
  assert.equal(json.formato, 1)
  assert.equal(json.vacios, false)
  assert.equal(json.fuente, 'Steam Web API')
  const html = site['index.html']
  assert.doesNotMatch(html, /<script/i)
  assert.doesNotMatch(html, /nofollow/i)
  assert.match(html, /href="https:\/\/store\.steampowered\.com\/"/)
  assert.match(html, /no está respaldado por Valve/)
  assert.match(html, /tal cual/)
  // Ningún nombre de servidor en la página: nada de Steam entra en el HTML.
  assert.doesNotMatch(html, /DayZERO|KarmaKrew|MANHUNT/)
  for (const content of Object.values(site)) assert.doesNotMatch(content, /[0-9a-fA-F]{32}/)
  assert.throws(() => indexHtml('1', 3), /sin cifras/)

  const dir = mkdtempSync(join(tmpdir(), 'site-'))
  try {
    writeFileSync(join(dir, 'sobra.txt'), 'x')
    writeSite(dir, site)
    assert.deepEqual(readdirSync(dir).sort(), ['index.html', 'servidores.json'])
  } finally {
    rmSync(dir, { recursive: true })
  }
})

test('pedir-a-steam escribe la respuesta cruda y ningún error lleva la clave', async () => {
  let written
  const line = await fetchToFile({
    key: FAKE_KEY,
    out: join(tmpdir(), 'steam.json'),
    fetchImpl: async () =>
      new Response(JSON.stringify(steam(steamList(3))), { headers: { 'content-type': 'application/json' } }),
    write: (path, text) => {
      written = text
    }
  })
  assert.match(line, /^HTTP 200, \d+ KB, \d+ ms$/)
  assert.equal(JSON.parse(written).response.servers.length, 3)
  await assert.rejects(
    fetchToFile({ key: FAKE_KEY, out: join(tmpdir(), 'x.json'), fetchImpl: async () => new Response('', { status: 403 }) }),
    (e) => /HTTP 403/.test(e.message) && !e.message.includes(FAKE_KEY)
  )
  await assert.rejects(fetchToFile({ key: FAKE_KEY, out: 'relativa.json' }), /ruta absoluta/)
})
