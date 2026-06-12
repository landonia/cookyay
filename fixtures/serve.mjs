#!/usr/bin/env node
/**
 * Tiny hermetic static file server for the Cookyay fixture site.
 *
 * Serves from the workspace root so that both /fixtures/** and
 * /packages/cookyay/dist/** resolve correctly with a single origin.
 *
 * Also provides a synthetic beacon sink at POST /fixtures/stubs/collect
 * so stub scripts can fire navigator.sendBeacon() without external network
 * calls and without browser console errors.
 *
 * Usage: node fixtures/serve.mjs [port]
 * Default port: 4000
 */

import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
// Workspace root = one directory above fixtures/
const WORKSPACE_ROOT = resolve(__dirname, '..')

const PORT = parseInt(process.argv[2] ?? process.env.PORT ?? '4000', 10)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map':  'application/json; charset=utf-8',
  '.ts':   'application/typescript; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.txt':  'text/plain; charset=utf-8',
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const pathname = url.pathname

  // Beacon sink — POST /fixtures/stubs/collect
  // Returns 204 No Content so stubs can fire sendBeacon() hermetically.
  if (req.method === 'POST' && pathname === '/fixtures/stubs/collect') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*' })
    res.end()
    return
  }

  // Transport test sink — POST /fixtures/transport/collect
  // Returns 204 No Content so transport fixture pages can fire same-origin
  // fetch()/sendBeacon() calls without external network access.
  // [task 005 research/test-strategist.md §F5 — optional server-side counter endpoint]
  if (req.method === 'POST' && pathname === '/fixtures/transport/collect') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*' })
    res.end()
    return
  }

  // CORS preflight for the beacon sink
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    })
    res.end()
    return
  }

  // Resolve the request path to a file under WORKSPACE_ROOT
  let filePath = join(WORKSPACE_ROOT, pathname)

  // Default to index.html for directory requests
  if (pathname.endsWith('/') || pathname === '') {
    filePath = join(filePath, 'index.html')
  }

  // Prevent path traversal outside the workspace root
  if (!filePath.startsWith(WORKSPACE_ROOT)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' })
    res.end('403 Forbidden')
    return
  }

  try {
    const data = await readFile(filePath)
    const ext = extname(filePath).toLowerCase()
    const contentType = MIME[ext] ?? 'application/octet-stream'

    res.writeHead(200, {
      'Content-Type': contentType,
      // No-cache in dev — avoids stale fixture HTML during test iteration
      'Cache-Control': 'no-store',
    })
    res.end(data)
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EISDIR') {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end(`404 Not Found: ${pathname}`)
    } else {
      res.writeHead(500, { 'Content-Type': 'text/plain' })
      res.end(`500 Internal Server Error: ${err.message}`)
    }
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Fixture server listening at http://127.0.0.1:${PORT}`)
  console.log(`  Entry:   http://127.0.0.1:${PORT}/fixtures/index.html`)
  console.log(`  All:     http://127.0.0.1:${PORT}/fixtures/blocking/all.html`)
  console.log('Press Ctrl+C to stop.')
})
