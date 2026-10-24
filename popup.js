const $ = (sel, root = document) => root.querySelector(sel)
const lines = (s) => s.split('\n').map((l) => l.trim()).filter(Boolean)

// All topic writes go through the background worker so they can't race a running build.
async function send(msg) {
  const res = await chrome.runtime.sendMessage(msg)
  if (res?.error) throw new Error(res.error)
  return res?.result
}

let topics = []
const opened = new Set()
const rows = new Map() // topic id -> <li>

// ---------- adding ----------

const query = $('#query')
const results = $('#results')
let searchTimer = null
let searchSeq = 0
let choices = []

function showChoices(text, found, status) {
  const plain = { label: `Just hide posts that say “${text}”`, name: text }
  choices = [...found.map((r) => ({ label: r.label, small: r.description, name: r.label, qid: r.qid, description: r.description })), plain]
  results.replaceChildren(
    ...(status ? [Object.assign(document.createElement('p'), { textContent: status })] : []),
    ...choices.map((c, i) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.dataset.i = i
      b.textContent = c.label
      if (c.small) b.append(Object.assign(document.createElement('small'), { textContent: c.small }))
      return b
    }),
  )
  results.hidden = false
}

function clearSearch() {
  clearTimeout(searchTimer)
  searchSeq++
  query.value = ''
  results.hidden = true
  choices = []
}

query.addEventListener('input', () => {
  clearTimeout(searchTimer)
  const text = query.value.trim()
  if (text.length < 2) return (results.hidden = true)
  const seq = ++searchSeq
  showChoices(text, [], 'Searching...')
  searchTimer = setTimeout(async () => {
    try {
      const found = await send({ type: 'search', query: text })
      if (seq === searchSeq) showChoices(text, found, found.length ? '' : 'No movies, shows or games found')
    } catch {
      if (seq === searchSeq) showChoices(text, [], "Couldn't reach Wikidata")
    }
  }, 300)
})

async function pick(choice) {
  clearSearch()
  const existing = choice.qid && topics.find((t) => t.qid === choice.qid)
  if (existing) return send({ type: 'update', id: existing.id, changes: { enabled: true } })
  await send({ type: 'add', name: choice.name, qid: choice.qid, description: choice.description })
}

results.addEventListener('click', (e) => {
  const b = e.target.closest('button')
  if (b) pick(choices[b.dataset.i])
})

// Enter takes the top result; arrows move through the list.
$('#add').addEventListener('submit', (e) => {
  e.preventDefault()
  if (choices.length) pick(choices[0])
})
$('#add').addEventListener('keydown', (e) => {
  const buttons = [...results.querySelectorAll('button')]
  const at = buttons.indexOf(document.activeElement)
  if (e.key === 'Escape' && query.value) {
    e.preventDefault()
    clearSearch()
    query.focus()
  } else if (e.key === 'ArrowDown' && buttons.length) {
    e.preventDefault()
    buttons[Math.min(at + 1, buttons.length - 1)].focus()
  } else if (e.key === 'ArrowUp' && at !== -1) {
    e.preventDefault()
    at === 0 ? query.focus() : buttons[at - 1].focus()
  }
})

// ---------- topic list ----------

function age(ts) {
  if (!ts) return ''
  const days = Math.floor((Date.now() - ts) / 864e5)
  return days < 1 ? 'today' : days < 14 ? `${days}d` : `${Math.floor(days / 7)}w`
}

function meta(t) {
  if (t.state === 'building') return t.note || 'Looking up...'
  if (t.state === 'error') return `Lookup failed: ${t.note}`
  const parts = [age(t.added), `${t.keywords.length.toLocaleString()} terms`]
  if (t.subreddits.length) parts.push(`${t.subreddits.length} sub${t.subreddits.length === 1 ? '' : 's'}`)
  return parts.filter(Boolean).join(' · ')
}

// Saves textarea edits a moment after typing stops.
const editTimers = new Map()
function saveField(t, field, value) {
  clearTimeout(editTimers.get(t.id + field))
  editTimers.set(t.id + field, setTimeout(() => send({ type: 'update', id: t.id, changes: { [field]: lines(value) } }), 400))
}

