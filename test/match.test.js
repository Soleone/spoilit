const test = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./load')

const { Spoilit } = (() => {
  const ctx = load('match.js')
  return { Spoilit: ctx.Spoilit }
})()

const topic = (name, keywords = [], subreddits = [], extra = {}) => ({ name, keywords, subreddits, enabled: true, ...extra })
const hits = (topics, text, sub = '') => Spoilit.match(Spoilit.compile(topics), text, sub)?.term ?? null

test('matches whole words only, ignoring case', () => {
  const t = [topic('Severance')]
  assert.equal(hits(t, 'SEVERANCE finale thread'), 'severance')
  assert.equal(hits(t, 'severances are painful'), 'severances')
  assert.equal(hits(t, 'unseverancely'), null)
})

test('ignores accents on both sides', () => {
  assert.ok(hits([topic('Pokémon')], 'new pokemon leak'))
  assert.ok(hits([topic('Pokemon')], 'Pokémon Legends'))
})

test('multi-word titles match spaced, hyphenated, hashtagged and glued forms', () => {
  const t = [topic('House of the Dragon')]
  for (const text of ['House of the Dragon', 'house-of-the-dragon', '#HouseOfTheDragon', 'houseofthedragon', 'House  of   the Dragon!']) {
    assert.ok(hits(t, text), text)
  }
  assert.equal(hits(t, 'house of cards'), null)
})

test('short mixed-case abbreviations match exact case only', () => {
  const t = [topic('Game of Thrones', ['GoT', 'HotD'])]
  assert.equal(hits(t, 'got milk'), null)
  assert.equal(hits(t, 'I just got home'), null)
  assert.equal(hits(t, 'GoT was great'), 'GoT')
  assert.equal(hits(t, 'hotd s2'), null)
  assert.equal(hits(t, 'HotD s2'), 'HotD')
})

test('keywords and subreddits both count', () => {
  const t = [topic('Andor', ['Cassian Andor', 'Luthen Rael'], ['r/andor', '/r/AndorTV'])]
  assert.equal(hits(t, 'Luthen Rael is the best'), 'luthen rael')
  assert.equal(hits(t, 'unrelated title', 'andor'), 'r/andor')
  assert.equal(hits(t, 'unrelated title', 'r/AndorTV'), 'r/andortv')
  assert.equal(hits(t, 'unrelated title', 'movies'), null)
})

test('disabled topics never match', () => {
  assert.equal(hits([topic('Andor', [], [], { enabled: false })], 'Andor'), null)
})

test('first matching topic wins and reports which one', () => {
  const compiled = Spoilit.compile([topic('Dune'), topic('Andor')])
  assert.equal(Spoilit.match(compiled, 'Andor and Dune', '').topic.name, 'Dune')
  assert.equal(Spoilit.match(compiled, 'only Andor here', '').topic.name, 'Andor')
})

test('overlong and empty terms are skipped without breaking the rest', () => {
  const t = [topic('Real', ['', '   ', 'one two three four five six seven eight nine ten', 'Needle'])]
  assert.equal(hits(t, 'a needle in a haystack'), 'needle')
  assert.equal(hits(t, 'one two three four five six seven eight nine ten'), null)
})

test('stays fast with thousands of terms on a long post', () => {
  const keywords = Array.from({ length: 5000 }, (_, i) => `character number ${i}`)
  const compiled = Spoilit.compile([topic('Big', keywords)])
  const text = 'lorem ipsum dolor sit amet '.repeat(2000) + 'character number 4999'
  const start = performance.now()
  const hit = Spoilit.match(compiled, text, '')
  const ms = performance.now() - start
  assert.ok(hit)
  assert.ok(ms < 100, `took ${ms.toFixed(1)}ms`)
})

test('normSub strips prefixes and case', () => {
  assert.equal(Spoilit.normSub(' /r/Andor '), 'andor')
  assert.equal(Spoilit.normSub('r/Andor'), 'andor')
  assert.equal(Spoilit.normSub(undefined), '')
})
