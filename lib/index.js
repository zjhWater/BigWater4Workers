// 宿主侧：只做三件事
//  1) 往页面注入一行内联 script（桌面端唯一可用的注入通道）
//  2) 注册 exact 路由，把 assets 里的静态资源发给页面（按 mtime 热读取）
//  3) 提供一个 JSON 小接口，让配置和位置能跨端口、跨重启保存
// 所有提醒逻辑都在浏览器里跑，不经过 agent，不消耗 token。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ASSETS = path.join(path.dirname(HERE), 'assets')
const CLIENT_FILE = path.join(ASSETS, 'client.js')
const ROUTE = '/dsh-stand-reminder/client.js'
const STATE_ROUTE = '/dsh-stand-reminder/state'
// 页面每次启动的端口都会变，localStorage 各端口互不相通，
// 所以配置和位置落到宿主侧的一个 JSON 文件里，跨端口、跨重启都能读到
const STATE_FILE = path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'dsh-stand-reminder.json')
const STATE_LIMIT = 256 * 1024

// 路由 → 本地文件
const FILES = new Map([[ROUTE, CLIENT_FILE]])
const MIME = 'application/javascript; charset=utf-8'

function readState(res) {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8')
    const body = Buffer.from(raw, 'utf8')
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': String(body.length) })
    res.end(body)
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      res.writeHead(204, { 'Cache-Control': 'no-store' })
      res.end()
      return
    }
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('read failed: ' + String((err && err.message) || err))
  }
}

function writeState(req, res) {
  const chunks = []
  let size = 0
  let aborted = false
  req.on('data', (chunk) => {
    if (aborted) return
    size += chunk.length
    if (size > STATE_LIMIT) {
      aborted = true
      res.writeHead(413, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('payload too large')
      return
    }
    chunks.push(chunk)
  })
  req.on('end', () => {
    if (aborted) return
    try {
      const text = Buffer.concat(chunks).toString('utf8')
      const data = JSON.parse(text)
      if (!data || typeof data !== 'object') throw new Error('state must be an object')
      fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true })
      const tmp = STATE_FILE + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
      fs.renameSync(tmp, STATE_FILE)
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end('{"ok":true}')
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('bad state: ' + String((err && err.message) || err))
    }
  })
}

// 按 mtime 缓存：改 assets 里的文件后硬刷新页面即可，不用重启客户端
const cache = new Map() // file -> { mtimeMs, source }

function loadAsset(file) {
  const stat = fs.statSync(file)
  const hit = cache.get(file)
  if (hit && hit.mtimeMs === stat.mtimeMs) return hit.source
  const source = fs.readFileSync(file, 'utf8')
  cache.set(file, { mtimeMs: stat.mtimeMs, source })
  return source
}

function serveAsset(req, res, file) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' })
    res.end()
    return
  }
  try {
    const body = Buffer.from(loadAsset(file), 'utf8')
    res.writeHead(200, {
      'Content-Type': MIME,
      'Cache-Control': 'no-store',
      'Content-Length': String(body.length),
    })
    res.end(req.method === 'HEAD' ? undefined : body)
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('stand-reminder asset unavailable: ' + String((err && err.message) || err))
  }
}

// 必须是内联 script 行，不能是 script-src 行：
// 桌面壳对 script-src 会 await 加载，失败会 reject __DSH_BOOT_READY__ 导致整个应用起不来。
// 这里自己建 script 并吞掉 onerror，路由不存在时静默失败，绝不影响宿主启动。
const ROW_TEXT =
  '(function(){try{' +
  'var d=document.body||document.documentElement;if(!d)return;' +
  'if(document.querySelector("script[data-dsh-stand-reminder]"))return;' +
  'var s=document.createElement("script");s.async=true;s.src="' + ROUTE + '";' +
  's.setAttribute("data-dsh-stand-reminder","1");s.onerror=function(){};' +
  'd.appendChild(s)}catch(e){}})()'

export default {
  name: 'stand-reminder',

  apply(root) {
    const disposers = []
    root.effect(() => () => {
      for (const dispose of disposers) {
        try { dispose() } catch {}
      }
    })

    // ① 注入行：apply 立刻执行，不等任何服务，避免错过宿主启动时的收集
    disposers.push(root.on('webserver/index-inject', (table) => {
      try {
        if (!Array.isArray(table)) return
        for (const row of table) {
          if (row && row.kind === 'script' && typeof row.text === 'string' && row.text.includes(ROUTE)) return
        }
        table.push({ kind: 'script', placement: 'body', text: ROW_TEXT })
      } catch {}
    }))

    // ② 静态资源 + 状态接口：等 webServer 就绪再注册
    root.inject(['webServer'], (ctx) => {
      for (const [route, file] of FILES) {
        const dispose = ctx.webServer.register({
          kind: 'exact',
          path: route,
          handler: (req, res) => serveAsset(req, res, file),
        })
        disposers.push(() => { try { dispose() } catch {} })
      }

      const disposeState = ctx.webServer.register({
        kind: 'exact',
        path: STATE_ROUTE,
        handler: (req, res) => {
          if (req.method === 'GET' || req.method === 'HEAD') return readState(res)
          if (req.method === 'PUT' || req.method === 'POST') return writeState(req, res)
          res.writeHead(405, { Allow: 'GET, HEAD, PUT, POST' })
          res.end()
        },
      })
      disposers.push(() => { try { disposeState() } catch {} })
    })
  },
}
