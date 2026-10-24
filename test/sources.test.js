const test = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./load')

const ctx = load('match.js', 'words.js', 'sources.js')
const S = ctx.SpoilitSources

test('parseDump reads the JSON a chatbot was asked for, even inside prose or a code fence', () => {
  const reply = 'Sure! Here you go:\n```json\n{"keywords": ["Luthen Rael", "Ferrix"], "subreddits": ["andor"]}\n```\nEnjoy.'
  assert.deepEqual(JSON.parse(JSON.stringify(S.parseDump(reply))), { keywords: ['Luthen Rael', 'Ferrix'], subreddits: ['andor'] })
})

test('parseDump falls back to loose lists and sorts subreddits out', () => {
  const dump = S.parseDump('- Luthen Rael\n2. "Ferrix"\n* r/andor, /r/StarWarsAndor; Mon Mothma')
  assert.deepEqual([...dump.keywords], ['Luthen Rael', 'Ferrix', 'Mon Mothma'])
  assert.deepEqual([...dump.subreddits], ['andor', 'StarWarsAndor'])
})

test('parseDump survives broken JSON and non-string entries', () => {
  assert.deepEqual([...S.parseDump('{"keywords": ["ok", 3, null]}').keywords], ['ok'])
  assert.ok(S.parseDump('{"keywords": [oops').keywords.length > 0)
})

test('merge adds only new items, compared case and accent insensitively', () => {
  assert.deepEqual([...S.merge(['Pokémon', 'Ash'], ['pokemon', 'Misty', ' ash ', ''])], ['Pokémon', 'Ash', 'Misty'])
})

test('titleVariants covers numerals, roman numerals and initialisms', () => {
  const v = [...S.titleVariants('Grand Theft Auto VI')]
  for (const want of ['grand theft auto vi', 'grand theft auto 6', 'gta vi', 'gta 6']) assert.ok(v.includes(want), `${want} in ${v}`)
  const hotd = [...S.titleVariants('House of the Dragon')]
  assert.ok(hotd.includes('hotd'))
  const lotr = [...S.titleVariants('The Lord of the Rings')]
  assert.ok(lotr.includes('tlotr') && lotr.includes('lotr'))
})

test('titleVariants does not invent abbreviations that are real words', () => {
  assert.deepEqual([...S.titleVariants('Up')], [])
})

test('distinctive keeps rare names and drops everyday words and bare numbers', () => {
  assert.equal(S.distinctive('Rhaenyra'), true)
  assert.equal(S.distinctive('Messmer the Impaler'), true)
  assert.equal(S.distinctive('finale'), false)
  assert.equal(S.distinctive('2024'), false)
  assert.equal(S.distinctive('Season 3'), false)
})

test('buildPrompt names the topic and asks for the shape parseDump reads', () => {
  const p = S.buildPrompt({ name: 'Andor', description: 'Star Wars series' }, true)
  assert.match(p, /"Andor" \(Star Wars series\)/)
  assert.match(p, /Search the web/)
  assert.deepEqual([...S.parseDump(p.match(/\{"keywords".*\}$/)[0].replace(/\.\.\./g, 'x')).keywords], ['x'])
})

test('words.js ships ordinary words that should never match alone', () => {
  for (const w of ['finale', 'trailer', 'spoiler', 'boss', 'aaron']) assert.ok(ctx.SpoilitCommon.has(w), w)
})
