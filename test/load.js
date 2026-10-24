// match.js, words.js and sources.js are plain browser scripts that declare globals.
// Run them in one shared context so tests see them the way the extension does.
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function load(...files) {
  const ctx = vm.createContext({ console, URL, URLSearchParams, setTimeout, structuredClone })
  for (const f of files) {
    const code = fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
    vm.runInContext(code, ctx, { filename: f })
  }
  return ctx
}

module.exports = { load }
