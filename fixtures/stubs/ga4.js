// Synthetic GA4 stub — mimics fingerprints (_ga cookie, beacon) without real vendor code.
// Sets cookies: _ga, _ga_FIXTURE
// Sends beacon to: /fixtures/stubs/collect (local sink — no real external request)
;(function () {
  var clientId = Math.random().toString(36).slice(2) + '.' + Date.now()
  var expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toUTCString()

  document.cookie = '_ga=GA1.2.' + clientId + '; expires=' + expires + '; path=/; SameSite=Lax'
  document.cookie =
    '_ga_FIXTURE=GS1.1.' +
    Date.now() +
    '.1.1.' +
    Date.now() +
    '.0.0.0; expires=' +
    expires +
    '; path=/; SameSite=Lax'

  navigator.sendBeacon(
    '/fixtures/stubs/collect',
    JSON.stringify({ v: '2', en: 'page_view', tid: 'G-FIXTURE000' }),
  )

  window.__ga4Ran = true
})()
