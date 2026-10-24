// The hosted demo's control strip: stands in for Spoilit's toolbar popup. It only writes to chrome.storage.local
// (the same keys the real popup writes) and reads the count the content script reports, so the extension's own
// scripts do all of the hiding.
(() => {
  const bar = document.getElementById('demo-controls')
  const topics = () => new Promise((resolve) => chrome.storage.local.get(['topics', 'paused', 'hideComments'], resolve))
  const set = (values) => chrome.storage.local.set(values)
  let shown = window.spoilitCount || 0

  const make = (tag, props = {}, ...kids) => {
    const node = document.createElement(tag)
    for (const [k, v] of Object.entries(props)) k in node ? (node[k] = v) : node.setAttribute(k, v)
    node.append(...kids)
    return node
  }

  async function render() {
    const s = await topics()
    const list = s.topics || []
    const chips = list.map((t) => {
      const chip = make('button', { type: 'button', className: 'chip', title: t.keywords.length ? `${t.keywords.length} terms` : 'Keyword only' }, t.name)
      chip.setAttribute('aria-pressed', String(t.enabled))
      chip.addEventListener('click', () => set({ topics: list.map((x) => (x === t ? { ...x, enabled: !x.enabled } : x)) }))
      return chip
    })

    const form = make('form', { className: 'add', autocomplete: 'off' })
    const input = make('input', { placeholder: 'Hide anything that says…', 'aria-label': 'Keyword to hide' })
    form.append(input, make('button', { type: 'submit' }, 'Add'))
    form.addEventListener('submit', (e) => {
      e.preventDefault()
      const name = input.value.trim()
      if (!name) return
      set({ topics: [{ id: String(Date.now()), name, qid: null, description: '', added: Date.now(), enabled: true, keywords: [], subreddits: [], state: 'ready', note: '' }, ...list] })
    })

    const pause = make('button', { type: 'button', className: 'pause' }, s.paused ? 'Paused' : 'On')
    pause.setAttribute('aria-pressed', String(!s.paused))
    pause.addEventListener('click', () => set({ paused: !s.paused }))

    const comments = make('label', { className: 'check' }, make('input', { type: 'checkbox', checked: s.hideComments !== false }), 'Hide comments')
    comments.querySelector('input').addEventListener('change', (e) => set({ hideComments: e.target.checked }))

    const counter = make('span', { id: 'demo-count', className: 'count' }, `${shown} hidden here`)
    bar.replaceChildren(make('div', { className: 'chips' }, ...chips), form, make('div', { className: 'side' }, comments, counter, pause))
  }

  chrome.storage.onChanged.addListener(render)
  addEventListener('spoilit-count', (e) => {
    shown = e.detail
    const out = document.getElementById('demo-count')
    if (out) out.textContent = `${shown} hidden here`
  })
  render()
})()
