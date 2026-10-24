const $ = (sel) => document.querySelector(sel)

let topics = []

function runTest() {
  const text = $('#test').value
  const out = $('#test-result')
  if (!text.trim()) return (out.textContent = '')
  const hit = Spoilit.match(Spoilit.compile(topics), text, '')
  out.textContent = hit ? `Hidden: ${hit.topic.name} (matched "${hit.term}")` : 'Not hidden'
}

$('#test').addEventListener('input', runTest)
$('#hide-comments').addEventListener('change', (e) => chrome.storage.local.set({ hideComments: e.target.checked }))
$('#web-search').addEventListener('change', (e) => chrome.storage.local.set({ webSearch: e.target.checked }))
$('#api-key').addEventListener('input', (e) => chrome.storage.local.set({ apiKey: e.target.value.trim() }))

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.topics) {
    topics = changes.topics.newValue || []
    runTest()
  }
})

chrome.storage.local.get(['topics', 'apiKey', 'hideComments', 'webSearch'], (s) => {
  topics = s.topics || []
  $('#hide-comments').checked = s.hideComments !== false
  $('#web-search').checked = s.webSearch !== false
  $('#api-key').value = s.apiKey || ''
})
