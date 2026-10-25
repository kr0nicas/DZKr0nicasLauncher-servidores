// Pruebas de texto sobre los workflows, sin dependencias (no hay analizador de YAML): lo que no debe
// cambiar sin que se note al revisar.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'

const dir = new URL('./.github/workflows/', import.meta.url)
const read = (name) => readFileSync(new URL(name, dir), 'utf8')
const publicar = read('publicar.yml')

/** El bloque de un trabajo: desde «  <nombre>:» hasta el siguiente trabajo o el final. */
function job(text, name) {
  const lines = text.split('\n')
  const start = lines.findIndex((l) => l === `  ${name}:`)
  assert.ok(start >= 0, `no está el trabajo ${name}`)
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((l) => /^ {2}\S/.test(l))
  // Sin los comentarios: lo que se comprueba es lo que hace, no lo que dice.
  return [lines[start], ...(end < 0 ? rest : rest.slice(0, end))]
    .filter((l) => !/^\s*#/.test(l))
    .join('\n')
}

test('la pasada diaria se nombra igual en el cron y en las tres condiciones', () => {
  assert.equal(publicar.split("'7 0 * * *'").length - 1, 4)
})

test('mantener solo puede encender workflows: sin environment, sin checkout, sin secretos', () => {
  const m = job(publicar, 'mantener')
  assert.match(m, /permissions:\n\s+actions: write\n/)
  assert.doesNotMatch(m, /environment|checkout|secrets\.|contents: write|pages:|id-token/)
  assert.match(m, /gh workflow enable publicar\.yml/)
})

test('la clave de Steam solo está en el paso que pide a Steam, y solo en «generar»', () => {
  const generar = job(publicar, 'generar')
  assert.match(generar, /STEAM_WEB_API_KEY: \$\{\{ secrets\.STEAM_WEB_API_KEY \}\}\n\s+run: node pedir-a-steam\.mjs/)
  assert.equal(generar.split('secrets.').length - 1, 1)
  assert.match(generar, /environment: steam\n/)
  assert.doesNotMatch(generar, /LISTA_FIRMA_PRIVADA|upload-pages-artifact/)
  assert.doesNotMatch(job(publicar, 'publicar'), /secrets\.|checkout/)
})

test('la privada de firma solo está en el paso que firma, en su trabajo y su environment (11.6 g)', () => {
  // Dos secretos en todo el archivo, cada uno en su trabajo.
  assert.equal(publicar.split('secrets.').length - 1, 2)
  const firmar = job(publicar, 'firmar')
  assert.match(firmar, /environment: firma\n/)
  assert.match(firmar, /permissions: \{\}\n/)
  assert.match(firmar, /needs: generar\n/)
  assert.match(firmar, /LISTA_FIRMA_PRIVADA: \$\{\{ secrets\.LISTA_FIRMA_PRIVADA \}\}\n\s+run: node firmar\.mjs _site\n/)
  assert.equal(firmar.split('secrets.').length - 1, 1)
  assert.doesNotMatch(firmar, /STEAM_WEB_API_KEY|steam\.json/)
  assert.match(firmar, /persist-credentials: false/)
  // Solo se despliega lo firmado: publicar depende de firmar, sin ningún «if» que lo reabra.
  assert.match(job(publicar, 'publicar'), /needs: firmar\n/)
  assert.doesNotMatch(job(publicar, 'publicar'), /\bif:|always\(\)/)
  assert.doesNotMatch(firmar, /\bif:|continue-on-error/)
})

test('el trabajo que firma: sus pasos, en este orden y con estos SHA (11.6 g, seguridad I4)', () => {
  const steps = job(publicar, 'firmar')
    .split('\n')
    .filter((l) => /^ {6}- /.test(l))
    .map((l) => l.trim())
  // Cambiar una de estas acciones, o subirla de versión, es un cambio con acceso a la privada: esta
  // prueba falla a propósito para que se revise.
  assert.deepEqual(steps, [
    '- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1',
    '- uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2',
    '- name: Firmar',
    '- name: Verificar',
    '- uses: actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9 # v5.0.0'
  ])
  const firmar = job(publicar, 'firmar')
  assert.match(firmar, /name: Verificar\n\s+run: node verificar-sitio\.mjs _site\n/)
  // El artefacto que sube generar es el que baja firmar.
  assert.match(job(publicar, 'generar'), /upload-artifact@[0-9a-f]{40} # v[\d.]+\n\s+with:\n\s+name: lista\n\s+path: _site\n/)
  assert.match(firmar, /download-artifact@[0-9a-f]{40} # v[\d.]+\n\s+with:\n\s+name: lista\n\s+path: _site\n/)
})

test('la privada de firma no aparece en ningún otro workflow ni trabajo (11.6 g, seguridad I4)', () => {
  for (const name of readdirSync(dir)) {
    const text = read(name)
    const uses = text.split('LISTA_FIRMA_PRIVADA').length - 1
    const env = text.split('environment: firma').length - 1
    if (name === 'publicar.yml') {
      assert.equal(uses, 2, 'el nombre y el secreto, en el paso Firmar')
      assert.equal(env, 1)
      for (const other of ['generar', 'publicar', 'mantener'])
        assert.doesNotMatch(job(text, other), /LISTA_FIRMA_PRIVADA|environment: firma/)
    } else {
      assert.equal(uses + env, 0, name)
    }
  }
})

test('ningún workflow usa pull_request_target, ni ${{ }} dentro de run, ni acciones sin SHA', () => {
  for (const name of readdirSync(dir)) {
    const text = read(name)
    assert.doesNotMatch(text, /pull_request_target/, name)
    for (const line of text.split('\n')) {
      if (/^\s*uses:/.test(line)) assert.match(line, /@[0-9a-f]{40} # v/, `${name}: ${line.trim()}`)
      if (/^\s*run:/.test(line)) assert.doesNotMatch(line, /\$\{\{/, `${name}: ${line.trim()}`)
    }
  }
  // Y el bloque `run: |` de mantener tampoco.
  assert.doesNotMatch(job(publicar, 'mantener').split('run: |')[1] ?? '', /\$\{\{/)
})
