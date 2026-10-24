// Keyword matcher shared by the content script, background and settings page.
//
// Matching is whole-word, ignores case and accents, tolerates a trailing "s",
// and lets phrase parts be joined by spaces, punctuation or nothing, so
// "House of the Dragon" also catches "#HouseOfTheDragon" and "house-of-the-dragon".
// Short abbreviations with an inner capital ("GoT", "HotD") match exact case
// so they don't fire on everyday words like "got".
//
// Terms are stored as their word parts glued together ("houseofthedragon") and
// text is checked by gluing runs of consecutive words, so cost depends on the
// length of the post, not on how many thousand terms a topic has.
var Spoilit = (() => {
  const stripMarks = (s) => s.normalize('NFKD').replace(/\p{M}/gu, '')
  const fold = (s) => stripMarks(s).toLowerCase()
  const WORD = /[\p{L}\p{N}]+/gu
  const MAX_WORDS = 8

  const isExactCase = (term) => /^\S{2,5}$/.test(term) && /\p{Lu}/u.test(term.slice(1))
  const words = (s) => s.match(WORD) || []
  const normSub = (s) => (s || '').trim().toLowerCase().replace(/^\/?r\//, '')

  function compile(topics) {
    return topics
      .filter((t) => t.enabled !== false)
      .map((t) => {
        const loose = new Set()
        const exact = new Set()
        let span = 1
        for (const raw of [t.name, ...(t.keywords || [])]) {
          const term = (raw || '').trim()
          if (!term) continue
          const keepCase = isExactCase(term)
          const parts = words(keepCase ? stripMarks(term) : fold(term))
          if (!parts.length || parts.length > MAX_WORDS) continue
          ;(keepCase ? exact : loose).add(parts.join(''))
          span = Math.max(span, parts.length)
        }
        return { topic: t, loose, exact, span, subs: new Set((t.subreddits || []).map(normSub).filter(Boolean)) }
      })
  }

  // Finds the first run of words in `list` that, glued together, is a term.
  function find(set, list, span) {
    if (!set.size) return null
    for (let i = 0; i < list.length; i++) {
      let glued = ''
      for (let j = i; j < list.length && j < i + span; j++) {
        glued += list[j]
        if (set.has(glued) || (glued.endsWith('s') && set.has(glued.slice(0, -1)))) {
          return list.slice(i, j + 1).join(' ')
        }
      }
    }
    return null
  }

  // Returns { topic, term } for the first topic that matches, or null.
  function match(compiled, text, subreddit) {
    const sub = normSub(subreddit)
    let folded, cased
    for (const c of compiled) {
      if (sub && c.subs.has(sub)) return { topic: c.topic, term: `r/${sub}` }
      const term =
        find(c.loose, (folded ??= words(fold(text))), c.span) ||
        find(c.exact, (cased ??= words(stripMarks(text))), c.span)
      if (term) return { topic: c.topic, term }
    }
    return null
  }

  return { compile, match, fold, normSub, words }
})()
