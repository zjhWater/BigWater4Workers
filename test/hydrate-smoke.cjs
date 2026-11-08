// 回归测试：重启后从宿主 JSON 读回状态——迷你形态、位置、当天进度都要回来
const fs = require('node:fs')
const path = require('node:path')
const { JSDOM } = require('jsdom')

const script = fs.readFileSync(path.join(__dirname, '..', 'assets', 'client.js'), 'utf8')

const saved = {
  settings: {
    interval: 30, workStart: '09:00', workEnd: '18:00', lunch: false,
    lunchStart: '12:00', lunchEnd: '13:30', sound: true, volume: 70,
    scale: 1, sizeVer: 2, uiFont: 32, waterOn: true, waterGoal: 8, showWork: true, mini: true,
  },
  pos: { h: null, hOff: 0, v: 'top', vOff: 210, left: 137, flip: false },
  miniPos: { left: 640, top: 700 },
  day: { dayKey: todayKey(), drinks: 3, waterMs: 0, workedMs: 3600 * 1000, fullSince: null },
}

function todayKey() {
  const d = new Date()
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate()
}

const dom = new JSDOM('<!doctype html><body><div id="app">dsh</div></body>', {
  url: 'http://127.0.0.1:3013/',
  pretendToBeVisual: true,
  runScripts: 'outside-only',
})
const { window } = dom
const errors = []
window.addEventListener('error', (e) => errors.push(String(e.message)))

// 假装宿主侧有存档
let gets = 0
window.fetch = () => {
  gets += 1
  return Promise.resolve({ status: 200, json: () => Promise.resolve(JSON.parse(JSON.stringify(saved))) })
}

window.eval(script)

const host = window.document.getElementById('dsh-stand-reminder')
const el = (id) => host.shadowRoot.getElementById(id)
const check = (label, ok) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + label); if (!ok) process.exitCode = 1 }

setTimeout(() => {
  check('拉过一次宿主存档', gets >= 1)
  check('读回迷你形态', host.hasAttribute('data-mini') && el('miniBar').hidden === false)
  check('读回存档坐标', window.__dshStandReminder.debug().pos.left === 137)
  window.__dshStandReminder.setMini(false)
  check('恢复完整挂件后位置按存档贴回', host.style.left === '137px' && host.style.top === '210px')
  check('杯排按存档位置摆好', el('miniBar').style.left === '640px' && el('miniBar').style.top === '700px')
  check('读回当天已喝杯数', el('miniCups').children.length === 8 && window.__dshStandReminder.state.drinks === 3)
  check('读回工作时长', window.__dshStandReminder.state.workedMs === 3600 * 1000)
  check('运行期没有未捕获错误', errors.length === 0)
  window.close()
}, 120)
