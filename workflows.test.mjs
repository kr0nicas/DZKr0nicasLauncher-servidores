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

test('la clave solo está en el paso que pide a Steam, y solo en «generar»', () => {
  assert.equal(publicar.split('secrets.').length - 1, 1)
  assert.match(job(publicar, 'generar'), /STEAM_WEB_API_KEY: \$\{\{ secrets\.STEAM_WEB_API_KEY \}\}\n\s+run: node pedir-a-steam\.mjs/)
  assert.doesNotMatch(job(publicar, 'publicar'), /secrets\.|checkout/)
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
