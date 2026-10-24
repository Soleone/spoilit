// Where topic terms come from. Wikidata and Fandom need no key; Claude is an
// optional extra when the user has added an API key in settings.
// Needs match.js and words.js loaded first.
var SpoilitSources = (() => {
  const WIKIDATA = 'https://www.wikidata.org/w/api.php'
  const MODEL = 'claude-opus-5-5'

  // Instance-of types we search within, so "Weapons" finds the film, not the tool.
  const TYPES = [
    'Q11424', // film
    'Q202866', // animated film
    'Q24856', // film series
    'Q5398426', // television series
    'Q1259759', // miniseries
    'Q581714', // animated series
    'Q63952888', // anime television series
    'Q3464665', // television series season
    'Q7889', // video game
    'Q7058673', // video game series
    'Q7725634', // literary work
    'Q1667921', // novel series
    'Q196600', // media franchise
  ]

  // Wikimedia asks API clients to identify themselves, and rate-limits bursts.
  async function get(url) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, { headers: { 'Api-User-Agent': 'Spoilit/0.2 (browser extension)' } })
      if (res.ok) return res.json()
      if (res.status !== 429 || attempt === 3) throw new Error(`${new URL(url).host} answered ${res.status}`)
      const wait = Math.min(Number(res.headers.get('retry-after')) || 2 ** attempt, 8)
      await new Promise((r) => setTimeout(r, wait * 1000))
    }
  }

  // Spaced out a little, since a burst from one browser gets rate-limited.
  let lastWikidata = 0
  async function wikidata(params) {
    const wait = lastWikidata + 250 - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    lastWikidata = Date.now()
    return get(`${WIKIDATA}?${new URLSearchParams({ ...params, format: 'json', origin: '*' })}`)
  }

  // id -> entity, fetched 50 at a time.
  async function entities(ids, props) {
    const out = {}
    for (let i = 0; i < ids.length; i += 50) {
      const data = await wikidata({ action: 'wbgetentities', ids: ids.slice(i, i + 50).join('|'), props, languages: 'en' })
      Object.assign(out, data.entities)
    }
    return out
  }

  const label = (e) => e?.labels?.en?.value
  const aliases = (e) => (e?.aliases?.en || []).map((a) => a.value)
  const values = (claims, prop) => (claims?.[prop] || []).map((c) => c.mainsnak.datavalue?.value).filter(Boolean)
  const ids = (claims, prop) => values(claims, prop).map((v) => v.id).filter(Boolean)
  const roles = (claims, prop) =>
    (claims?.[prop] || []).flatMap((c) => (c.qualifiers?.P453 || []).map((q) => q.datavalue?.value?.id)).filter(Boolean)

  // Up to 6 { qid, label, description } for a typed name.
  async function search(query) {
    const types = TYPES.map((t) => `P31=${t}`).join('|')
    const found = await wikidata({ action: 'query', list: 'search', srsearch: `${query} haswbstatement:${types}`, srlimit: 6 })
    const qids = found.query.search.map((r) => r.title)
    if (!qids.length) {
      const loose = await wikidata({ action: 'wbsearchentities', search: query, language: 'en', type: 'item', limit: 6 })
      return loose.search.map((r) => ({ qid: r.id, label: r.label, description: r.description || '' }))
    }
    const info = await entities(qids, 'labels|descriptions')
    const results = qids.map((q) => ({ qid: q, label: label(info[q]) || q, description: info[q]?.descriptions?.en?.value || '' }))
    // An exact title beats a sequel or spin-off ("Elden Ring" before "Elden Ring Nightreign").
    const exact = (r) => Spoilit.words(Spoilit.fold(r.label)).join(' ') === Spoilit.words(Spoilit.fold(query)).join(' ')
    return [...results.filter(exact), ...results.filter((r) => !exact(r))]
  }

  const isNumber = (w) => /^\d+$/.test(w)
  const isRare = (w) => w.length >= 4 && !isNumber(w) && !SpoilitCommon.has(w)
  const parts = (term) => Spoilit.words(Spoilit.fold(term)).filter((w) => w.length > 1)

  // A title or place that's unlikely to show up in an unrelated post.
  function distinctive(term) {
    const p = parts(term)
    if (!p.length || p.length > 6 || p.every(isNumber)) return false
    return p.length >= 3 || p.some(isRare)
  }

  // Full names are always specific enough; their rare parts ("Rhaenyra") also count alone.
  function nameTerms(name, split) {
    const p = parts(name)
    const out = []
    if (p.length >= 2 || (p.length === 1 && isRare(p[0]))) out.push(name)
    if (split && p.length >= 2) out.push(...Spoilit.words(name).filter((w) => isRare(Spoilit.fold(w))))
    return out
  }

  const ROMAN = ['', 'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x']

  // How people shorten a title: "Grand Theft Auto VI" -> "Grand Theft Auto 6",
  // "gta vi", "gta 6"; "House of the Dragon" -> "hotd". Lowercase so they match
  // any casing, and the matcher already treats "gta 6" and "gta6" alike.
  function titleVariants(title) {
    const w = Spoilit.words(Spoilit.fold(title))
    if (!w.length) return []
    const last = w[w.length - 1]
    const roman = ROMAN.indexOf(last)
    const num = roman > 1 ? String(roman) : isNumber(last) ? last : null
    const base = num ? w.slice(0, -1) : w
    const nums = num ? [...new Set([last, num, ROMAN[num]].filter(Boolean))] : ['']
    const out = num ? nums.map((n) => [...base, n].join(' ')) : []
    // With and without a leading "the": "tlotr" and "lotr".
    for (const b of [base, base[0] === 'the' ? base.slice(1) : []]) {
      const initials = b.length >= 3 ? b.map((x) => x[0]).join('') : ''
      if (initials && !SpoilitCommon.has(initials)) out.push(...nums.map((n) => `${initials} ${n}`.trim()))
    }
    return out
  }

  // Titles, aliases, characters, cast, crew, episodes and subreddits for one Wikidata item.
  async function fromWikidata(qid, say) {
    say('Reading Wikidata...')
    const root = (await entities([qid], 'labels|aliases|claims'))[qid]
    const c = root.claims || {}

    // Seasons, the book it's based on and the series it belongs to carry more
    // characters and episode titles than the item itself.
    const related = [...ids(c, 'P527').slice(0, 30), ...ids(c, 'P144'), ...ids(c, 'P179')]
    const more = Object.values(related.length ? await entities(related, 'labels|claims') : {})
    const all = [root, ...more]

    const characterIds = all.flatMap((e) => [...ids(e.claims, 'P674'), ...roles(e.claims, 'P161'), ...roles(e.claims, 'P725')])
    const peopleIds = all.flatMap((e) => ['P161', 'P725', 'P57', 'P170'].flatMap((p) => ids(e.claims, p)))
    const episodeIds = more.flatMap((e) => ids(e.claims, 'P527'))

    say('Reading characters, cast and episodes...')
    let people = {}
    let partial = false
    try {
      people = await entities([...new Set([...characterIds, ...peopleIds, ...episodeIds])], 'labels|aliases')
    } catch {
      partial = true
    }

    const titles = [label(root), ...aliases(root)].filter(Boolean)
    const keywords = [...titles, ...titles.flatMap(titleVariants)]
    for (const e of more) if (label(e) && distinctive(label(e))) keywords.push(label(e))
    for (const id of new Set(characterIds)) {
      for (const n of [label(people[id]), ...aliases(people[id])].filter(Boolean)) keywords.push(...nameTerms(n, true))
    }
    for (const id of new Set(peopleIds)) if (label(people[id])) keywords.push(...nameTerms(label(people[id]), false))
    for (const id of new Set(episodeIds)) if (distinctive(label(people[id]) || '')) keywords.push(label(people[id]))

    return {
      keywords,
      subreddits: all.flatMap((e) => values(e.claims, 'P3984')),
      wikis: [...values(c, 'P4073'), ...more.flatMap((e) => values(e.claims, 'P4073'))],
      names: [label(root), ...more.map(label)].filter(Boolean),
      partial,
      // Most-linked names first, used to check a guessed wiki is about this topic.
      checks: [...new Set([...characterIds, ...peopleIds])].map((id) => label(people[id])).filter(Boolean).slice(0, 20),
    }
  }

  // "starwars" -> https://starwars.fandom.com, "harrypotter/de" -> https://harrypotter.fandom.com/de
  const wikiBase = (id) => {
    const [host, lang] = id.split('/')
    return `https://${host}.fandom.com${lang ? `/${lang}` : ''}`
  }

  async function articleCount(id) {
    try {
      const data = await get(`${wikiBase(id)}/api.php?action=query&meta=siteinfo&siprop=statistics&format=json`)
      return data.query?.statistics?.articles || 0
    } catch {
      return 0
    }
  }

  // How many of these page titles exist on a wiki.
  async function pagesFound(id, titles) {
    if (!titles.length) return 0
    try {
      const data = await get(`${wikiBase(id)}/api.php?${new URLSearchParams({ action: 'query', titles: titles.join('|'), format: 'json' })}`)
      return Object.values(data.query?.pages || {}).filter((p) => !('missing' in p)).length
    } catch {
      return 0
    }
  }

  // First Fandom wiki Wikidata lists, else a guessed one that has pages for some
  // of the topic's characters or cast (a "weapons" wiki exists, but not for the film).
  async function findWiki({ wikis, names, checks }) {
    for (const id of wikis) if ((await articleCount(id)) > 0) return id
    const guesses = names.flatMap((n) => {
      const slug = Spoilit.fold(n).replace(/[^a-z0-9]/g, '')
      return [slug, slug.replace(/^the/, '')]
    })
    for (const id of new Set(guesses.filter(Boolean))) {
      if ((await articleCount(id)) >= 50 && (await pagesFound(id, checks)) >= 1) return id
    }
    return null
  }

  const SKIP_PAGE = /[:/]|\b(season|episode|recap|list of|gallery|soundtrack|transcript|main page|chapter \d+)\b/i

  // Follows MediaWiki's "continue" paging, collecting what `pick` returns per page.
  async function paged(id, params, pick, limit, say) {
    const out = []
    let next = {}
    do {
      const data = await get(`${wikiBase(id)}/api.php?${new URLSearchParams({ ...params, ...next, format: 'json' })}`)
      out.push(...pick(data.query || {}))
      next = data.continue || null
      say(`Reading ${id}.fandom.com... ${out.length.toLocaleString()} pages`)
    } while (next && out.length < limit)
    return out
  }

  const ALL_PAGES_UP_TO = 6000

  // Page titles from a Fandom wiki, minus anything too generic to match on. A
  // small wiki is read whole. A big franchise wiki (GTA has 23k pages) is read
  // from the pages about this title and everything they link to, since reading
  // it alphabetically would stop somewhere in "C".
  async function fromFandom(id, title, say) {
    let titles
    if ((await articleCount(id)) <= ALL_PAGES_UP_TO) {
      const params = { action: 'query', list: 'allpages', apnamespace: '0', apfilterredir: 'nonredirects', aplimit: '500' }
      titles = await paged(id, params, (q) => (q.allpages || []).map((p) => p.title), ALL_PAGES_UP_TO, say)
    } else {
      const search = { action: 'query', list: 'search', srsearch: title, srnamespace: '0', srlimit: '25' }
      const top = await paged(id, search, (q) => (q.search || []).map((p) => p.title), 25, say)
      const links = { action: 'query', prop: 'links', titles: top.join('|'), plnamespace: '0', pllimit: 'max' }
      const linked = await paged(id, links, (q) => Object.values(q.pages || {}).flatMap((p) => (p.links || []).map((l) => l.title)), 5000, say)
      titles = [...top, ...linked]
    }

    // Rare words inside titles count alone too: "Messmer the Impaler" -> "Messmer".
    const kept = titles.map((t) => t.replace(/\s*\([^)]*\)\s*$/, '').trim()).filter((t) => t && !SKIP_PAGE.test(t) && distinctive(t))
    const words = kept.flatMap((t) => Spoilit.words(t).filter((w) => w.length >= 5 && isRare(Spoilit.fold(w))))
    return merge([], [...kept, ...words])
  }

  // ---------- Claude (optional) ----------

  function buildPrompt(topic, withSearch) {
    return `I want to avoid spoilers about: "${topic.name}"${topic.description ? ` (${topic.description})` : ''}.${topic.context ? `\nContext: ${topic.context}` : ''}
${withSearch ? '\nSearch the web first for anything recent (new seasons, new cast, episode titles, leaks) so the list is current.\n' : ''}
Build a blocklist for a simple keyword filter that hides Reddit posts and comments about this topic. The filter matches whole words, ignores case, accents and spacing/punctuation inside phrases, and tolerates a trailing "s". Short abbreviations with an inner capital (like "GoT") match exact case only.

Include:
- Title, alternate and foreign titles, abbreviations, common hashtags
- Character names: full names, plus distinctive first or last names on their own
- Cast and key crew names
- Distinctive places, factions, objects, terms, episode or chapter titles, fandom in-jokes
- Common misspellings of the above

Leave out anything that's a common English word or common name likely to show up in unrelated posts (for example "Dragon", "King", "Jon", "Season"). Aim for 50 to 200 keywords.

Also list subreddits dedicated to this topic, names only without "r/".

Reply with only JSON in this shape: {"keywords": ["..."], "subreddits": ["..."]}`
  }

  async function fromClaude(topic, apiKey, webSearch) {
    const body = {
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: 'medium' },
      fallbacks: 'default',
      messages: [{ role: 'user', content: buildPrompt(topic, webSearch) }],
    }
    if (webSearch) body.tools = [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }]

    // Web search can pause a long turn; resend with the partial reply to let it continue.
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2026-10-21',
          'anthropic-beta': 'server-side-fallback-2026-07-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`)
      if (data.stop_reason === 'refusal') throw new Error('Claude declined this one')
      if (data.stop_reason === 'pause_turn') {
        body.messages = [...body.messages, { role: 'assistant', content: data.content }]
        continue
      }
      return parseDump(data.content.filter((b) => b.type === 'text').map((b) => b.text).join(''))
    }
    throw new Error('Claude took too many rounds')
  }

  // Accepts the JSON we asked for, or a loose list (bullets, commas, r/ prefixes).
  function parseDump(text) {
    const strings = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string') : [])
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start !== -1 && end > start) {
      try {
        const json = JSON.parse(text.slice(start, end + 1))
        return { keywords: strings(json.keywords), subreddits: strings(json.subreddits) }
      } catch {}
    }
    const keywords = []
    const subreddits = []
    for (const part of text.split(/[\n,;]+/)) {
      const term = part.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').replace(/^["'`\s]+|["'`\s]+$/g, '')
      if (!term) continue
      const sub = term.match(/^\/?r\/(\w+)$/i)
      sub ? subreddits.push(sub[1]) : keywords.push(term)
    }
    return { keywords, subreddits }
  }

  // Adds items not already present (compared folded), keeping existing order.
  function merge(existing, added, norm = Spoilit.fold) {
    const have = new Set(existing.map(norm))
    const out = [...existing]
    for (const item of added.map((s) => s.trim()).filter(Boolean)) {
      if (have.has(norm(item))) continue
      have.add(norm(item))
      out.push(item)
    }
    return out
  }

  return { search, fromWikidata, findWiki, fromFandom, fromClaude, buildPrompt, parseDump, merge }
})()
