// 前端：像素小人 + 久坐提醒状态机
// 全部跑在浏览器里：不联网、不写文件、不碰会话数据、不消耗 token。
// 样式挂在 Shadow DOM 里，和页面主题、其他挂件互不影响。
(function () {
  'use strict'

  // 同一个页面只跑一份（热刷新、重复注入都安全）
  if (window.__DSH_STAND_REMINDER__) return
  window.__DSH_STAND_REMINDER__ = true

  var STORAGE_KEY = 'dsh-stand-reminder:v1'
  // 端口每次启动都可能变，localStorage 不跨端口，所以配置和位置同步到宿主侧的 JSON 文件
  var STATE_URL = '/dsh-stand-reminder/state'
  var RETRY_MS = 10 * 60 * 1000       // 卡片无人响应：10 分钟后再提醒
  var SNOOZE_MS = 5 * 60 * 1000       // 点「5 分钟后再提醒」
  var AUTO_HIDE_MS = 60 * 1000        // 卡片 60 秒后自动收起
  var EDGE_GUARD_MS = 10 * 60 * 1000  // 午休结束前 / 下班前 10 分钟不再触发
  var GRACE_MS = 5 * 60 * 1000        // 休眠/关页面错过太久就安静顺延，不补弹
  var TICK_MS = 15 * 1000

  var DEFAULTS = {
    interval: 30,
    workStart: '09:00',
    workEnd: '18:00',
    lunch: true,
    lunchStart: '12:00',
    lunchEnd: '13:30',
    sound: true,
    volume: 70,        // 提示音量（0–100），映射到 0–0.9 的增益
    scale: 1,        // 在 --base（随窗口算出的基准尺寸）上再乘的倍数
    sizeVer: 2,      // 尺寸方案版本：2 = 基准尺寸跟随窗口，旧数据的 scale 不再沿用
    uiFont: 32,          // 时间字号，只影响画面，不影响设置面板
    waterOn: true,
    waterGoal: 8,        // 每天目标杯数（默认 8，可改）
    showWork: true,
    mini: false,         // 最小化到输入框底部的杯排
    lang: 'auto'         // 界面语言：auto = 跟随 Harness/浏览器语言，另可强制 zh / en
  }

  // ---------- 文案（中英双语） ----------
  // 所有界面上看得见的字都在这里；带函数的几项是「带参数」的句子
  var TEXT = {
    zh: {
      tagSettings: '设置',
      close: '关闭',
      lang: '语言',
      langAuto: '跟随系统',
      statWork: '今日工作',
      interval: '提醒间隔',
      unitMinute: '分钟',
      workHours: '工作时段',
      lunch: '午休',
      sound: '提示音',
      volume: '提示音量',
      waterOn: '喝水提醒',
      unitCup: '杯',
      workRecord: '工作记录',
      workRecordAuto: '自动累计开机时长',
      size: '画面大小',
      fontSize: '时间字号',
      testNow: '立即测试',
      resume: '恢复提醒',
      guide: '参考《中国居民膳食指南（2022）》：成年男性每天饮水 1700ml、女性 1500ml。',
      cardTitle: '站起来活动活动，喝点水',
      ack: '我站起来了！',
      snooze: '再过 5 分钟',
      pauseToday: '不再提醒',
      miniCollapse: '收起到输入框',
      settings: '设置',
      petLabel: '久坐提醒',
      pcLabel: '开机关机',
      chairLabel: '回来工作',
      cupLabel: '喝一杯',
      badgeLabel: '下次提醒',
      miniExpand: '展开挂件',
      badgeWork: '工作',
      badgeLeave: '离开',
      badgeOff: '收工',
      titleAway: '离开中 · 点椅子回来',
      titleOffWork: '今天已收工 · 点电脑重新开机',
      titleOff: '点一下显示器开始今天的工作',
      titlePaused: function (c) { return '今天不再提醒，' + c + ' 恢复' },
      titleRest: function (c) { return '不在工作时段，' + (c ? '下次提醒 ' + c : '时段内才会提醒') },
      titleNext: function (c) { return '下次提醒 ' + c + ' · 点小人离开，点电脑关机' },
      titleIdle: '点小人离开 · 点电脑关机',
      hintAway: '已离开电脑，点椅子回来继续工作',
      hintOffWork: '今天已收工，点电脑可以重新开机',
      hintOff: '点一下画面里的显示器，开始今天的工作',
      hintPaused: function (c) { return '已暂停，' + c + ' 自动恢复' },
      hintRest: '当前不在工作时段，时段内才会提醒',
      hintNext: function (c) { return '下次提醒 ' + c },
      waterNote: function (n) { return '约 ' + n + ' 分钟一杯（人在电脑前就蓄水）' },
      durHM: function (h, m) { return h + ' 小时 ' + m + ' 分' },
      durMin: function (m) { return m + ' 分钟' },
      cupN: function (i) { return '第 ' + i + ' 杯水' }
    },
    en: {
      tagSettings: 'Settings',
      close: 'Close',
      lang: 'Language',
      langAuto: 'Follow system',
      statWork: 'Worked',
      interval: 'Remind every',
      unitMinute: 'min',
      workHours: 'Work hours',
      lunch: 'Lunch',
      sound: 'Sound',
      volume: 'Volume',
      waterOn: 'Water',
      unitCup: 'cups',
      workRecord: 'Work log',
      workRecordAuto: 'time at the desk',
      size: 'Size',
      fontSize: 'Clock size',
      testNow: 'Test now',
      resume: 'Resume',
      guide: 'Reference: Chinese Dietary Guidelines (2022) — 1700 ml a day for adult men, 1500 ml for adult women.',
      cardTitle: 'Time to stand up and drink some water',
      ack: 'I stood up!',
      snooze: 'In 5 minutes',
      pauseToday: 'Not today',
      miniCollapse: 'Collapse to composer',
      settings: 'Settings',
      petLabel: 'Stand-up reminder',
      pcLabel: 'Power',
      chairLabel: 'Back to work',
      cupLabel: 'Drink a cup',
      badgeLabel: 'Next',
      miniExpand: 'Expand widget',
      badgeWork: 'Working',
      badgeLeave: 'Away',
      badgeOff: 'Off',
      titleAway: 'Away — click the chair to come back',
      titleOffWork: 'Done for today — click the monitor to start again',
      titleOff: 'Click the monitor to start your day',
      titlePaused: function (c) { return 'Paused until ' + c },
      titleRest: function (c) { return (c ? 'Outside work hours — next reminder ' + c : 'Outside work hours') },
      titleNext: function (c) { return 'Next reminder ' + c + ' · click the worker to leave, the monitor to shut down' },
      titleIdle: 'Click the worker to leave · click the monitor to shut down',
      hintAway: 'Away from the desk — click the chair to come back',
      hintOffWork: 'Done for today — click the monitor to start again',
      hintOff: 'Click the monitor in the scene to start your day',
      hintPaused: function (c) { return 'Paused, resumes at ' + c },
      hintRest: 'Outside work hours — reminders only run inside them',
      hintNext: function (c) { return 'Next reminder ' + c },
      waterNote: function (n) { return 'About one cup every ' + n + ' min while you are at the desk' },
      durHM: function (h, m) { return h + 'h ' + m + 'm' },
      durMin: function (m) { return m + ' min' },
      cupN: function (i) { return 'Cup ' + i }
    }
  }

  function langTag() {
    var l = state.settings.lang
    if (l === 'zh' || l === 'en') return l
    var n = String((typeof navigator !== 'undefined' && navigator.language) || 'en').toLowerCase()
    return n.indexOf('zh') === 0 ? 'zh' : 'en'
  }

  function t(key) {
    var dict = TEXT[langTag()] || TEXT.zh
    return dict[key] !== undefined ? dict[key] : TEXT.zh[key]
  }

  var state = {
    settings: Object.assign({}, DEFAULTS),
    nextDueAt: null,
    pausedUntil: null,
    away: false,
    pcOn: false,        // 电脑是否开机（开机才开始计时和提醒）
    offWork: false,     // 今天是否已经手动收工
    waterMs: 0,        // 当前这一杯的蓄水时长
    drinks: 0,         // 今天已喝几杯
    fullSince: null,   // 当前杯蓄满的时刻（满了之后开始变大）
    chimeCup: -1,      // 已经为哪一杯响过提示音
    workedMs: 0,
    dayKey: '',
    // 位置用锚点保存：h='left'/'right' 贴边（hOff 为离边距离），h=null 用 left 自由摆放；
    // v 目前只有 'bottom'（顶部不吸附），vOff 为离底距离
    pos: { h: 'right', hOff: 28, v: 'bottom', vOff: 300, left: 0, flip: false },
    // 迷你杯排被拖走后记住绝对坐标；null 表示跟随输入框
    miniPos: null
  }

  // ---------- 持久化 ----------

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      var saved = JSON.parse(raw)
      if (!saved || typeof saved !== 'object') return
      if (saved.settings && typeof saved.settings === 'object') {
        Object.keys(DEFAULTS).forEach(function (key) {
          var value = saved.settings[key]
          if (typeof value === typeof DEFAULTS[key]) {
            state.settings[key] = value
          }
        })
      }
      // 旧的固定 140px 方案下存的 scale 没有意义，直接回到 100%
      if (saved.settings && saved.settings.sizeVer !== 2) state.settings.scale = 1
      if (typeof saved.nextDueAt === 'number') state.nextDueAt = saved.nextDueAt
      if (typeof saved.pausedUntil === 'number') state.pausedUntil = saved.pausedUntil
      if (typeof saved.away === 'boolean') state.away = saved.away
      if (typeof saved.pcOn === 'boolean') state.pcOn = saved.pcOn
      if (typeof saved.offWork === 'boolean') state.offWork = saved.offWork
      if (typeof saved.waterMs === 'number') state.waterMs = saved.waterMs
      if (typeof saved.drinks === 'number') state.drinks = Math.max(0, saved.drinks)
    if (typeof saved.fullSince === 'number') state.fullSince = saved.fullSince
    if (typeof saved.chimeCup === 'number') state.chimeCup = saved.chimeCup
      if (typeof saved.workedMs === 'number') state.workedMs = saved.workedMs
      if (typeof saved.dayKey === 'string') state.dayKey = saved.dayKey
      if (saved.miniPos && typeof saved.miniPos.left === 'number' && typeof saved.miniPos.top === 'number') state.miniPos = { left: saved.miniPos.left, top: saved.miniPos.top }
      if (saved.pos && typeof saved.pos === 'object') {
        var p = saved.pos
        if (typeof p.hOff === 'number' || p.h === null) {
          state.pos = {
            h: p.h === 'left' || p.h === 'right' ? p.h : null,
            hOff: typeof p.hOff === 'number' ? p.hOff : 28,
            v: p.v === 'top' ? 'top' : 'bottom',
            vOff: typeof p.vOff === 'number' ? p.vOff : 300,
            left: typeof p.left === 'number' ? p.left : 0,
            flip: !!p.flip
          }
        } else if (typeof p.right === 'number' && typeof p.bottom === 'number') {
          // 旧版本存的是 { right, bottom }，换算成右/底锚点
          state.pos = { h: 'right', hOff: p.right, v: 'bottom', vOff: p.bottom, left: 0, flip: false }
        }
      }
    } catch (err) {}
  }

  // ---------- 跨启动持久化（宿主侧 JSON） ----------

  var pushTimer = null
  var sipTimer = null       // 举杯动画的收尾定时器
  var hydrating = false   // hydrate 期间不要用「当前屏幕位置」反推存档坐标
  var hydrated = false    // 拉完存档（或确认没有）之后才允许回写，避免默认位置覆盖存档

  // 真正发请求；keepalive 让关闭页面前的最后一笔也能发出去
  function flushState() {
    try {
      var payload = JSON.stringify({
        settings: state.settings,
        pos: state.pos,
        miniPos: state.miniPos,
        // 当天的进度也跟着走：换端口/重启不该把喝了多少杯、坐了多久清掉
        day: {
          dayKey: state.dayKey,
          drinks: state.drinks,
          waterMs: state.waterMs,
          workedMs: state.workedMs,
          fullSince: state.fullSince
        }
      })
      fetch(STATE_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true
      }).catch(function () {})
    } catch (err) {}
  }

  function pushState() {
    if (pushTimer) clearTimeout(pushTimer)
    pushTimer = setTimeout(function () {
      pushTimer = null
      flushState()
    }, 400)
  }

  function mergeRemote(data) {
    if (!data || typeof data !== 'object') return false
    var s = data.settings
    if (s && typeof s === 'object') {
      Object.keys(DEFAULTS).forEach(function (key) {
        if (typeof s[key] === typeof DEFAULTS[key]) state.settings[key] = s[key]
      })
    }
    var mp = data.miniPos
    if (mp && typeof mp === 'object' && typeof mp.left === 'number' && typeof mp.top === 'number') {
      state.miniPos = { left: mp.left, top: mp.top }
    }
    var d = data.day
    if (d && d.dayKey === dayKeyOf(Date.now())) {
      state.dayKey = d.dayKey
      if (typeof d.drinks === 'number') state.drinks = d.drinks
      if (typeof d.waterMs === 'number') state.waterMs = d.waterMs
      if (typeof d.workedMs === 'number') state.workedMs = d.workedMs
      state.fullSince = typeof d.fullSince === 'number' ? d.fullSince : null
    }
    var p = data.pos
    if (p && typeof p === 'object' && (typeof p.hOff === 'number' || p.h === null)) {
      state.pos = {
        h: p.h === 'left' || p.h === 'right' ? p.h : null,
        hOff: typeof p.hOff === 'number' ? p.hOff : 28,
        v: p.v === 'top' ? 'top' : 'bottom',
        vOff: typeof p.vOff === 'number' ? p.vOff : 300,
        left: typeof p.left === 'number' ? p.left : 0,
        flip: !!p.flip
      }
      return true
    }
    return true
  }

  // 页面加载后拉一次：远端有值就以远端为准（跨端口/跨重启保持一致）
  function hydrate(attempt) {
    attempt = attempt || 0
    try {
      fetch(STATE_URL, { cache: 'no-store' }).then(function (res) {
        // 204 = 还没存过，正常；其它非 200 当成「宿主路由还没就绪」，退避重试
        if (res.status === 204) return null
        if (res.status !== 200) throw new Error('state ' + res.status)
        return res.json()
      }).then(function (data) {
        hydrated = true
        if (!data || !mergeRemote(data)) return
        // 先按存档摆好位置再改尺寸：否则 applyScale 会用默认位置反推 left，位置就漂了
        hydrating = true
        applyFont()
        applyPos()
        applyScale()
        applyPos()
        hydrating = false
        applyLang()
        fillForm()
        paintCup()
        renderStats()
        syncPc()
        renderBadge(Date.now())
        // 存档说上次是迷你形态：把 DOM 切过去（否则会停在完整挂件，看着像位置被重置）
        if (miniOn()) {
          host.setAttribute('data-mini', '')
          miniBar.hidden = false
          ensureCups(cupsPerDay())
        } else {
          host.removeAttribute('data-mini')
          miniBar.hidden = true
        }
        positionMiniBar()
        renderMini(Date.now())
      }).catch(function () {
        if (attempt < 3) { setTimeout(function () { hydrate(attempt + 1) }, 500 * (attempt + 1)); return }
        hydrated = true
      })
    } catch (err) { hydrated = true }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        settings: state.settings,
        nextDueAt: state.nextDueAt,
        pausedUntil: state.pausedUntil,
        away: state.away,
        pcOn: state.pcOn,
        offWork: state.offWork,
        waterMs: state.waterMs,
        drinks: state.drinks,
        fullSince: state.fullSince,
        chimeCup: state.chimeCup,
        workedMs: state.workedMs,
        dayKey: state.dayKey,
        pos: state.pos,
        miniPos: state.miniPos
      }))
      if (hydrated) pushState() // 同步到宿主侧 JSON，跨端口/跨重启
    } catch (err) {}
  }

  // ---------- 时间计算 ----------

  function toMin(hhmm, fallback) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''))
    if (!m) return fallback
    var value = Number(m[1]) * 60 + Number(m[2])
    return value >= 0 && value <= 1439 ? value : fallback
  }

  function clampInt(value, min, max, fallback) {
    var n = Number(value)
    if (!isFinite(n)) return fallback
    n = Math.round(n)
    return Math.min(max, Math.max(min, n))
  }

  function minutesOfDay(ts) {
    var d = new Date(ts)
    return d.getHours() * 60 + d.getMinutes()
  }

  function startOfDay(ts) {
    var d = new Date(ts)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }

  function clockText(ts) {
    var d = new Date(ts)
    var hh = String(d.getHours()).padStart(2, '0')
    var mm = String(d.getMinutes()).padStart(2, '0')
    return hh + ':' + mm
  }

  function intervalMin() {
    return clampInt(state.settings.interval, 5, 180, 30)
  }

  function windowRange() {
    return {
      ws: toMin(state.settings.workStart, 540),
      we: toMin(state.settings.workEnd, 1080),
      ls: toMin(state.settings.lunchStart, 720),
      le: toMin(state.settings.lunchEnd, 810)
    }
  }

  function inWorkWindow(ts) {
    var w = windowRange()
    var m = minutesOfDay(ts)
    if (m < w.ws || m >= w.we) return false
    if (state.settings.lunch && m >= w.ls && m < w.le) return false
    return true
  }



  // 下班前 10 分钟不再触发（避免刚站起来就到点下班）
  function isNearWindowEnd(ts) {
    var w = windowRange()
    return minutesOfDay(ts) >= w.we - EDGE_GUARD_MS / 60000
  }

  // 把「该提醒的时刻」挪到下一个合法位置：跳过午休、跳过非工作时段、跳下班前 10 分钟
  function adjustDue(ts) {
    var w = windowRange()
    var guard = EDGE_GUARD_MS / 60000
    for (var i = 0; i < 6; i++) {
      var day = startOfDay(ts)
      var m = minutesOfDay(ts)
      if (m < w.ws) { ts = day + (w.ws + intervalMin()) * 60000; continue }
      if (state.settings.lunch && m >= w.ls && m < w.le) { ts = day + (w.le + intervalMin()) * 60000; continue }
      if (m >= w.we - guard) { ts = startOfDay(day + 86400000) + (w.ws + intervalMin()) * 60000; continue }
      return ts
    }
    return ts
  }

  function nextWorkStart(ts) {
    var ws = toMin(state.settings.workStart, 540)
    if (minutesOfDay(ts) < ws) return startOfDay(ts) + ws * 60000
    return startOfDay(ts + 86400000) + ws * 60000
  }

  // ---------- 提示音 ----------

  var audio = null

  function unlockAudio() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext
      if (!Ctx) return
      if (!audio) audio = new Ctx()
      if (audio.state === 'suspended') audio.resume()
    } catch (err) {}
  }

  function volumePct() {
    return clampInt(state.settings.volume, 0, 100, 70)
  }

  function playChime() {
    if (!state.settings.sound) return
    if (volumePct() <= 0) return
    unlockAudio()
    if (!audio || audio.state !== 'running') return
    try {
      var t0 = audio.currentTime
      var peak = Math.max(0.02, 0.9 * volumePct() / 100)
      ;[880, 660].forEach(function (freq, i) {
        var at = t0 + i * 0.17
        var osc = audio.createOscillator()
        var gain = audio.createGain()
        osc.type = 'triangle'
        osc.frequency.value = freq
        gain.gain.setValueAtTime(0.0001, at)
        gain.gain.exponentialRampToValueAtTime(peak, at + 0.012)
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.24)
        osc.connect(gain)
        gain.connect(audio.destination)
        osc.start(at)
        osc.stop(at + 0.26)
      })
    } catch (err) {}
  }

  // ---------- 界面 ----------

  var TEMPLATE = [
    '<style>',
    ':host{all:initial;display:block;position:fixed;z-index:2147481500;right:28px;bottom:300px;--scale:1;--ui:32px;--base:clamp(160px,min(100vw,100vh) * .26,320px);',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",system-ui,sans-serif;',
    'font-size:15px;line-height:1.5;color:#1f2430;-webkit-font-smoothing:antialiased;-webkit-tap-highlight-color:transparent}',
    // 只有小人参与布局；卡片、面板绝对定位，开关时不会改变挂件盒子大小，位置就不会漂移
    '.stack{position:relative;display:flex;flex-direction:column;align-items:flex-end}',
    // 缩放只作用在舞台（像素场景）上；卡片、面板、角标都是固定尺寸
    '.stage{display:block;line-height:0;transform-origin:center bottom;transition:transform .25s ease}',
    ':host([data-flip]) .stage{transform:scaleX(-1)}',
    // 三维画布不接收指针：拖动/点击仍然交给挂件本身，相机保持固定
    '[hidden]{display:none!important}',
    '.card,.panel{position:absolute;right:0;bottom:calc(100% + 10px);width:340px;box-sizing:border-box;background:#fff;',
    'border:1px solid #e6e8f0;border-radius:14px;font-family:var(--hfont,inherit);font-size:var(--hsize,14px);',
    'line-height:1.6;box-shadow:0 10px 30px rgba(24,32,55,.14),0 2px 6px rgba(24,32,55,.06);padding:14px 16px 12px}',
    '.panel{max-height:calc(100vh - 32px);overflow:auto}',
    '@keyframes cardIn{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}',
    '.card.show{animation:cardIn .18s ease-out}',
    '.card-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}',
    '.tag{font-size:calc(var(--hsize,14px) * .86);letter-spacing:.08em;color:#7b8496;background:#f2f4f9;border-radius:6px;padding:2px 7px}',
    '.icon{border:0;background:transparent;color:#98a2b3;font-size:15px;line-height:1;cursor:pointer;padding:2px 5px;border-radius:6px}',
    '.icon:hover{background:#f2f4f9;color:#4b5563}',
    'h2{font-size:calc(var(--hsize,14px) * 1.2);margin:2px 0 4px;font-weight:600;letter-spacing:.02em}',
    'p{margin:0;color:#5b6478}',
    '.row{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}',
    '.row.actions{gap:7px;margin-top:14px;flex-wrap:nowrap}',
    '.row.actions button{flex:1 1 0;min-width:0;padding:9px 4px;font-size:calc(var(--hsize,14px) * .95);white-space:nowrap}',
    'button{font:inherit;cursor:pointer;border-radius:9px;padding:8px 13px;border:1px solid transparent;',
    'transition:background .12s ease}',
    '.primary{background:#4f7fe0;color:#fff;font-weight:600}',
    '.primary:hover{background:#446fca}',
    '.ghost{background:#f5f7fb;color:#3d475b;border-color:#e3e7f0}',
    '.ghost:hover{background:#eceff7}',
    '.links{gap:14px;margin-top:8px}',
    '.link{border:0;background:transparent;color:#7b8496;padding:2px 0;font-size:calc(var(--hsize,14px) * .93)}',
    '.link:hover{color:#4f7fe0}',
    '.field{display:flex;align-items:center;gap:8px;margin:8px 0;color:#4b5563;font-size:calc(var(--hsize,14px) * .93)}',
    '.field>span{width:66px;flex:none;color:#7b8496}',
    ':host([lang="en"]) .field>span{width:88px}',
    ':host([lang="en"]) .field{font-size:calc(var(--hsize,14px) * .88)}',
    '.field b{color:#b6bdcb;font-weight:400}',
    '.field em{font-style:normal;color:#98a2b3;font-size:calc(var(--hsize,14px) * .86)}',
    '.field input[type=number]{width:60px}',
    '.field input[type=time]{width:88px}',
    '.field input[type=range]{width:100px;accent-color:#4f7fe0}',
    '.field input,.field select{padding:3px 6px;border:1px solid #e3e7f0;border-radius:7px;font:inherit;font-size:inherit;background:#fbfcfe;color:#1f2430}',
    '.field select{padding-right:2px;cursor:pointer}',
    '.field input[type=checkbox]{width:15px;height:15px;accent-color:#4f7fe0}',
    '.scaleval{width:42px;text-align:right;color:#98a2b3;font-variant-numeric:tabular-nums}',
    '.hint{margin-top:10px;font-size:calc(var(--hsize,14px) * .86);color:#98a2b3}',
    '.pet{position:relative;display:flex;flex-direction:column;align-items:center;gap:4px;margin:0;padding:4px 6px 2px;',
    'border:0;border-radius:12px;background:transparent;cursor:grab;user-select:none;touch-action:none;',
    '-webkit-tap-highlight-color:transparent}',
    '.pet:active{cursor:grabbing}',
    '.pet:focus,.pet:focus-visible{outline:none}',
    // 小鲸鱼同款菜单按钮：悬停挂件才出现
    '.menu{position:absolute;right:2px;top:max(0px,calc(109px * var(--scale) * .25 - 30px));width:26px;height:26px;padding:0;border:0;border-radius:8px;',
    'background:#3d4b6d;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;cursor:pointer;',
    'opacity:0;transform:translateY(4px);pointer-events:none;transition:opacity .14s ease,transform .14s ease;',
    'box-shadow:0 3px 10px rgba(24,32,55,.25);z-index:2}',
    '.menu span{display:block;width:12px;height:2px;border-radius:1px;background:#fff}',
    '.menu:hover{background:#4a5a80}',
    '.menu:focus-visible{opacity:1;transform:none;pointer-events:auto}',
    ':host(:hover) .menu{opacity:1;transform:none;pointer-events:auto}',
    ':host([data-open]) .menu{opacity:0;pointer-events:none}',
    // 最小化按钮：样式与设置按钮一致，压在它左边
    '.menu.mini{right:32px}',
    // 迷你模式：挂件整体让位，只剩输入框底部的杯排
    ':host([data-mini]) .pet,:host([data-mini]) .chips,:host([data-mini]) .menu{display:none}',
    // 输入框底部的杯排（fixed 覆盖层，本身不吃鼠标事件，只有杯子吃）
    '.minibar{position:fixed;right:14px;bottom:14px;display:flex;align-items:flex-end;gap:6px;pointer-events:auto;cursor:grab;',
    'user-select:none;-webkit-user-select:none;z-index:2147483000}',
    '.minibar[hidden]{display:none}',
    '.minibar.dragging{cursor:grabbing}',
    '.minicup{pointer-events:auto;width:22px;height:26px;padding:0;border:0;background:none;cursor:pointer;',
    'transform-origin:50% 100%;transition:opacity .3s ease}',
    '.minicup svg{display:block;width:100%;height:100%;overflow:visible}',
    '.minicups{display:flex;align-items:flex-end;gap:6px}',
    '.minicup .mwater{transform-box:fill-box;transform-origin:center bottom;transition:transform .6s linear}',
    '.minicup .mglass{fill:#e8f5fd;stroke:#b9c3d6;stroke-width:1.1}',
    '.minicup .mwater{fill:#4aa3e0}',
    '.minicup.empty .mglass{fill:#dde3ee;stroke:#c3cbdb}',
    '.minicup.empty .mwater{opacity:0}',
    '.minicup.done{opacity:.22}',
    '.minicup.full svg{animation:cupBreath 1.8s ease-in-out infinite}',
    '@keyframes cupBreath{0%,100%{transform:scale(1)}50%{transform:scale(1.04)}}',
    // 杯排右侧的两个小按钮：设置（三条横线，和完整挂件的设置按钮同一套图标）/ 展开
    '.miniacts{display:flex;align-items:center;gap:4px;margin-left:2px;opacity:0;pointer-events:none;transition:opacity .12s ease}',
    '.minibar:hover .miniacts{opacity:1;pointer-events:auto}',
    '.miniico{width:26px;height:26px;padding:0;border:0;border-radius:8px;background:#3d4b6d;color:#fff;',
    'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;cursor:pointer}',
    '.miniico:hover{background:#33405c}',
    '.miniico span{display:block;width:12px;height:2px;border-radius:1px;background:#fff}',
    '.miniico.plus{font-size:16px;line-height:26px;display:block;text-align:center;font-weight:400}',
    // 角标 + 喝水小卡片
    '.chips{display:flex;align-items:baseline;justify-content:center;gap:7px}',
    '.blabel{font-style:normal;font-size:var(--ui);line-height:1.3;color:#8b93a7;white-space:nowrap}',
    '.blabel[hidden]{display:none}',
    '.drinkcount{font-variant-numeric:tabular-nums;min-width:1.1em;text-align:right;color:#4f7fe0;font-weight:600}',
    '.badge{font-size:var(--ui);line-height:1.3;letter-spacing:.04em;color:#5b6478;',
    'font-variant-numeric:tabular-nums}',
    '.stat{display:flex;justify-content:space-between;gap:10px;padding:8px 10px;margin-bottom:6px;border-radius:9px;',
    'background:#f6f8fc;color:#3d475b;font-size:calc(var(--hsize,14px) * .92)}',
    '.stat b{font-weight:600;font-variant-numeric:tabular-nums}',
    '.stat .bar{height:5px;border-radius:3px;background:#e3e8f2;margin-top:5px;overflow:hidden}',
    '.stat .bar i{display:block;height:100%;border-radius:3px;background:#4f7fe0}',
    '.note{margin:6px 0 2px;font-size:calc(var(--hsize,14px) * .82);line-height:1.5;color:#98a2b3}',
    'svg.scene{width:calc(var(--base) * var(--scale));height:calc(var(--base) * 109 / 140 * var(--scale));display:block;image-rendering:pixelated;shape-rendering:crispEdges;overflow:hidden}',
    '.power path{shape-rendering:geometricPrecision}',
    '.hair{fill:#2b3142}.skin{fill:#f0b892}.shirt{fill:#4f7fe0}.pants{fill:#2f3648}.ink{fill:#1f2430}',
    '.chair{fill:#8b93a7}.wood{fill:#b07a45}.bezel{fill:#262b36}.screen{fill:#8fd8ff}.code{fill:#2f6f9e}',
    '.kb{fill:#cfd6e4}.cupbody{fill:#e8f5fd;stroke:#a9cfe5;stroke-width:.35}.cupwater{fill:#4aa3e0}.cupshine{fill:#fbfeff}.cuprim{fill:#c7e4f4}',
    '.power{display:none}',
    ':host([data-pc="off"]) .power{display:inline}',
    '.pose-stand,.pose-walk,.pose-legsup,.pose-sip{display:none}',
    '[tabindex]:focus{outline:none}',
    '.cupwater{transition:transform .8s linear,opacity .4s ease;transform-box:fill-box;transform-origin:center bottom}',
    '@keyframes sipPulse{0%{transform:none}35%{transform:translateY(-1px) scale(1.06)}100%{transform:none}}',
    '#cup.sip{animation:sipPulse .45s ease-out}',
    '.hit{cursor:pointer}',
    'svg:focus,svg *:focus{outline:none}',
    '.hit:hover{filter:brightness(1.08)}',
    // 显示器关机：屏幕变暗、代码熄灭
    ':host([data-pc="off"]) .screen{fill:#39415a}',
    ':host([data-pc="off"]) .code{display:none}',
    ':host([data-mode="stand"]) .pose-sit{display:none}',
    ':host([data-mode="stand"]) .pose-stand{display:inline}',
    ':host([data-mode="stand"]) .code{opacity:.12}',
    ':host([data-mode="leaving"]) .pose-sit,:host([data-mode="away"]) .pose-sit{display:none}',
    // 翘腿 = 收工（含未开机、今天不再提醒）；敲键盘 = 工作中；空椅子 = 离开
    ':host([data-mode="off"]) .pose-sit,:host([data-mode="boot"]) .pose-sit,:host([data-mode="paused"]) .pose-sit{display:none}',
    ':host([data-mode="off"]) .pose-legsup,:host([data-mode="boot"]) .pose-legsup,:host([data-mode="paused"]) .pose-legsup{display:inline}',
    ':host([data-mode="sip"]) .pose-sit{display:none}',
    ':host([data-mode="sip"]) .pose-sip{display:inline}',
    ':host([data-mode="sip"]) #cup{opacity:0}',
    ':host([data-mode="leaving"]) .pose-walk,:host([data-mode="returning"]) .pose-walk{display:inline}',
    ':host([data-mode="leaving"]) .figure{animation:walkOut 1.15s steps(10,end) forwards}',
    ':host([data-mode="returning"]) .figure{animation:walkIn 1.15s steps(10,end) forwards}',
    ':host([data-mode="away"]) .pet{opacity:.6}',
    ':host([data-mode="off"]) .pet{opacity:.55}',
    '.bob{animation:bob 2.6s steps(1,end) infinite}',
    '@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(1px)}}',
    '.hand-a{animation:handA .44s steps(1,end) infinite}',
    '.hand-b{animation:handB .44s steps(1,end) infinite}',
    '@keyframes handA{0%,49%{opacity:1}50%,100%{opacity:0}}',
    '@keyframes handB{0%,49%{opacity:0}50%,100%{opacity:1}}',
    '.leg-a{animation:stepA .46s steps(1,end) infinite}',
    '.leg-b{animation:stepB .46s steps(1,end) infinite}',
    '@keyframes stepA{0%,49%{opacity:1}50%,100%{opacity:0}}',
    '@keyframes stepB{0%,49%{opacity:0}50%,100%{opacity:1}}',
    '@keyframes walkOut{0%{transform:translateX(0);opacity:1}70%{opacity:1}100%{transform:translateX(-22px);opacity:0}}',
    '@keyframes walkIn{0%{transform:translateX(-22px);opacity:0}30%{opacity:1}100%{transform:none;opacity:1}}',
    '.code{animation:flick 3.2s steps(1,end) infinite}',
    '@keyframes flick{0%,100%{opacity:1}58%{opacity:.5}62%{opacity:1}}',
    '.pose-stand{animation:stretch 1.4s steps(1,end) infinite}',
    '@keyframes stretch{0%,100%{transform:translateY(0)}50%{transform:translateY(-1px)}}',
    '.cup{animation:cupIn .45s steps(4,end)}',
    '@keyframes cupIn{0%{transform:translateY(3px);opacity:0}100%{transform:none;opacity:1}}',
    '@media (prefers-reduced-motion:reduce){.bob,.hand-a,.hand-b,.leg-a,.leg-b,.code,.pose-stand,.cup,.figure{animation:none!important}}',
    '@media (prefers-color-scheme:dark){:host{color:#e7eaf3}.card,.panel{background:#1c2130;border-color:#2b3247}',
    '.tag{background:#252c3d;color:#98a2b3}.badge{color:#a9b2c7}.icon:hover{background:#252c3d}p{color:#a9b2c7}',
    '.ghost{background:#252c3d;border-color:#2f374b;color:#dfe5f2}.ghost:hover{background:#2c3549}',
    '.field input,.field select{background:#232a3a;border-color:#333b52;color:#e7eaf3}.hint{color:#7b8496}}',
    '</style>',
    '<div class="stack">',
    '  <section class="panel" id="panel" hidden>',
    '    <div class="card-top"><span class="tag" data-i18n="tagSettings">设置</span><button class="icon" id="panelClose" title="关闭" data-i18n-title="close">✕</button></div>',
    '    <label class="field"><span data-i18n="lang">语言</span><select id="fLang"><option value="auto" data-i18n="langAuto">跟随系统</option><option value="zh">中文</option><option value="en">English</option></select></label>',
    '    <div class="stat" id="statWork"><span data-i18n="statWork">今日工作</span><b id="statWorkVal">0 分钟</b></div>',
    '    <label class="field"><span data-i18n="interval">提醒间隔</span><input id="fInterval" type="number" min="5" max="180" step="5"><em data-i18n="unitMinute">分钟</em></label>',
    '    <label class="field"><span data-i18n="workHours">工作时段</span><input id="fWorkStart" type="time"><b>–</b><input id="fWorkEnd" type="time"></label>',
    '    <label class="field"><span data-i18n="lunch">午休</span><input id="fLunch" type="checkbox"><input id="fLunchStart" type="time"><b>–</b><input id="fLunchEnd" type="time"></label>',
    '    <label class="field"><span data-i18n="sound">提示音</span><input id="fSound" type="checkbox"></label>',
    '    <label class="field"><span data-i18n="volume">提示音量</span><input id="fVolume" type="range" min="0" max="100" step="5"><em class="scaleval" id="fVolumeVal">70%</em></label>',
    '    <label class="field"><span data-i18n="waterOn">喝水提醒</span><input id="fWaterOn" type="checkbox"><b class="drinkcount" id="drinkCount">0</b><em>/</em><input id="fWaterGoal" type="number" min="1" max="20" step="1"><em data-i18n="unitCup">杯</em></label>',
    '    <label class="field"><span data-i18n="workRecord">工作记录</span><input id="fShowWork" type="checkbox"><em data-i18n="workRecordAuto">自动累计开机时长</em></label>',
    '    <label class="field"><span data-i18n="size">画面大小</span><input id="fScale" type="range" min="50" max="300" step="5"><em class="scaleval" id="fScaleVal">125%</em></label>',
    '    <label class="field"><span data-i18n="fontSize">时间字号</span><input id="fFont" type="range" min="20" max="48" step="2"><em class="scaleval" id="fFontVal">32px</em></label>',
    '    <div class="row"><button class="ghost" id="testNow" data-i18n="testNow">立即测试</button><button class="ghost" id="resumeBtn" hidden data-i18n="resume">恢复提醒</button></div>',
    '    <p class="note" id="waterNote"></p>',
    '    <p class="note" data-i18n="guide">参考《中国居民膳食指南（2022）》：成年男性每天饮水 1700ml、女性 1500ml。</p>',
    '    <p class="hint" id="hint"></p>',
    '  </section>',
    '  <section class="card" id="card" hidden>',
    '    <h2 data-i18n="cardTitle">站起来活动活动，喝点水</h2>',
    '    <div class="row actions"><button class="primary" id="ack" data-i18n="ack">我站起来了！</button><button class="ghost" id="snooze" data-i18n="snooze">再过 5 分钟</button>',
    '      <button class="ghost" id="pauseToday" data-i18n="pauseToday">不再提醒</button></div>',
    '  </section>',
    '  <button class="menu mini" id="miniBtn" type="button" title="收起到输入框" aria-label="收起到输入框" data-i18n-title="miniCollapse" data-i18n-aria="miniCollapse"><span></span></button>',
'  <button class="menu" id="menuBtn" type="button" title="设置" aria-label="设置" data-i18n-title="settings" data-i18n-aria="settings"><span></span><span></span><span></span></button>',
    '  <button class="pet" id="pet" type="button" aria-label="久坐提醒" data-i18n-aria="petLabel">',
    '    <span class="stage">',
    '    <svg class="scene" viewBox="0 0 36 28" aria-hidden="true">',
    '      <rect class="wood" x="12" y="20" width="24" height="3"/>',
    '      <rect class="wood" x="13" y="23" width="1" height="4"/>',
    '      <rect class="wood" x="34" y="23" width="1" height="4"/>',
    '      <g class="hit" id="pc" role="button" tabindex="0" aria-label="开机关机" data-i18n-aria="pcLabel">',
    '        <rect class="bezel" x="24" y="7" width="11" height="9"/>',
    '        <rect class="screen" x="25" y="8" width="9" height="7"/>',
    '        <rect class="code" x="26" y="9" width="6" height="1"/>',
    '        <rect class="code" x="26" y="11" width="7" height="1"/>',
    '        <rect class="code" x="26" y="13" width="5" height="1"/>',
    '        <g class="power">',
    '          <path d="M29.5 9.2v2.4" stroke="#f05252" stroke-width="0.75" stroke-linecap="round"/>',
    '          <path d="M28 10.3A2.2 2.2 0 1 0 31 10.3" fill="none" stroke="#f05252" stroke-width="0.75" stroke-linecap="round"/>',
    '        </g>',
    '        <rect class="bezel" x="28" y="16" width="3" height="4"/>',
    '        <rect class="bezel" x="26" y="19" width="7" height="1"/>',
    '      </g>',
    '      <rect class="kb" x="12" y="19" width="4" height="1"/>',
    '      <g class="hit" id="chair" role="button" tabindex="0" aria-label="回来工作" data-i18n-aria="chairLabel">',
    '        <rect class="chair" x="1" y="9" width="4" height="2" rx="1"/>',
    '        <rect class="chair" x="1" y="11" width="3" height="9"/>',
    '        <rect class="chair" x="1" y="17" width="4" height="3"/>',
    '        <rect class="chair" x="1" y="20" width="8" height="2" rx="1"/>',
    '        <rect class="chair" x="8" y="17" width="2" height="4"/>',
    '        <rect class="chair" x="7" y="16" width="4" height="1" rx="1"/>',
    '        <rect class="chair" x="5" y="22" width="2" height="2"/>',
    '        <rect class="chair" x="2" y="24" width="8" height="1" rx="1"/>',
    '        <rect class="chair" x="2" y="25" width="2" height="1"/>',
    '        <rect class="chair" x="5" y="25" width="2" height="1"/>',
    '        <rect class="chair" x="8" y="25" width="2" height="1"/>',
    '      </g>',
    '      <g class="figure">',
    '        <g class="pose pose-sit">',
    '          <rect class="pants" x="6" y="20" width="6" height="2"/>',
    '          <rect class="pants" x="9" y="22" width="2" height="4"/>',
    '          <rect class="ink" x="8" y="26" width="4" height="1"/>',
    '          <rect class="shirt" x="6" y="13" width="6" height="7"/>',
    '          <rect class="shirt" x="11" y="14" width="2" height="3"/>',
    '          <rect class="shirt" x="13" y="17" width="3" height="1"/>',
    '          <rect class="skin hand-a" x="16" y="18" width="2" height="1"/>',
    '          <rect class="skin hand-b" x="18" y="18" width="1" height="1"/>',
    '          <g class="bob">',
    '            <rect class="skin" x="6" y="6" width="6" height="7"/>',
    '            <rect class="hair" x="6" y="6" width="6" height="2"/>',
    '            <rect class="ink" x="10" y="9" width="1" height="1"/>',
    '            <rect class="ink" x="9" y="11" width="2" height="1"/>',
    '          </g>',
    '        </g>',
    '        <g class="pose pose-sip">',
    '          <rect class="pants" x="6" y="20" width="6" height="2"/>',
    '          <rect class="pants" x="9" y="22" width="2" height="4"/>',
    '          <rect class="ink" x="8" y="26" width="4" height="1"/>',
    '          <rect class="shirt" x="6" y="13" width="6" height="7"/>',
    '          <rect class="shirt" x="12" y="14" width="2" height="3"/>',
    '          <rect class="shirt" x="12" y="11" width="2" height="3"/>',
    '          <rect class="skin" x="12" y="10" width="2" height="1"/>',
    '          <g class="bob">',
    '            <rect class="skin" x="6" y="6" width="6" height="7"/>',
    '            <rect class="hair" x="6" y="6" width="6" height="2"/>',
    '            <rect class="ink" x="10" y="9" width="1" height="1"/>',
    '            <rect class="ink" x="9" y="11" width="2" height="1"/>',
    '          </g>',
    '          <polygon class="cupbody" points="12.4,8.4 15.4,8.4 14.8,11.9 12.9,11.9"/>',
    '          <polygon class="cupwater" points="12.6,9.4 15.2,9.4 14.8,11.9 12.9,11.9"/>',
    '          <polygon class="cuprim" points="12.4,8.4 15.4,8.4 15.4,8.95 12.4,8.95"/>',
    '        </g>',
    '        <g class="pose pose-stand">',
    '          <rect class="pants" x="7" y="21" width="2" height="6"/>',
    '          <rect class="pants" x="11" y="21" width="2" height="6"/>',
    '          <rect class="ink" x="6" y="27" width="3" height="1"/>',
    '          <rect class="ink" x="11" y="27" width="3" height="1"/>',
    '          <rect class="shirt" x="6" y="13" width="6" height="8"/>',
    '          <rect class="skin" x="6" y="6" width="6" height="7"/>',
    '          <rect class="hair" x="6" y="6" width="6" height="2"/>',
    '          <rect class="ink" x="7" y="9" width="1" height="1"/>',
    '          <rect class="ink" x="10" y="9" width="1" height="1"/>',
    '          <rect class="ink" x="8" y="11" width="2" height="1"/>',
    '          <rect class="shirt" x="4" y="13" width="2" height="2"/>',
    '          <rect class="shirt" x="4" y="10" width="2" height="3"/>',
    '          <rect class="shirt" x="3" y="7" width="2" height="3"/>',
    '          <rect class="skin" x="3" y="4" width="2" height="3"/>',
    '          <rect class="shirt" x="12" y="13" width="2" height="2"/>',
    '          <rect class="shirt" x="12" y="10" width="2" height="3"/>',
    '          <rect class="shirt" x="13" y="7" width="2" height="3"/>',
    '          <rect class="skin" x="13" y="4" width="2" height="3"/>',
    '        </g>',
    '        <g class="pose pose-walk">',
    '          <rect class="pants" x="5" y="20" width="7" height="1"/>',
    '          <rect class="pants leg-a" x="5" y="21" width="2" height="4"/>',
    '          <rect class="ink leg-a" x="3" y="25" width="3" height="1"/>',
    '          <rect class="pants leg-b" x="11" y="21" width="2" height="4"/>',
    '          <rect class="ink leg-b" x="11" y="25" width="3" height="1"/>',
    '          <rect class="shirt" x="6" y="13" width="6" height="7"/>',
    '          <rect class="shirt" x="5" y="14" width="2" height="4"/>',
    '          <rect class="shirt" x="11" y="14" width="2" height="4"/>',
    '          <rect class="skin" x="6" y="6" width="6" height="7"/>',
    '          <rect class="hair" x="6" y="6" width="6" height="2"/>',
    '          <rect class="ink" x="8" y="9" width="1" height="1"/>',
    '          <rect class="ink" x="7" y="11" width="1" height="1"/>',
    '        </g>',
    '        <g class="pose pose-legsup">',
    '          <rect class="pants" x="8" y="18" width="5" height="3"/>',
    '          <rect class="pants" x="12" y="17" width="4" height="3"/>',
    '          <rect class="ink" x="14" y="16" width="2" height="2"/>',
    '          <rect class="ink" x="15" y="19" width="2" height="2"/>',
    '          <rect class="shirt" x="5" y="13" width="6" height="7"/>',
    '          <rect class="shirt" x="4" y="14" width="2" height="4"/>',
    '          <rect class="skin" x="4" y="18" width="2" height="1"/>',
    '          <rect class="shirt" x="11" y="14" width="2" height="4"/>',
    '          <rect class="skin" x="11" y="18" width="2" height="1"/>',
    '          <g class="bob">',
    '            <rect class="skin" x="4" y="6" width="6" height="7"/>',
    '            <rect class="hair" x="4" y="6" width="6" height="2"/>',
    '            <rect class="ink" x="8" y="9" width="1" height="1"/>',
    '            <rect class="ink" x="7" y="11" width="2" height="1"/>',
    '          </g>',
    '        </g>',
    '      </g>',
    '      <g class="hit" id="cup" role="button" tabindex="0" aria-label="喝一杯" data-i18n-aria="cupLabel">',
    '        <clipPath id="cupGlass"><polygon points="17.6,13.6 21.6,13.6 20.8,20 18.4,20"/></clipPath>',
    '        <polygon class="cupbody" points="17.6,13.6 21.6,13.6 20.8,20 18.4,20"/>',
    '        <g clip-path="url(#cupGlass)">',
    '          <rect class="cupwater" id="cupWater" x="17.6" y="13.6" width="4" height="6.4"/>',
    '        </g>',
    '        <polygon class="cupshine" points="18.3,14.1 18.9,14.1 18.7,19.4 18.2,19.4"/>',
    '        <polygon class="cuprim" points="17.6,13.6 21.6,13.6 21.6,14.2 17.6,14.2"/>',
    '      </g>',
    '    </svg>',
    '    </span>',
    '    <span class="chips">',
    '      <i class="blabel" id="badgeLabel" data-i18n="badgeLabel">下次提醒</i>',
    '      <span class="badge" id="badge">—</span>',
    '    </span>',
    '  </button>',
    '</div>',
    '<div class="minibar" id="miniBar" hidden>',
    '  <div class="minicups" id="miniCups"></div>',
    '  <div class="miniacts">',
    '    <button class="miniico" id="miniGear" type="button" title="设置" aria-label="设置" data-i18n-title="settings" data-i18n-aria="settings"><span></span><span></span><span></span></button>',
    '    <button class="miniico plus" id="miniRestore" type="button" title="展开挂件" aria-label="展开挂件" data-i18n-title="miniExpand" data-i18n-aria="miniExpand">+</button>',
    '  </div>',
    '</div>',
    '<svg class="mdefs" width="0" height="0" aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden">',
    '  <defs><clipPath id="miniClip"><polygon points="3,2 21,2 18.5,24 5.5,24"/></clipPath></defs>',
    '</svg>'
  ].join('')

  var host = document.createElement('div')
  host.id = 'dsh-stand-reminder'
  host.setAttribute('data-mode', 'boot')
  var shadow = host.attachShadow({ mode: 'open' })
  shadow.innerHTML = TEMPLATE

  var pet = shadow.getElementById('pet')
  var badge = shadow.getElementById('badge')
  var badgeLabel = shadow.getElementById('badgeLabel')
  var card = shadow.getElementById('card')
  var panel = shadow.getElementById('panel')
  var hint = shadow.getElementById('hint')
  var menuBtn = shadow.getElementById('menuBtn')
  var miniBtn = shadow.getElementById('miniBtn')
  var miniBar = shadow.getElementById('miniBar')
  var miniCups = shadow.getElementById('miniCups')
  var miniRestore = shadow.getElementById('miniRestore')
  var miniGear = shadow.getElementById('miniGear')
  var waterNote = shadow.getElementById('waterNote')
  var drinkCount = shadow.getElementById('drinkCount')
  var statWork = shadow.getElementById('statWork')
  var statWorkVal = shadow.getElementById('statWorkVal')
  var chair = shadow.getElementById('chair')
  var pc = shadow.getElementById('pc')
  var cup = shadow.getElementById('cup')
  var cupWater = shadow.getElementById('cupWater')

  var fields = {
    lang: shadow.getElementById('fLang'),
    interval: shadow.getElementById('fInterval'),
    workStart: shadow.getElementById('fWorkStart'),
    workEnd: shadow.getElementById('fWorkEnd'),
    lunch: shadow.getElementById('fLunch'),
    lunchStart: shadow.getElementById('fLunchStart'),
    lunchEnd: shadow.getElementById('fLunchEnd'),
    sound: shadow.getElementById('fSound'),
    volume: shadow.getElementById('fVolume'),
    waterOn: shadow.getElementById('fWaterOn'),
    waterGoal: shadow.getElementById('fWaterGoal'),
    showWork: shadow.getElementById('fShowWork'),

    scale: shadow.getElementById('fScale'),
    font: shadow.getElementById('fFont')
  }
  var scaleVal = shadow.getElementById('fScaleVal')
  var volumeVal = shadow.getElementById('fVolumeVal')
  var fontVal = shadow.getElementById('fFontVal')

  var hideTimer = null
  var mode = 'boot'
  var retried = false   // 已经重试过一次就不再 10 分钟催，回到正常间隔
  var lastTick = Date.now()
  var lastWorkSave = 0

  // 把模板里所有带 data-i18n* 的节点按当前语言重填一遍
  function applyLang() {
    var dict = TEXT[langTag()] || TEXT.zh
    host.setAttribute('lang', langTag() === 'zh' ? 'zh-CN' : 'en')
    Array.prototype.forEach.call(shadow.querySelectorAll('[data-i18n]'), function (el) {
      var v = dict[el.getAttribute('data-i18n')]
      if (typeof v === 'string') el.textContent = v
    })
    Array.prototype.forEach.call(shadow.querySelectorAll('[data-i18n-title]'), function (el) {
      var v = dict[el.getAttribute('data-i18n-title')]
      if (typeof v === 'string') el.title = v
    })
    Array.prototype.forEach.call(shadow.querySelectorAll('[data-i18n-aria]'), function (el) {
      var v = dict[el.getAttribute('data-i18n-aria')]
      if (typeof v === 'string') el.setAttribute('aria-label', v)
    })
    paintWaterNote()
    renderStats()
    renderBadge(Date.now())
    if (miniOn()) ensureCups(cupsPerDay())
  }

  function mount() {
    var root = document.body || document.documentElement
    if (!root) { setTimeout(mount, 300); return }
    root.appendChild(host)
    // 设置面板跟随 Harness 本体的字体与字号，不跟挂件画面走
    try {
      var bs = getComputedStyle(root)
      if (bs.fontFamily) host.style.setProperty('--hfont', bs.fontFamily)
      if (bs.fontSize) host.style.setProperty('--hsize', bs.fontSize)
    } catch (err) {}
    applyScale()
    applyFont()
    applyLang()
    syncPc()
    applyPos()
    fillForm()
    paintCup()
    tick()
    // 还原上次的迷你/完整形态
    if (miniOn()) { host.setAttribute('data-mini', ''); miniBar.hidden = false; ensureCups(cupsPerDay()); positionMiniBar(); renderMini(Date.now()) }
    // 首帧后拉一次远端配置：端口每次启动都变，localStorage 不跨端口
    hydrate()
  }

  // ---------- 大小 / 位置 ----------

  var SNAP_X = 0.10   // 左右各 10% 吸附
  var SNAP_Y = 0.15   // 底部 15% 吸附（顶部不吸）

  function viewportSize() {
    return { w: window.innerWidth || 1280, h: window.innerHeight || 800 }
  }

  function hostSize() {
    return { w: host.offsetWidth || 0, h: host.offsetHeight || 0 }
  }

  function scalePercent() {
    return clampInt(state.settings.scale * 100, 50, 300, 125)
  }

  // 缩放只改场景的真实尺寸（卡片、面板、角标都是固定字号）。
  // 锚点：贴左（镜像）时固定左下角，否则固定右下角 —— 和鲸鱼一致。
  function applyScale() {
    var before = host.getBoundingClientRect()
    var keepLeft = state.pos.h === 'left' || (state.pos.h === null && state.pos.flip)
    host.style.setProperty('--scale', String(scalePercent() / 100))
    var after = host.getBoundingClientRect()
    // 量不到布局（隐藏/迷你模式）时不要用 0 反推位置，否则会把存档坐标清成 0
    if (state.pos.h === null && !hydrating && before.width > 0) state.pos.left = keepLeft ? before.left : before.right - after.width
    applyPos()
  }

  // 滑块和滚轮都走这里，保证两处同步
  function setScale(pct) {
    state.settings.scale = clampInt(pct, 50, 300, 125) / 100
    applyScale()
    fields.scale.value = String(scalePercent())
    scaleVal.textContent = scalePercent() + '%'
    save()
  }

  // ---------- 画面字号 / 喝水 / 工作时长 ----------

  // 字号只作用于挂件画面（时间角标），设置面板跟随 Harness 本体
  function applyFont() {
    host.style.setProperty('--ui', clampInt(state.settings.uiFont, 20, 48, 32) + 'px')
  }

  function setFont(px) {
    state.settings.uiFont = clampInt(px, 20, 48, 32)
    applyFont()
    fields.font.value = String(state.settings.uiFont)
    fontVal.textContent = state.settings.uiFont + 'px'
    save()
  }

  // 每天目标杯数（默认 8 杯，可自己填）
  function cupsPerDay() {
    return clampInt(state.settings.waterGoal, 1, 20, 8)
  }

  // 工作时段内的有效分钟数（扣掉午休）
  function workMinutes() {
    var ws = toMin(state.settings.workStart, 540)
    var we = toMin(state.settings.workEnd, 1080)
    if (we <= ws) we += 1440
    var total = we - ws
    if (state.settings.lunch) {
      var ls = toMin(state.settings.lunchStart, 720)
      var le = toMin(state.settings.lunchEnd, 810)
      if (le < ls) le += 1440
      var a = Math.max(ws, ls), b = Math.min(we, le)
      if (b > a) total -= b - a
    }
    return Math.max(60, total)
  }

  // 杯子涨满一次的时长 = 有效工作分钟 ÷ 每天杯数
  function fillMs() {
    return Math.max(5 * 60000, Math.round(workMinutes() * 60000 / cupsPerDay()))
  }

  // 面板里那句「工作时段内约 56 分钟一杯」
  function paintWaterNote() {
    waterNote.textContent = t('waterNote')(Math.round(fillMs() / 60000))
  }

  // 水杯水位：p=0 空，p=1 满；用 scaleY 从底部涨上来
  function paintCup() {
    if (!cupWater) return
    var p = state.settings.waterOn ? Math.min(1, state.waterMs / fillMs()) : 0
    cupWater.style.transform = 'scaleY(' + p.toFixed(4) + ')'
    cupWater.style.opacity = p <= 0.001 ? '0' : '1'
  }

  function drink() {
    if (!state.settings.waterOn) return
    state.waterMs = 0
    state.drinks += 1
    drinkCount.textContent = String(state.drinks)
    save()
    paintCup()
    renderBadge(Date.now())
    // 喝一口的反馈：水杯闪一下
    cup.classList.remove('sip')
    void cup.getBoundingClientRect()
    cup.classList.add('sip')
    // 举杯喝一口的动画：只在完整挂件、人坐在位子上时播
    var cur = host.getAttribute('data-mode')
    var canSip = !miniOn() && !state.away && state.pcOn &&
      cur !== 'off' && cur !== 'boot' && cur !== 'away' && cur !== 'leaving' && cur !== 'returning' && cur !== 'sip'
    if (canSip) {
      if (sipTimer) clearTimeout(sipTimer)
      var back = cur === 'stand' ? 'stand' : 'sit'
      setMode('sip')
      sipTimer = setTimeout(function () {
        sipTimer = null
        if (host.getAttribute('data-mode') === 'sip') setMode(back)
      }, 1100)
    }
  }

  // ---------- 迷你模式：输入框底部的杯排 ----------

  var GROW_MS = 5 * 60 * 1000   // 满杯后 5 分钟放大到 2 倍

  function miniOn() {
    return !!state.settings.mini && !!state.settings.waterOn
  }

  function ensureCups(n) {
    if (miniCups.childElementCount === n) return
    miniCups.textContent = ''
    for (var i = 0; i < n; i++) {
      var b = document.createElement('button')
      b.type = 'button'
      b.className = 'minicup empty'
      b.setAttribute('data-i', String(i))
      b.setAttribute('aria-label', t('cupN')(i + 1))
      b.innerHTML = '<svg viewBox="0 0 24 26" aria-hidden="true">' +
        '<polygon class="mglass" points="3,2 21,2 18.5,24 5.5,24"/>' +
        '<g clip-path="url(#miniClip)"><rect class="mwater" x="3" y="2" width="18" height="22"/></g>' +
        '</svg>'
      b.addEventListener('click', onCupClick)
      miniCups.appendChild(b)
    }
  }

  // 点第 i 杯：连着前面的未喝杯一起算掉（点没满的也算喝）
  function drinkTo(i) {
    if (i < state.drinks) return
    state.drinks = Math.min(cupsPerDay(), i + 1)
    state.waterMs = 0
    state.fullSince = null
    state.chimeCup = -1
    drinkCount.textContent = String(state.drinks)
    paintCup()
    renderMini(Date.now())
    renderBadge(Date.now())
    cup.classList.remove('sip')
    void cup.getBoundingClientRect()
    cup.classList.add('sip')
    playChime()
    save()
  }

  function onCupClick(event) {
    if (Date.now() < miniSuppressClick) return
    event.stopPropagation()
    drinkTo(Number(event.currentTarget.getAttribute('data-i')))
  }

  function renderMini(now) {
    if (miniBar.hidden) return
    ensureCups(cupsPerDay())
    var lvl = Math.min(1, state.waterMs / fillMs())
    var grow = 1
    if (state.fullSince) grow = 1 + Math.min(1, (now - state.fullSince) / GROW_MS)
    var kids = miniCups.children
    for (var i = 0; i < kids.length; i++) {
      var b = kids[i]
      var w = b.querySelector('.mwater')
      if (i < state.drinks) {
        b.className = 'minicup done'
        w.style.transform = 'scaleY(0.0000)'
        w.style.opacity = '0'
        b.style.transform = 'scale(1)'
      } else if (i === state.drinks) {
        var full = lvl >= 1
        b.className = full ? 'minicup full' : 'minicup'
        w.style.transform = 'scaleY(' + lvl.toFixed(4) + ')'
        w.style.opacity = lvl <= 0.001 ? '0' : '1'
        b.style.transform = 'scale(' + grow.toFixed(3) + ')'
      } else {
        b.className = 'minicup empty'
        w.style.transform = 'scaleY(0.0000)'
        w.style.opacity = '0'
        b.style.transform = 'scale(1)'
      }
    }
  }

  function inputEl() {
    return document.querySelector('[data-composer-input]') ||
      document.querySelector('[data-composer-seat] textarea') ||
      document.querySelector('textarea') ||
      document.querySelector('[contenteditable="true"]')
  }

  // 默认贴着输入框底边、避开发送按钮（右侧留 56px）；被拖过就停在记录的坐标
  function positionMiniBar() {
    if (miniBar.hidden) return
    if (state.miniPos) {
      var w = miniBar.offsetWidth || 0
      var h = miniBar.offsetHeight || 0
      var left = Math.max(0, Math.min(state.miniPos.left, Math.max(0, window.innerWidth - w)))
      var top = Math.max(0, Math.min(state.miniPos.top, Math.max(0, window.innerHeight - h)))
      miniBar.style.left = Math.round(left) + 'px'
      miniBar.style.top = Math.round(top) + 'px'
      miniBar.style.right = 'auto'
      miniBar.style.bottom = 'auto'
      return
    }
    miniBar.style.left = 'auto'
    miniBar.style.top = 'auto'
    var el = inputEl()
    var r = el && el.getBoundingClientRect()
    if (!r || !r.width) {
      miniBar.style.right = '16px'
      miniBar.style.bottom = '96px'
      return
    }
    miniBar.style.right = Math.round(Math.max(10, window.innerWidth - r.right + 56)) + 'px'
    miniBar.style.bottom = Math.round(Math.max(2, window.innerHeight - r.bottom + 4)) + 'px'
  }

  function setMini(on) {
    var next = !!on && !!state.settings.waterOn
    state.settings.mini = next
    if (next) {
      if (!state.pcOn) { state.pcOn = true; state.offWork = false }
      host.setAttribute('data-mini', '')
      closePanel()
      hideCard()
      miniBar.hidden = false
      ensureCups(cupsPerDay())
      positionMiniBar()
      renderMini(Date.now())
    } else {
      host.removeAttribute('data-mini')
      miniBar.hidden = true
      applyPos()
    }
    save()
  }

  // 满杯：记下时刻准备变大，并响一声
  function updateFullCup(now) {
    if (!state.settings.waterOn) return
    var lvl = state.waterMs / fillMs()
    if (lvl >= 1) {
      if (!state.fullSince) state.fullSince = now
      if (state.chimeCup !== state.drinks) {
        state.chimeCup = state.drinks
        // 只在工作时段内出声，免得半夜开着电脑还被提醒
        if (inWorkWindow(now)) playChime()
        save()
      }
    } else if (state.fullSince) {
      state.fullSince = null
    }
  }

  function fmtDuration(ms) {
    var m = Math.floor(ms / 60000)
    var h = Math.floor(m / 60)
    return h ? t('durHM')(h, m % 60) : t('durMin')(m)
  }

  function dayKeyOf(ts) {
    var d = new Date(ts)
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate()
  }

  // 按锚点算位置，再夹进视口；夹完回写偏移，窗口变化时不会越跑越偏
  function applyPos() {
    if (miniOn()) return // 迷你模式下挂件是隐藏的，别让 0 尺寸把存档位置算歪
    var vp = viewportSize()
    var size = hostSize()
    var p = state.pos
    var left = p.h === 'left' ? p.hOff : p.h === 'right' ? vp.w - size.w - p.hOff : p.left
    var top = p.v === 'top' ? p.vOff : vp.h - size.h - p.vOff
    left = Math.max(0, Math.min(left, Math.max(0, vp.w - size.w)))
    top = Math.max(0, Math.min(top, Math.max(0, vp.h - size.h)))
    if (p.h === 'left') p.hOff = left
    else if (p.h === 'right') p.hOff = Math.max(0, vp.w - size.w - left)
    else p.left = left
    if (p.v === 'top') p.vOff = top
    else p.vOff = Math.max(0, vp.h - size.h - top)
    host.style.left = left + 'px'
    host.style.top = top + 'px'
    host.style.right = 'auto'
    host.style.bottom = 'auto'
    refreshFlip()
  }

  // 贴左必镜像、贴右不镜像；自由摆放时看小人中心在左半还是右半
  function refreshFlip() {
    var flip
    if (state.pos.h === 'left') flip = true
    else if (state.pos.h === 'right') flip = false
    else {
      var r = pet.getBoundingClientRect()
      flip = (r.left + r.width / 2) < viewportSize().w / 2
    }
    state.pos.flip = flip
    if (flip) host.setAttribute('data-flip', '')
    else host.removeAttribute('data-flip')
  }

  // 松手后按小人中心判定吸附（顶部不吸），并把位置换算成锚点
  function snapCheck() {
    var vp = viewportSize()
    var size = hostSize()
    var r = pet.getBoundingClientRect()
    var cx = r.left + r.width / 2
    var cy = r.top + r.height / 2
    var p = state.pos
    if (cx < vp.w * SNAP_X) {
      p.h = 'left'
      p.hOff = 0
    } else if (cx > vp.w * (1 - SNAP_X)) {
      p.h = 'right'
      p.hOff = 0
    } else {
      p.h = null
      p.left = parseFloat(host.style.left) || 0
    }
    p.v = 'bottom'
    p.vOff = cy > vp.h * (1 - SNAP_Y)
      ? 0
      : Math.max(0, vp.h - (parseFloat(host.style.top) || 0) - size.h)
    applyPos()
  }

  // ---------- 状态切换 ----------

  function setMode(next) {
    if (mode === next) return
    mode = next
    host.setAttribute('data-mode', next)
    renderBadge(Date.now()) // 动作一变，角标的状态词立刻跟着变
  }

  function syncPc() {
    host.setAttribute('data-pc', state.pcOn ? 'on' : 'off')
  }

  function syncOpenState() {
    if (!panel.hidden || !card.hidden) host.setAttribute('data-open', '')
    else host.removeAttribute('data-open')
  }

  function showCard() {
    panel.hidden = true
    card.hidden = false
    syncOpenState()
    card.classList.remove('show')
    // 强制重排，让每次弹出都重放动画
    void card.offsetWidth
    card.classList.add('show')
  }

  function hideCard() {
    card.hidden = true
    card.classList.remove('show')
    syncOpenState()
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null }
  }

  // 面板固定在打开那一刻的位置：调整大小时不跟着动，也就不会闪
  function positionPanel() {
    if (panel.hidden) return
    var vp = viewportSize()
    var anchor = (miniOn() ? miniGear : menuBtn).getBoundingClientRect()
    var pw = panel.offsetWidth || 340
    var ph = panel.offsetHeight || 360
    var margin = 10
    var left = Math.min(Math.max(margin, anchor.right - pw), Math.max(margin, vp.w - pw - margin))
    var top = anchor.top - ph - margin
    if (top < margin) top = margin
    panel.style.position = 'fixed'
    panel.style.left = Math.round(left) + 'px'
    panel.style.top = Math.round(top) + 'px'
    panel.style.right = 'auto'
    panel.style.bottom = 'auto'
  }

  function openPanel() {
    hideCard()
    fillForm()
    panel.hidden = false
    syncOpenState()
    positionPanel()
  }

  function closePanel() {
    panel.hidden = true
    panel.style.position = ''
    panel.style.left = ''
    panel.style.top = ''
    panel.style.right = ''
    panel.style.bottom = ''
    syncOpenState()
  }

  function fillForm() {
    fields.lang.value = state.settings.lang === 'zh' || state.settings.lang === 'en' ? state.settings.lang : 'auto'
    fields.interval.value = String(intervalMin())
    fields.workStart.value = state.settings.workStart
    fields.workEnd.value = state.settings.workEnd
    fields.lunch.checked = !!state.settings.lunch
    fields.lunchStart.value = state.settings.lunchStart
    fields.lunchEnd.value = state.settings.lunchEnd
    fields.sound.checked = !!state.settings.sound
    fields.volume.value = String(volumePct())
    volumeVal.textContent = volumePct() + '%'
    fields.waterOn.checked = !!state.settings.waterOn
    fields.waterGoal.value = String(cupsPerDay())
    drinkCount.textContent = String(state.drinks)
    paintWaterNote()
    fields.showWork.checked = !!state.settings.showWork
    fields.scale.value = String(scalePercent())
    scaleVal.textContent = scalePercent() + '%'
    fields.font.value = String(clampInt(state.settings.uiFont, 20, 48, 32))
    fontVal.textContent = clampInt(state.settings.uiFont, 20, 48, 32) + 'px'
    renderStats()
  }

  function renderStats() {
    statWork.hidden = !state.settings.showWork
    statWorkVal.textContent = fmtDuration(state.workedMs)
    drinkCount.textContent = String(state.drinks)
  }

  function renderBadge(now) {
    // 只有三种状态：工作（跟下次提醒时间）、离开、收工
    var text
    // 状态必须和画面上的动作对得上：空椅子=离开、翘腿=收工、坐姿=工作
    if (state.away || mode === 'away' || mode === 'leaving' || mode === 'returning') text = t('badgeLeave')
    else if (!state.pcOn || state.offWork || mode === 'paused' || mode === 'boot' || mode === 'off') text = t('badgeOff')
    else text = t('badgeWork')
    badge.textContent = text
    badgeLabel.hidden = true

    paintCup()

    var title
    if (state.away) title = t('titleAway')
    else if (!state.pcOn) title = state.offWork ? t('titleOffWork') : t('titleOff')
    else if (mode === 'paused' && state.pausedUntil) title = t('titlePaused')(clockText(state.pausedUntil))
    else if (mode === 'rest') title = t('titleRest')(state.nextDueAt ? clockText(state.nextDueAt) : '')
    else if (state.nextDueAt) title = t('titleNext')(clockText(state.nextDueAt))
    else title = t('titleIdle')
    pet.title = title

    if (panel.hidden) return
    renderStats()
    if (state.away) hint.textContent = t('hintAway')
    else if (!state.pcOn) hint.textContent = state.offWork ? t('hintOffWork') : t('hintOff')
    else if (mode === 'paused' && state.pausedUntil) hint.textContent = t('hintPaused')(clockText(state.pausedUntil))
    else if (mode === 'rest') hint.textContent = t('hintRest')
    else if (state.nextDueAt) hint.textContent = t('hintNext')(clockText(state.nextDueAt))
    else hint.textContent = ''
    shadow.getElementById('resumeBtn').hidden = mode !== 'paused' || !state.pcOn
  }

  // ---------- 核心状态机 ----------

  function tick() {
    var now = Date.now()
    syncPc()

    // 跨天：喝水、工作时长清零，回到未开机
    var key = dayKeyOf(now)
    if (state.dayKey !== key) {
      state.dayKey = key
      state.waterMs = 0
      state.drinks = 0
      state.fullSince = null
      state.chimeCup = -1
      state.workedMs = 0
      state.pcOn = false
      state.offWork = false
      state.away = false
      state.nextDueAt = null
      state.pausedUntil = null
      retried = false
      save()
    }

    // 累计工作时长：开机、没离开、在工作时段内；休眠/切页造成的大跳变不计
    var delta = now - lastTick
    lastTick = now
    // 在工作 = 开着机且没离开；迷你模式视为一直在工作
    var onDesk = miniOn() || (state.pcOn && !state.away)
    var working = onDesk && inWorkWindow(now)
    if (delta > 0 && delta < 2 * 60 * 1000) {
      if (working) state.workedMs += delta
      // 水杯和站立是两条独立的线：不跟提醒间隔、也不跟工作时段绑定，
      // 只要人还在电脑前（没收工）就一直蓄水，下班时间喝的水也算数
      if (onDesk && !state.offWork && state.settings.waterOn) state.waterMs += delta
      if (now - lastWorkSave > 60 * 1000) {
        lastWorkSave = now
        save()
      }
    }
    paintCup()
    updateFullCup(now)

    // 迷你模式：只剩喝水这条线，不弹站立卡片
    if (miniOn()) {
      renderMini(now)
      positionMiniBar()
      return
    }

    // 离开/回来的走路动画期间不打断
    if (mode === 'leaving' || mode === 'returning' || mode === 'sip') {
      renderBadge(now)
      return
    }

    // 电脑没开机：不提醒，等人点显示器
    if (!state.pcOn) {
      if (state.away) { state.away = false; save() }
      hideCard()
      setMode(state.offWork ? 'off' : 'boot')
      renderBadge(now)
      return
    }

    // 不在电脑前：暂停一切提醒
    if (state.away) {
      if (mode !== 'away') setMode('away')
      renderBadge(now)
      return
    }

    // 暂停中
    if (state.pausedUntil && now < state.pausedUntil) {
      if (mode !== 'paused') { hideCard(); setMode('paused') }
      renderBadge(now)
      return
    }
    if (state.pausedUntil && now >= state.pausedUntil) {
      state.pausedUntil = null
      state.nextDueAt = null
      save()
    }

    // 不在提醒时段（含午休、下班前 10 分钟）
    if (!inWorkWindow(now) || isNearWindowEnd(now)) {
      if (mode === 'stand') hideCard()
      if (mode !== 'rest') setMode('rest')
      if (state.nextDueAt !== null) { state.nextDueAt = null; save() }
      renderBadge(now)
      return
    }

    // 进入时段后从「现在」重新起算，不立刻弹
    if (state.nextDueAt === null) {
      state.nextDueAt = adjustDue(now + intervalMin() * 60000)
      save()
    } else if (now - state.nextDueAt > GRACE_MS) {
      // 睡眠/长时间关页面导致的过期提醒：安静顺延，不补弹
      state.nextDueAt = adjustDue(now + intervalMin() * 60000)
      save()
    }

    if (now >= state.nextDueAt) {
      remind(now)
    } else if (mode === 'stand') {
      // 卡片还开着，保持站姿
    } else {
      setMode('sit')
    }

    renderBadge(now)
  }

  function remind(now) {
    // 第一次提醒没人理 → 10 分钟后再催一次；再没人理 → 回到正常间隔
    state.nextDueAt = retried ? adjustDue(now + intervalMin() * 60000) : now + RETRY_MS
    retried = true
    save()
    setMode('stand')
    showCard()
    playChime()
    if (hideTimer) clearTimeout(hideTimer)
    hideTimer = setTimeout(function () {
      hideTimer = null
      hideCard()
      setMode('sit')
      renderBadge(Date.now())
    }, AUTO_HIDE_MS)
  }

  // ---------- 交互 ----------

  function ack() {
    retried = false
    hideCard()
    setMode('sit')
    state.nextDueAt = adjustDue(Date.now() + intervalMin() * 60000)
    save()
    renderBadge(Date.now())
  }

  function snooze() {
    retried = false
    hideCard()
    setMode('sit')
    state.nextDueAt = Date.now() + SNOOZE_MS
    save()
    renderBadge(Date.now())
  }

  function pauseToday() {
    retried = false
    state.pausedUntil = nextWorkStart(Date.now())
    state.nextDueAt = null
    save()
    hideCard()
    closePanel()
    setMode('paused')
    renderBadge(Date.now())
  }

  function resume() {
    retried = false
    state.pausedUntil = null
    state.nextDueAt = null
    save()
    tick()
  }

  // 离开电脑：小人起身走出画面，回来后重新计时
  function goAway() {
    if (state.away) return
    retried = false
    state.away = true
    state.nextDueAt = null
    save()
    hideCard()
    closePanel()
    setMode('leaving')
    renderBadge(Date.now())
    setTimeout(function () {
      if (state.away && mode === 'leaving') setMode('away')
    }, 1200)
  }

  function comeBack() {
    if (!state.away) return
    retried = false
    state.away = false
    state.nextDueAt = null
    save()
    closePanel()
    setMode('returning')
    renderBadge(Date.now())
    setTimeout(function () {
      if (state.away) return
      setMode('sit')
      state.nextDueAt = adjustDue(Date.now() + intervalMin() * 60000)
      save()
      tick()
    }, 1200)
  }

  // 点显示器：开机开始一天，或者关机收工
  function togglePc() {
    retried = false
    state.away = false
    if (state.pcOn) {
      state.pcOn = false
      state.offWork = true
      state.nextDueAt = null
      state.pausedUntil = null
      save()
      hideCard()
      closePanel()
      syncPc()
      setMode('off')
      renderStats()
      renderBadge(Date.now())
      return
    }
    // 开机 = 新的一天：上次是收工状态，就把今天的累积清零
    if (state.offWork) {
      state.workedMs = 0
      state.drinks = 0
      state.waterMs = 0
      state.fullSince = null
      state.chimeCup = -1
    }
    state.pcOn = true
    state.offWork = false
    state.nextDueAt = adjustDue(Date.now() + intervalMin() * 60000)
    save()
    closePanel()
    syncPc()
    setMode('sit')
    paintCup()
    renderStats()
    renderBadge(Date.now())
    tick()
  }

  function preview() {
    if (state.away) state.away = false
    if (!state.pcOn) { state.pcOn = true; state.offWork = false }
    save()
    syncPc()
    closePanel()
    setMode('stand')
    showCard()
    playChime()
    if (hideTimer) clearTimeout(hideTimer)
    hideTimer = setTimeout(function () {
      hideTimer = null
      hideCard()
      setMode('sit')
      renderBadge(Date.now())
    }, 20 * 1000)
  }

  function timingKey() {
    var s = state.settings
    return [s.interval, s.workStart, s.workEnd, s.lunch, s.lunchStart, s.lunchEnd].join('|')
  }

  function readForm() {
    var before = timingKey()
    var beforeLang = state.settings.lang
    var lang = fields.lang.value
    state.settings.lang = lang === 'zh' || lang === 'en' ? lang : 'auto'
    state.settings.interval = clampInt(fields.interval.value, 5, 180, 30)
    state.settings.workStart = /^\d{2}:\d{2}$/.test(fields.workStart.value) ? fields.workStart.value : DEFAULTS.workStart
    state.settings.workEnd = /^\d{2}:\d{2}$/.test(fields.workEnd.value) ? fields.workEnd.value : DEFAULTS.workEnd
    state.settings.lunch = !!fields.lunch.checked
    state.settings.lunchStart = /^\d{2}:\d{2}$/.test(fields.lunchStart.value) ? fields.lunchStart.value : DEFAULTS.lunchStart
    state.settings.lunchEnd = /^\d{2}:\d{2}$/.test(fields.lunchEnd.value) ? fields.lunchEnd.value : DEFAULTS.lunchEnd
    state.settings.sound = !!fields.sound.checked
    state.settings.waterOn = !!fields.waterOn.checked
    state.settings.waterGoal = clampInt(fields.waterGoal.value, 1, 20, 8)
    state.settings.showWork = !!fields.showWork.checked
    // 只有跟时间相关的设置变了才重新起算，改喝水量不该重置站立计时
    if (timingKey() !== before) {
      retried = false
      state.pausedUntil = null
      state.nextDueAt = state.pcOn ? adjustDue(Date.now() + intervalMin() * 60000) : null
    }
    if (state.settings.lang !== beforeLang) applyLang()
    save()
    fillForm()
    tick()
  }

  shadow.getElementById('ack').addEventListener('click', ack)
  shadow.getElementById('snooze').addEventListener('click', snooze)
  shadow.getElementById('pauseToday').addEventListener('click', pauseToday)

  shadow.getElementById('panelClose').addEventListener('click', closePanel)
  shadow.getElementById('testNow').addEventListener('click', preview)
  shadow.getElementById('resumeBtn').addEventListener('click', resume)
  menuBtn.addEventListener('click', function (event) {
    event.stopPropagation()
    if (panel.hidden) openPanel()
    else closePanel()
  })

  miniBtn.addEventListener('click', function (event) {
    event.stopPropagation()
    setMini(true)
  })

  miniRestore.addEventListener('click', function (event) {
    event.stopPropagation()
    setMini(false)
  })

  // 迷你模式也能打开设置：面板贴着杯排上的齿轮按钮弹出
  miniGear.addEventListener('click', function (event) {
    event.stopPropagation()
    if (panel.hidden) openPanel()
    else closePanel()
  })

  // 杯排可以拖着走：先按点击处理，移动超过 4px 才算拖动；双击恢复成跟随输入框
  var miniDrag = null
  var miniSuppressClick = 0
  miniBar.addEventListener('pointerdown', function (event) {
    if (event.button !== 0) return
    if (event.target.closest('.miniacts')) return
    var rect = miniBar.getBoundingClientRect()
    miniDrag = {
      dx: event.clientX - rect.left,
      dy: event.clientY - rect.top,
      moved: false,
      x: event.clientX,
      y: event.clientY
    }
    miniDrag.id = event.pointerId
  })

  miniBar.addEventListener('pointermove', function (event) {
    if (!miniDrag) return
    if (!miniDrag.moved && Math.abs(event.clientX - miniDrag.x) + Math.abs(event.clientY - miniDrag.y) < 4) return
    if (!miniDrag.moved) {
      // 确认是拖动后才接管指针：按下就 capture 会让杯子收不到 click，点不动水
      try { miniBar.setPointerCapture(miniDrag.id) } catch (err) {}
    }
    miniDrag.moved = true
    miniBar.classList.add('dragging')
    var w = miniBar.offsetWidth || 0
    var h = miniBar.offsetHeight || 0
    var left = Math.max(0, Math.min(event.clientX - miniDrag.dx, Math.max(0, window.innerWidth - w)))
    var top = Math.max(0, Math.min(event.clientY - miniDrag.dy, Math.max(0, window.innerHeight - h)))
    miniBar.style.left = Math.round(left) + 'px'
    miniBar.style.top = Math.round(top) + 'px'
    miniBar.style.right = 'auto'
    miniBar.style.bottom = 'auto'
  })

  miniBar.addEventListener('pointerup', function (event) {
    if (!miniDrag) return
    var moved = miniDrag.moved
    miniDrag = null
    miniBar.classList.remove('dragging')
    try { miniBar.releasePointerCapture(event.pointerId) } catch (err) {}
    if (!moved) return
    miniSuppressClick = Date.now() + 300
    var rect = miniBar.getBoundingClientRect()
    state.miniPos = { left: Math.round(rect.left), top: Math.round(rect.top) }
    save()
  })

  miniBar.addEventListener('dblclick', function (event) {
    if (event.target.closest('.miniacts')) return
    state.miniPos = null
    positionMiniBar()
    save()
  })

  Object.keys(fields).forEach(function (key) {
    if (key === 'scale' || key === 'font' || key === 'volume') return
    fields[key].addEventListener('change', readForm)
  })



  fields.scale.addEventListener('input', function () {
    setScale(fields.scale.value)
  })

  fields.font.addEventListener('input', function () {
    setFont(fields.font.value)
  })

  // 音量：拖动时实时保存，松手响一声试听
  fields.volume.addEventListener('input', function () {
    state.settings.volume = clampInt(fields.volume.value, 0, 100, 70)
    volumeVal.textContent = state.settings.volume + '%'
    save()
  })
  fields.volume.addEventListener('change', function () {
    playChime()
  })

  // 滚轮缩放（光标在小人上时），每格 5%
  pet.addEventListener('wheel', function (event) {
    event.preventDefault()
    setScale(scalePercent() + (event.deltaY < 0 ? 5 : -5))
  }, { passive: false })

  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return
    if (!panel.hidden) { closePanel(); return }
    if (!card.hidden) { hideCard(); setMode('sit') }
  })

  // 点面板以外的任何位置都收起面板（点菜单按钮自己会开关，不算「外面」）
  var swallowPetClickUntil = 0
  document.addEventListener('pointerdown', function (event) {
    if (panel.hidden) return
    var path = event.composedPath ? event.composedPath() : []
    if (path.indexOf(panel) >= 0 || path.indexOf(menuBtn) >= 0 || path.indexOf(miniGear) >= 0) return
    // 点在场景上：只收面板，不要顺带触发「离开」
    if (path.indexOf(pet) >= 0) swallowPetClickUntil = Date.now() + 600
    closePanel()
  }, true)

  document.addEventListener('pointerdown', unlockAudio, { once: true, capture: true })

  // 拖动：短按=打开设置，拖动=换位置（位置记在 localStorage）
  var drag = null

  pet.addEventListener('pointerdown', function (event) {
    if (event.button !== 0) return
    // 显示器 / 椅子 / 水杯有自己的点击行为，不参与拖动
    if (event.target.closest && event.target.closest('.hit')) return
    var rect = host.getBoundingClientRect()
    drag = { dx: event.clientX - rect.left, dy: event.clientY - rect.top, moved: false, x: event.clientX, y: event.clientY }
    try { pet.setPointerCapture(event.pointerId) } catch (err) {}
    event.preventDefault()
  })

  pet.addEventListener('pointermove', function (event) {
    if (!drag) return
    if (!drag.moved && Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y) < 4) return
    drag.moved = true
    var vp = viewportSize()
    var size = hostSize()
    var left = Math.max(0, Math.min(event.clientX - drag.dx, Math.max(0, vp.w - size.w)))
    var top = Math.max(0, Math.min(event.clientY - drag.dy, Math.max(0, vp.h - size.h)))
    state.pos.h = null
    state.pos.left = left
    state.pos.v = 'top'
    state.pos.vOff = top
    host.style.left = left + 'px'
    host.style.top = top + 'px'
    host.style.right = 'auto'
    host.style.bottom = 'auto'
  })

  pet.addEventListener('pointerup', function (event) {
    if (!drag) return
    var moved = drag.moved
    drag = null
    try { pet.releasePointerCapture(event.pointerId) } catch (err) {}
    if (!moved) {
      if (Date.now() < swallowPetClickUntil) return
      // 点小人 = 离开电脑（还没开机时先点显示器）
      if (!state.pcOn || state.away) return
      if (!card.hidden) hideCard()
      goAway()
      return
    }
    snapCheck()
    save()
  })

  // 显示器 / 椅子 / 水杯：点它们不触发拖动
  ;[pc, chair, cup].forEach(function (node) {
    node.addEventListener('pointerdown', function (event) { event.stopPropagation() })
  })
  pc.addEventListener('click', function (event) { event.stopPropagation(); togglePc() })
  chair.addEventListener('click', function (event) { event.stopPropagation(); comeBack() })
  cup.addEventListener('click', function (event) { event.stopPropagation(); drink() })
  ;[pc, chair, cup].forEach(function (node) {
    node.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      node.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
  })

  // 关页面/切换前把待写状态立刻发出去，避免刚拖完就重启导致丢位置
  window.addEventListener('pagehide', function () {
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null }
    flushState()
  })

  // 迷你杯排每秒跟一次：输入框变高、页面滚动都能贴住
  setInterval(function () {
    if (miniBar.hidden) return
    renderMini(Date.now())
    positionMiniBar()
  }, 1000)

  window.addEventListener('scroll', positionMiniBar, true)

  window.addEventListener('resize', function () {
    applyPos()
    positionPanel() // 窗口变了才重新贴一次，调整大小时不动
  })

  // 卡片/面板开关、缩放都会改变宿主尺寸；尺寸一变就按锚点重新贴位
  if (typeof ResizeObserver === 'function') {
    try { new ResizeObserver(function () { applyPos() }).observe(host) } catch (err) {}
  }

  // 多标签页同步：别的标签改了设置/暂停/提醒时间，这边跟上
  window.addEventListener('storage', function (event) {
    if (event.key !== STORAGE_KEY) return
    load()
    applyScale()
    applyPos()
    fillForm()
    paintCup()
    tick()
  })

  // 页面重新可见时立刻补一次判断（后台标签页的定时器会被节流）
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) tick()
  })

  // 开发用接口：预览页/对比页可以直接驱动状态（生产环境也留着，无副作用）
  window.__dshStandReminder = {
    preview: preview,
    drink: drink,
    drinkTo: drinkTo,
    goAway: goAway,
    comeBack: comeBack,
    setMode: setMode,
    togglePc: togglePc,
    setMini: setMini,
    // 排查位置问题用：控制台里 __dshStandReminder.debug() 能看到存档是否读回来了
    debug: function () {
      return {
        hydrated: hydrated,
        pos: JSON.parse(JSON.stringify(state.pos)),
        miniPos: state.miniPos,
        hostLeft: host.style.left,
        hostTop: host.style.top
      }
    },
    get state() { return state },
    get mode() { return host.getAttribute('data-mode') }
  }

  load()
  mount()
  setInterval(tick, TICK_MS)
})()

