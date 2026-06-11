// Synthetic same-origin/first-party app script — should NEVER be held by auto-block.
// Sets a detectable global flag so E2E tests can assert it runs immediately.
;(function () {
  window.__sameOriginRan = true
})()
