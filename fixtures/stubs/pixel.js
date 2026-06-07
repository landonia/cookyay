// Synthetic Meta Pixel stub — mimics fingerprints (_fbp cookie) without real vendor code.
// Sets cookies: _fbp
// Fires beacon to: /fixtures/stubs/collect (local sink — no real external request)
;(function () {
  var expires = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toUTCString()
  var fbp = 'fb.1.' + Date.now() + '.' + Math.floor(Math.random() * 1e10)

  document.cookie = '_fbp=' + fbp + '; expires=' + expires + '; path=/; SameSite=Lax'

  navigator.sendBeacon(
    '/fixtures/stubs/collect',
    JSON.stringify({ ev: 'PageView', pixel_id: 'FIXTURE000' }),
  )

  window.__pixelRan = true
})()
