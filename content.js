// Finds posts and comments on Reddit (new and old) and covers the ones that
// match an enabled topic. Click a covered item to reveal it.

const POSTS = 'shreddit-post, .thing.link, [data-testid="search-post-unit"]'
const COMMENTS = 'shreddit-comment, .thing.comment'
const CANDIDATES = `${POSTS}, ${COMMENTS}`
const UNSEEN = CANDIDATES.split(', ').map((sel) => `${sel}:not([data-spoilit-seen])`).join(', ')
const THREADS = 'shreddit-comment-tree, .commentarea > .sitetable'

let ready = false
let compiled = []
let hideComments = true
let seen = new WeakMap() // element -> text it was last matched against
let lastCount = -1
let lastSignature = null

const pageSubreddit = () => location.pathname.match(/^\/r\/([^/]+)/)?.[1] ?? ''

// Returns { target, text, sub } for a post/comment element, or null.
function describe(el) {
  if (el.matches('shreddit-post')) {
    return {
      target: el.closest('article') || el,
      text: `${el.getAttribute('post-title') || ''}\n${el.textContent}`,
      sub: el.getAttribute('subreddit-prefixed-name') || el.getAttribute('subreddit-name') || pageSubreddit(),
    }
  }
  if (el.matches('.thing.link')) {
    return { target: el, text: el.querySelector('.entry')?.textContent ?? el.textContent, sub: el.dataset.subreddit }
  }
  if (el.matches('shreddit-comment')) {
    const body = el.querySelector(':scope > [slot="comment"]')
    return body && { target: body, text: body.textContent, sub: pageSubreddit() }
  }
  if (el.matches('.thing.comment')) {
    const body = el.querySelector(':scope > .entry .usertext-body')
    return body && { target: body, text: body.textContent, sub: pageSubreddit() }
  }
  return { target: el, text: el.textContent, sub: '' }
}

function evaluate(el) {
  let d = null
  try {
    d = describe(el)
    if (!d || seen.get(el) === d.text) return
    seen.set(el, d.text)

    const isComment = el.matches(COMMENTS)
    const hit = isComment && !hideComments ? null : Spoilit.match(compiled, d.text, d.sub)
    if (hit) {
      d.target.classList.add('spoilit-hit')
      d.target.dataset.spoilit = hit.topic.name
    } else {
      d.target.classList.remove('spoilit-hit', 'spoilit-revealed')
      delete d.target.dataset.spoilit
    }
  } finally {
    // content.css keeps unchecked items invisible; this lets them paint.
    // Done in finally so a bug here can't leave the feed blank.
    el.dataset.spoilitSeen = ''
    if (d) d.target.dataset.spoilitSeen = ''
  }
}

// On a post's own page, a hidden post also hides its whole comment section,
// since most replies talk about it without naming anything from the topic.
function coverThread() {
  const id = location.pathname.match(/\/comments\/([a-z0-9]+)/i)?.[1]
  if (!id) return
  const post = document.querySelector(`shreddit-post#t3_${id}, .thing.link[data-fullname="t3_${id}"]`) || document.querySelector(POSTS)
  const thread = document.querySelector(THREADS) || document.querySelector(COMMENTS)?.parentElement
  if (!post || !thread) return
  const topic = hideComments && describe(post)?.target.dataset.spoilit
  if (topic) {
    thread.classList.add('spoilit-hit')
    thread.dataset.spoilit = `comments about ${topic}`
  } else if (thread.classList.contains('spoilit-hit')) {
    thread.classList.remove('spoilit-hit', 'spoilit-revealed')
    delete thread.dataset.spoilit
  }
}

// Full pass: also re-checks items whose text filled in after insertion.
function scan() {
  if (!ready) return
  for (const el of document.querySelectorAll(CANDIDATES)) evaluate(el)
  coverThread()
  reportCount()
}

// Runs inside the MutationObserver callback, which fires before the browser
// paints, so new posts are matched before they ever show up on screen.
function scanNew() {
  if (!ready) return
  for (const el of document.querySelectorAll(UNSEEN)) evaluate(el)
  coverThread()
}

function reportCount() {
  const count = document.querySelectorAll('.spoilit-hit:not(.spoilit-revealed)').length
  if (count === lastCount) return
  lastCount = count
  try {
    chrome.runtime.sendMessage({ type: 'count', count })
  } catch {
    // Extension was reloaded; this page's script is orphaned.
  }
}

// Re-checks everything against new settings. Items you already revealed stay
// revealed as long as they still match.
function reset() {
  seen = new WeakMap()
  scan()
}

let timer = null
const scheduleScan = () => {
  if (!timer) timer = setTimeout(() => ((timer = null), scan()), 100)
}

function load() {
  chrome.storage.local.get(['topics', 'hideComments', 'paused'], (s) => {
    // Builds write progress notes into topics often; only rescan when what we match on changed.
    const topics = s.paused ? [] : (s.topics || []).filter((t) => t.enabled)
    const signature = JSON.stringify([s.hideComments, topics.map((t) => [t.name, t.keywords, t.subreddits])])
    if (signature === lastSignature) return
    lastSignature = signature
    compiled = Spoilit.compile(topics)
    hideComments = s.hideComments !== false
    ready = true
    reset()
  })
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.topics || changes.hideComments || changes.paused)) load()
})

// Capture phase so Reddit's own click handlers (open post, expand media) don't fire.
addEventListener(
  'click',
  (e) => {
    const covered = e
      .composedPath()
      .find((n) => n.classList?.contains('spoilit-hit') && !n.classList.contains('spoilit-revealed'))
    if (!covered) return
    e.preventDefault()
    e.stopImmediatePropagation()
    covered.classList.add('spoilit-revealed')
    reportCount()
  },
  true,
)

new MutationObserver(() => {
  scanNew()
  scheduleScan()
}).observe(document, { childList: true, subtree: true })
load()
