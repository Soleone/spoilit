importScripts('match.js', 'words.js', 'sources.js')

chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeBackgroundColor({ color: '#222' })
})

// ---------- topic store ----------

// Every topic write goes through this queue so the popup and a running build
// never overwrite each other's changes.
let queue = Promise.resolve()
function edit(fn) {
  const run = queue.then(async () => {
    const { topics = [] } = await chrome.storage.local.get('topics')
    const result = fn(topics)
    await chrome.storage.local.set({ topics })
    return result
  })
  queue = run.catch(() => {})
  return run
}

const patch = (id, changes) =>
  edit((topics) => {
    const topic = topics.find((t) => t.id === id)
    if (topic) Object.assign(topic, changes)
    return topic && structuredClone(topic)
  })

function add({ name, qid, description }) {
  const topic = {
    id: crypto.randomUUID(),
    name,
    qid: qid || null,
    description: description || '',
    added: Date.now(),
    enabled: true,
    keywords: [],
    subreddits: [],
    state: 'ready',
    note: '',
  }
  return edit((topics) => topics.unshift(topic)).then(() => {
    build(topic.id)
    return topic.id
  })
}

function addTerms(id, dump) {
  return edit((topics) => {
    const t = topics.find((t) => t.id === id)
    if (!t) return 0
    const before = t.keywords.length
    t.keywords = SpoilitSources.merge(t.keywords, dump.keywords)
    t.subreddits = SpoilitSources.merge(t.subreddits, dump.subreddits.map(Spoilit.normSub), Spoilit.normSub)
    return t.keywords.length - before
  })
}

// ---------- building ----------

// Collects terms from every source and merges them into the topic. Progress
// goes into topic.note, and those storage writes also keep this worker alive.
async function build(id) {
  const topic = await patch(id, { state: 'building', note: 'Starting...' })
  if (!topic) return
  const say = (note) => patch(id, { note })
  const found = { keywords: [], subreddits: [] }
  const done = []

  try {
    if (topic.qid) {
      const wd = await SpoilitSources.fromWikidata(topic.qid, say)
      found.keywords.push(...wd.keywords)
      found.subreddits.push(...wd.subreddits)
      done.push(`${wd.keywords.length} names from Wikidata${wd.partial ? ' (Wikidata was busy, so look up again later for characters and cast)' : ''}`)

      say('Looking for a fan wiki...')
      const wiki = topic.wiki || (await SpoilitSources.findWiki(wd))
      if (wiki) {
        const pages = await SpoilitSources.fromFandom(wiki, topic.name, say)
        found.keywords.push(...pages)
        done.push(`${pages.length} terms from ${wiki}.fandom.com`)
        await patch(id, { wiki })
      }
    }

    const { apiKey, webSearch } = await chrome.storage.local.get(['apiKey', 'webSearch'])
    if (apiKey) {
      say(webSearch !== false ? 'Claude is searching the web...' : 'Asking Claude...')
      try {
        const dump = await SpoilitSources.fromClaude(topic, apiKey, webSearch !== false)
        found.keywords.push(...dump.keywords)
        found.subreddits.push(...dump.subreddits)
        done.push(`${dump.keywords.length} from Claude`)
      } catch (err) {
        done.push(`Claude failed: ${err.message}`)
      }
    }

    await addTerms(id, found)
    await patch(id, { state: 'ready', note: done.join(' · ') || 'Matching the name only', built: Date.now() })
  } catch (err) {
    await addTerms(id, found)
    await patch(id, { state: 'error', note: err.message })
  }
}

// A worker restart mid-build leaves a topic stuck; pick those back up.
chrome.runtime.onStartup.addListener(async () => {
  const { topics = [] } = await chrome.storage.local.get('topics')
  for (const t of topics) if (t.state === 'building') build(t.id)
})

// ---------- messages ----------

const handlers = {
  search: ({ query }) => SpoilitSources.search(query),
  add: (msg) => add(msg),
  update: ({ id, changes }) => patch(id, changes),
  remove: ({ id }) =>
    edit((topics) => {
      const i = topics.findIndex((t) => t.id === id)
      if (i !== -1) topics.splice(i, 1)
    }),
  rebuild: ({ id }) => (build(id), true),
  import: ({ id, text }) => addTerms(id, SpoilitSources.parseDump(text)),
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  // Content scripts report how many items they're hiding on their tab.
  if (msg.type === 'count') {
    if (sender.tab) chrome.action.setBadgeText({ tabId: sender.tab.id, text: msg.count ? String(msg.count) : '' })
    return
  }
  const handler = handlers[msg.type]
  if (!handler) return
  Promise.resolve(handler(msg)).then(
    (result) => reply({ result }),
    (err) => reply({ error: err.message }),
  )
  return true
})