function createRow(id) {
  const el = $('#topic-tpl').content.firstElementChild.cloneNode(true)
  const topic = () => topics.find((t) => t.id === id)

  $('.enabled', el).addEventListener('change', (e) => send({ type: 'update', id, changes: { enabled: e.target.checked } }))

  $('.name', el).addEventListener('click', () => {
    opened.has(id) ? opened.delete(id) : opened.add(id)
    el.classList.toggle('open', opened.has(id))
  })

  // Two clicks to remove, so a stray click doesn't lose a list.
  const del = $('.delete', el)
  let armed = null
  del.addEventListener('click', () => {
    if (armed) return send({ type: 'remove', id })
    del.textContent = 'Sure?'
    del.classList.add('confirm')
    armed = setTimeout(() => {
      armed = null
      del.textContent = 'Remove'
      del.classList.remove('confirm')
    }, 2500)
  })

  for (const field of ['keywords', 'subreddits']) {
    $(`.${field}`, el).addEventListener('input', (e) => saveField(topic(), field, e.target.value))
  }

  $('.rebuild', el).addEventListener('click', () => send({ type: 'rebuild', id }))

  $('.copy', el).addEventListener('click', async (e) => {
    await navigator.clipboard.writeText(SpoilitSources.buildPrompt(topic(), true))
    e.target.textContent = 'Copied, paste the reply below'
    setTimeout(() => (e.target.textContent = 'Copy chatbot prompt'), 2500)
  })

  // Imports straight from the paste so there's no extra button to press.
  $('.paste', el).addEventListener('paste', async (e) => {
    e.preventDefault()
    const added = await send({ type: 'import', id, text: e.clipboardData.getData('text') })
    e.target.placeholder = `Added ${added} new terms. Paste more to add more.`
  })

  return el
}

function render() {
  const list = $('#topics')
  for (const [id, el] of rows) {
    if (!topics.some((t) => t.id === id)) {
      el.remove()
      rows.delete(id)
    }
  }
  topics.forEach((t, i) => {
    let el = rows.get(t.id)
    if (!el) rows.set(t.id, (el = createRow(t.id)))
    if (list.children[i] !== el) list.insertBefore(el, list.children[i] || null)

    el.className = 'topic'
    el.classList.toggle('open', opened.has(t.id))
    el.classList.toggle('off', !t.enabled)
    el.classList.toggle('building', t.state === 'building')
    el.classList.toggle('error', t.state === 'error')
    $('.enabled', el).checked = t.enabled
    $('.title', el).textContent = t.name
    $('.name', el).title = t.description || t.name
    $('.meta', el).textContent = meta(t)
    $('.note', el).textContent = [t.description, t.state === 'ready' && t.note].filter(Boolean).join('. ')
    $('.rebuild', el).disabled = t.state === 'building'

    // Don't clobber a list the user is in the middle of editing.
    for (const field of ['keywords', 'subreddits']) {
      const area = $(`.${field}`, el)
      if (document.activeElement !== area) area.value = t[field].join('\n')
    }
  })
  $('#empty').hidden = topics.length > 0
}

// ---------- header and footer ----------

function renderActive(paused) {
  $('#active').checked = !paused
  $('#active-label').textContent = paused ? 'Paused' : 'On'
}

$('#active').addEventListener('change', (e) => chrome.storage.local.set({ paused: !e.target.checked }))
$('#settings').addEventListener('click', () => chrome.runtime.openOptionsPage())

async function renderSummary() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  const count = tab ? await chrome.action.getBadgeText({ tabId: tab.id }) : ''
  $('#summary').textContent = count ? `${count} hidden on this page` : ''
}

// ---------- init ----------

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return
  if (changes.topics) {
    topics = changes.topics.newValue || []
    render()
  }
  if (changes.paused) renderActive(changes.paused.newValue)
})

chrome.storage.local.get(['topics', 'paused'], (s) => {
  topics = s.topics || []
  render()
  renderActive(s.paused)
})
renderSummary()
