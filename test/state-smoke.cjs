// 宿主路由冒烟：用假 ctx 拿到 register 的 handler，跑一遍 GET/PUT 往返
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { Readable } = require('node:stream')

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dsr-state-'))
process.env.DSH_HOME = tmpHome
const stateFile = path.join(tmpHome, 'dsh-stand-reminder.json')

function fakeRes() {
  const res = { status: 0, headers: {}, body: '' }
  res.writeHead = (status, headers) => { res.status = status; Object.assign(res.headers, headers || {}) }
  res.end = (chunk) => { if (chunk) res.body += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk) }
  return res
}

function fakeReq(method, body) {
  const req = Readable.from(body ? [Buffer.from(body)] : [])
  req.method = method
  return req
}

function call(handler, method, body) {
  return new Promise((resolve) => {
    const res = fakeRes()
    res.end = ((orig) => (chunk) => { orig(chunk); resolve(res) })(res.end)
    handler(fakeReq(method, body), res)
  })
}

;(async () => {
  const plugin = (await import('file://' + path.join(__dirname, '..', 'lib', 'index.js').replace(/\\/g, '/'))).default
  const routes = new Map()
  const injects = []
  const root = {
    on: () => () => {},
    effect: (fn) => fn(),
    inject: (deps, cb) => cb({ webServer: { register: (route) => { routes.set(route.path, route.handler); return () => {} } } }),
  }
  plugin.apply(root)
  const handler = routes.get('/dsh-stand-reminder/state')
  const ok = (name, cond) => console.log((cond ? 'PASS  ' : 'FAIL  ') + name)

  ok('注册了 state 路由', typeof handler === 'function')

  const empty = await call(handler, 'GET')
  ok('空状态返回 204', empty.status === 204)

  const payload = JSON.stringify({ settings: { scale: 1.4, waterGoal: 10 }, pos: { h: 'left', hOff: 0, v: 'bottom', vOff: 120, flip: true } })
  const put = await call(handler, 'PUT', payload)
  ok('PUT 返回 200', put.status === 200 && put.body.includes('ok'))
  ok('文件已落盘', fs.existsSync(stateFile))

  const got = await call(handler, 'GET')
  const data = JSON.parse(got.body)
  ok('GET 返回 200', got.status === 200)
  ok('settings 往返一致', data.settings.scale === 1.4 && data.settings.waterGoal === 10)
  ok('pos 往返一致', data.pos.h === 'left' && data.pos.flip === true && data.pos.vOff === 120)

  const bad = await call(handler, 'PUT', '{oops')
  ok('坏 JSON 返回 400', bad.status === 400)

  const del = await call(handler, 'DELETE')
  ok('非法方法返回 405', del.status === 405)

  // 静态资源：client.js 能取到
  const asset = routes.get('/dsh-stand-reminder/client.js')
  const page = await call(asset, 'GET')
  ok('路由 /dsh-stand-reminder/client.js 可用', typeof asset === 'function' && page.status === 200 && page.body.includes('__dshStandReminder'))
  ok('三维资源已下线', !routes.has('/dsh-stand-reminder/scene3d.js') && !routes.has('/dsh-stand-reminder/three.js'))

  fs.rmSync(tmpHome, { recursive: true, force: true })
})()
