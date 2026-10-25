// Pruebas de la sonda, sin red: Steam es un `fetch` de mentira. Las direcciones son las de los
// servidores públicos de referencia del launcher, nunca IP de particulares.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FILTER, STEAM_CAP, countServers, probe, report } from './sonda.mjs'

/** Una clave falsa con la forma de una de verdad: no debe salir nunca en lo que se imprime. */
const FAKE_KEY = '0123456789abcdef0123456789abcdef'

const json = (body, status = 200, type = 'application/json; charset=utf-8') =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': type } })

const servers = (n) =>
  Array.from({ length: n }, (_, i) => ({ addr: `172.111.51.3:${2303 + i}`, players: 5 }))

test('cuenta los servidores y pide solo los no vacíos, con la clave por cabecera y sin redirecciones', async () => {
  let seen
  const r = await probe({
    key: FAKE_KEY,
    fetchImpl: async (url, init) => {
      seen = { url: new URL(url), init }
      return json({ response: { servers: servers(3) } })
    }
  })
  assert.deepEqual({ status: r.status, count: r.count }, { status: 200, count: 3 })
  assert.equal(seen.url.searchParams.get('filter'), FILTER)
  assert.equal(seen.url.searchParams.get('limit'), String(STEAM_CAP))
  assert.equal(seen.url.searchParams.get('key'), null, 'la clave no va en la URL')
  assert.equal(seen.init.headers['x-webapi-key'], FAKE_KEY)
  assert.equal(seen.init.redirect, 'error')
})

test('un 403 no es un error del script: se cuenta y se explica', async () => {
  const r = await probe({ key: FAKE_KEY, fetchImpl: async () => json({}, 403) })
  assert.equal(r.status, 403)
  assert.equal(r.count, null)
  assert.match(report(r), /HTTP 403/)
  assert.match(report(r), /rechaza la clave/)
})

test('al tope de Steam avisa de que estaría cortada', () => {
  assert.match(report({ status: 200, count: STEAM_CAP, ms: 1 }), /estaría cortada/)
  assert.doesNotMatch(report({ status: 200, count: 3062, ms: 1 }), /AVISO/)
})

test('sin clave, o con una que no tiene forma de clave, no llama a Steam', async () => {
  let called = false
  const fetchImpl = async () => {
    called = true
    return json({})
  }
  await assert.rejects(probe({ key: undefined, fetchImpl }), /falta STEAM_WEB_API_KEY/)
  await assert.rejects(probe({ key: 'no-es-una-clave', fetchImpl }), /falta STEAM_WEB_API_KEY/)
  assert.equal(called, false)
})

test('ningún error lleva la clave, aunque el error original la lleve', async () => {
  const cases = [
    async () => {
      throw new TypeError(`fetch failed for https://x/?key=${FAKE_KEY}`)
    },
    async () => new Response(`<html>${FAKE_KEY}</html>`, { headers: { 'content-type': 'text/html' } }),
    async () => new Response(`{"roto": "${FAKE_KEY}"`, { headers: { 'content-type': 'application/json' } }),
    async () => json({ response: { nada: FAKE_KEY } }),
    // Un corte a mitad del cuerpo, con un error que lleva la clave.
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"response":'))
            controller.error(new Error(`terminated ${FAKE_KEY}`))
          }
        }),
        { headers: { 'content-type': 'application/json' } }
      )
  ]
  for (const fetchImpl of cases) {
    await assert.rejects(probe({ key: FAKE_KEY, fetchImpl }), (error) => {
      assert.ok(!error.message.includes(FAKE_KEY), `el error lleva la clave: ${error.message}`)
      assert.equal(error.cause, undefined)
      return true
    })
  }
})

test('el informe no lleva nada más que el código, el recuento y el tiempo', () => {
  assert.equal(report({ status: 200, count: 3062, ms: 1451 }), 'HTTP 200, 3062 servidores no vacíos, 1451 ms')
})

test('countServers exige la forma de GetServerList', () => {
  assert.equal(countServers({ response: { servers: [] } }), 0)
  assert.throws(() => countServers(null), /response\.servers/)
  assert.throws(() => countServers({ response: {} }), /response\.servers/)
})
