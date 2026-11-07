// End-to-end test for /merge-csv-files: serve the site locally, drive headless Chrome over the
// DevTools protocol (no npm dependencies), upload 2 fixtures, merge, and check the downloaded CSV.
// Run: node --experimental-websocket tests/e2e-merge-tool.mjs   (Node 22+: no flag needed)
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..')
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Static server with the same clean URLs as Cloudflare (/merge-csv-files → merge-csv-files.html).
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  let file = path.join(ROOT, p)
  if (!path.extname(file)) file = fs.existsSync(file + '.html') ? file + '.html' : path.join(file, 'index.html')
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end() }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmerge-e2e-'))
const downloads = path.join(tmp, 'downloads'); fs.mkdirSync(downloads)
const port = 9400 + Math.floor(Math.random() * 400)
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(tmp, 'profile')}`,
  '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' })

let ws
try {
  let target
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(250)
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page') } catch {}
  }
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r))
  let id = 0; const waiters = {}
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && waiters[m.id]) waiters[m.id](m) })
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; waiters[i] = r; ws.send(JSON.stringify({ id: i, method, params })) })
  const js = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails))
    return r.result?.result?.value
  }
  const until = async (expr, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await js(expr)) return; await sleep(100) } throw new Error('timeout: ' + expr) }

  await send('Network.enable')
  await send('Network.setBlockedURLs', { urls: ['*googletagmanager.com*', '*google-analytics.com*', '*doubleclick.net*'] })
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads })
  await send('Page.enable'); await send('DOM.enable')
  await send('Page.navigate', { url: `${base}/merge-csv-files` })
  await until(`document.readyState === 'complete' && !!window.KramataMerge`)
  assert.equal(await js(`!!window.Papa`), false, 'Papa Parse must not load before files are added')

  // gtag.js is deferred on this page: absent until the visitor interacts, then loaded.
  const gtagTag = `!!document.querySelector('script[src*="googletagmanager.com/gtag/js"]')`
  assert.equal(await js(gtagTag), false, 'gtag.js must not load before interaction')
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 200, y: 300 })
  await until(gtagTag, 3000)

  const doc = await send('DOM.getDocument')
  const { result: { nodeId } } = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '#mt-input' })
  await send('DOM.setFileInputFiles', { nodeId, files: [path.join(ROOT, 'tests/fixtures/sets-a.csv'), path.join(ROOT, 'tests/fixtures/sets-b.csv')] })
  await until(`document.querySelectorAll('#mt-list .mt-name').length === 2`)
  await js(`document.getElementById('mt-source').click()`)
  await js(`document.getElementById('mt-go').click()`)
  await until(`!!document.getElementById('mt-download')`)

  const summary = await js(`document.getElementById('mt-result').innerText`)
  assert.match(summary, /2\s*Files merged/)
  assert.match(summary, /2\s*Rows/)
  assert.match(summary, /sets-a\.csv.*no “Email”/)
  assert.match(summary, /sets-b\.csv.*no “Region”/)
  assert.equal(await js(`!!window.Papa`), true, 'Papa Parse loads once files are added')

  const events = await js(`JSON.stringify(dataLayer.filter(a => a[0] === 'event' && a[1] === 'tool_merge_complete').map(a => a[2]))`)
  assert.deepEqual(JSON.parse(events), [{ file_count: 2, row_bucket: '<1k', options_used: 'source_column' }])
  assert.doesNotMatch(events, /sets-|Name|Region|Email|Alice/, 'analytics must not carry file names or content')

  await js(`document.getElementById('mt-download').click()`)
  const out = path.join(downloads, 'merged.csv')
  for (let i = 0; i < 50 && !fs.existsSync(out); i++) await sleep(100)
  const bytes = fs.readFileSync(out)
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 BOM')
  assert.equal(bytes.subarray(3).toString('utf8'),
    'Name,Region,Email,Source file\r\nAlice,North,,sets-a.csv\r\nBob,,bob@example.com,sets-b.csv\r\n')

  // The result-panel upsell fires download_click with the agreed parameters (navigation stopped).
  const click = await js(`(() => { let got; const orig = window.gtag; window.gtag = (...a) => { if (a[1] === 'download_click') got = a[2]; };
    const a = document.querySelector('[data-pos="merge_tool_result"]'); a.addEventListener('click', e => e.preventDefault(), { once: true });
    a.click(); window.gtag = orig; return got })()`)
  assert.deepEqual({ page: click.page, position: click.position, link_type: click.link_type },
    { page: '/merge-csv-files', position: 'merge_tool_result', link_type: 'store' })

  console.log('e2e: PASS (2 files merged, download verified, analytics payload clean)')
} catch (e) {
  console.error('e2e: FAIL', e); process.exitCode = 1
} finally {
  try { ws?.close() } catch {}
  chrome.kill(); server.close()
  await sleep(500); try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
}
