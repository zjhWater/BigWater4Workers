// 用 jsdom 跑一遍前端脚本，确认挂载、开关机、弹卡片、点小人/椅子、喝水、设置面板都正常
const fs = require('node:fs')
const path = require('node:path')
const { JSDOM } = require('jsdom')

const script = fs.readFileSync(path.join(__dirname, '..', 'assets', 'client.js'), 'utf8')

const dom = new JSDOM('<!doctype html><body><div id="app">dsh</div></body>', {
  url: 'http://127.0.0.1:3674/',
  pretendToBeVisual: true,
  runScripts: 'outside-only',
})
const { window } = dom
// 断言里写的是中文文案，把系统语言固定成中文（挂件默认跟随系统）
Object.defineProperty(window.navigator, 'language', { value: 'zh-CN', configurable: true })
const errors = []
window.addEventListener('error', (e) => errors.push(String(e.message)))
window.eval(script)

const host = window.document.getElementById('dsh-stand-reminder')
if (!host || !host.shadowRoot) throw new Error('挂件没有挂载到页面')
const el = (id) => host.shadowRoot.getElementById(id)
const store = () => JSON.parse(window.localStorage.getItem('dsh-stand-reminder:v1'))

const mode = () => host.getAttribute('data-mode')
const check = (label, ok) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + label); if (!ok) process.exitCode = 1 }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const isClock = (s) => /^\d{2}:\d{2}$/.test(s)
const click = (node) => node.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))

async function main() {
  // 一天里第一次打开：未开机
  check('初始是未开机状态', mode() === 'boot')
  check('屏幕/小人标了关机', host.getAttribute('data-pc') === 'off')
  check('未开机角标显示收工', el('badge').textContent === '收工' && el('badgeLabel').hidden === true)
  check('间隔默认 30 分钟', el('fInterval').value === '30')
  check('工作时段默认 09:00-18:00', el('fWorkStart').value === '09:00' && el('fWorkEnd').value === '18:00')
  check('午休默认开启且 12:00-13:30', el('fLunch').checked && el('fLunchStart').value === '12:00' && el('fLunchEnd').value === '13:30')

  // 测试时把工作时段放宽到全天，避免跑在午休/下班时段时判定成 rest
  el('fWorkStart').value = '00:00'
  el('fWorkEnd').value = '23:59'
  el('fLunch').checked = false
  el('fWorkStart').dispatchEvent(new window.Event('change'))

  // 点显示器 = 开机
  click(el('pc'))
  check('点显示器后开机进入坐姿', mode() === 'sit')
  check('开机状态写入 data-pc', host.getAttribute('data-pc') === 'on')
  check('开机后角标显示工作', el('badge').textContent === '工作')
  check('角标不再显示时间标签', el('badgeLabel').hidden === true)
  check('工作记录为自动累计（不带目标值）', el('statWorkVal').textContent.indexOf('/') === -1)
  check('开机已持久化', store().pcOn === true)

  // 触发一次提醒
  el('testNow').click()
  check('立即测试进入站姿', mode() === 'stand')
  check('提醒卡片显示', el('card').hidden === false)
  check('卡片只有标题和三个按钮', el('card').querySelector('h2').textContent === '站起来活动活动，喝点水' && el('card').querySelectorAll('.row.actions button').length === 3)
  el('ack').click()
  check('点「我站起来了」后回到坐姿', mode() === 'sit')
  check('卡片收起', el('card').hidden === true)

  // 悬停菜单按钮打开设置面板
  check('面板默认关闭时菜单可见', host.hasAttribute('data-open') === false)
  click(el('menuBtn'))
  check('点菜单按钮打开设置面板', el('panel').hidden === false)
  check('面板打开时菜单隐藏', host.hasAttribute('data-open'))
  check('间隔默认 30 分钟', el('fInterval').value === '30')
  check('面板回填放宽后的工作时段', el('fWorkStart').value === '00:00' && el('fWorkEnd').value === '23:59')
  check('午休已按测试设置关闭', el('fLunch').checked === false)
  check('面板里不再有离开/回来按钮', !el('awayBtn') && !el('backBtn'))
  check('设置面板跟随 Harness 字体', host.style.getPropertyValue('--hfont') !== '')
  check('面板打开后是固定定位', el('panel').style.position === 'fixed' && el('panel').style.left !== '' && el('panel').style.top !== '')
  const panelLeft = el('panel').style.left
  const panelTop = el('panel').style.top

  // 改间隔 → 写入 localStorage
  el('fInterval').value = '45'
  el('fInterval').dispatchEvent(new window.Event('change'))
  check('设置写入 localStorage（45 分钟）', store().settings.interval === 45)

  // 时间字号滑块：只改 --ui，不影响面板
  el('fFont').value = '40'
  el('fFont').dispatchEvent(new window.Event('input'))
  check('时间字号 40px 写入 --ui', host.style.getPropertyValue('--ui') === '40px')
  check('时间字号滑块读数同步', el('fFontVal').textContent === '40px')
  check('面板字号不跟画面字号走', el('panel').style.fontSize === '')

  // 缩放滑块 → CSS 变量
  el('fScale').value = '140'
  el('fScale').dispatchEvent(new window.Event('input'))
  check('缩放 140% 写入 --scale', host.style.getPropertyValue('--scale') === '1.4')
  check('缩放数值跟随显示', el('fScaleVal').textContent === '140%')
  el('fScale').value = '100'
  el('fScale').dispatchEvent(new window.Event('input'))

  // 滚轮缩放：每格 5%
  el('pet').dispatchEvent(new window.WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }))
  check('滚轮向上放大 5%', el('fScaleVal').textContent === '105%')
  check('缩放上限卡在 300%', (el('fScale').value = '400', el('fScale').dispatchEvent(new window.Event('input')), el('fScaleVal').textContent === '300%'))
  check('缩放下限卡在 50%', (el('fScale').value = '10', el('fScale').dispatchEvent(new window.Event('input')), el('fScaleVal').textContent === '50%'))
  el('fScale').value = '125'
  el('fScale').dispatchEvent(new window.Event('input'))
  check('调整大小时面板位置不动（不闪）', el('panel').style.left === panelLeft && el('panel').style.top === panelTop)

  // 水杯：桌面上的杯子从空开始，按时间慢慢涨，喝水就清零
  check('水杯初始是空的', el('cupWater').style.transform === 'scaleY(0.0000)')
  // 直接把喝水进度写成 30 分钟，模拟过了半小时
  const s0 = store()
  s0.waterMs = 30 * 60000
  window.localStorage.setItem('dsh-stand-reminder:v1', JSON.stringify(s0))
  window.dispatchEvent(new window.StorageEvent('storage', { key: 'dsh-stand-reminder:v1' }))
  const level = parseFloat((el('cupWater').style.transform.match(/scaleY\(([\d.]+)\)/) || [0, 0])[1])
  check('水杯按时间涨到中间水位', level > 0.05 && level < 0.95)
  click(el('cup'))
  check('点水杯后水位清零', el('cupWater').style.transform === 'scaleY(0.0000)')
  check('喝水进度已持久化', store().waterMs === 0)
  // 已喝 X / 目标 8 杯：点杯子加一，目标可改
  check('目标默认 8 杯', el('fWaterGoal').value === '8')
  check('点过杯子后计数是 1', el('drinkCount').textContent === '1' && store().drinks === 1)
  click(el('cup'))
  check('再点一次计数变 2', el('drinkCount').textContent === '2' && store().drinks === 2)
  el('fWaterGoal').value = '10'
  el('fWaterGoal').dispatchEvent(new window.Event('change'))
  check('目标杯数写入 localStorage', store().settings.waterGoal === 10)

  // 提示音量滑块：拖动即存，标签跟着变
  el('fVolume').value = '100'
  el('fVolume').dispatchEvent(new window.Event('input'))
  check('音量 100% 落盘并更新标签', store().settings.volume === 100 && el('fVolumeVal').textContent === '100%')
  check('提示里出现反推的间隔', /约 \d+ 分钟一杯/.test(el('waterNote').textContent))
  // 关掉喝水提醒：水杯保持空
  el('fWaterOn').checked = false
  el('fWaterOn').dispatchEvent(new window.Event('change'))
  check('关掉喝水提醒后水杯是空的', el('cupWater').style.transform === 'scaleY(0.0000)')
  el('fWaterOn').checked = true
  el('fWaterOn').dispatchEvent(new window.Event('change'))

  // 工作时长显示开关
  el('fShowWork').checked = false
  el('fShowWork').dispatchEvent(new window.Event('change'))
  check('关掉工作记录后统计行隐藏', el('statWork').hidden === true)

  // 点面板内部不关闭，点面板外面自动收起
  el('fShowWork').dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, pointerId: 11 }))
  check('点面板内部不会关闭', el('panel').hidden === false)
  window.document.body.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, pointerId: 12 }))
  check('点面板外面自动关闭', el('panel').hidden === true)
  el('menuBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  check('再点菜单可以重新打开', el('panel').hidden === false)

  // 拖动 → 松手吸附（jsdom 没有布局，小人中心按 0 算，必定落在左侧吸附区）
  const pet = el('pet')
  pet.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 3, clientX: 200, clientY: 300 }))
  pet.dispatchEvent(new window.PointerEvent('pointermove', { bubbles: true, button: 0, pointerId: 3, clientX: 120, clientY: 260 }))
  pet.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 3, clientX: 120, clientY: 260 }))
  check('拖动后吸附到左边并写入锚点', store().pos.h === 'left' && store().pos.hOff === 0)
  check('贴左时场景镜像', host.hasAttribute('data-flip'))

  // 关面板，保证下面点小人不会误触
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  check('Esc 关闭设置面板', el('panel').hidden === true)
  check('关闭后清掉固定定位', el('panel').style.position === '')

  // 点小人 = 离开电脑
  pet.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 4, clientX: 200, clientY: 300 }))
  pet.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 4, clientX: 200, clientY: 300 }))
  check('点小人后进入离开动画', mode() === 'leaving')
  check('离开时角标显示离开', el('badge').textContent === '离开')
  await sleep(1300)
  check('动画结束后是离开状态', mode() === 'away')
  check('离开状态已持久化', store().away === true)

  // 点椅子 = 回来
  click(el('chair'))
  check('点椅子后进入回位动画', mode() === 'returning')
  await sleep(1300)
  check('动画结束后回到坐姿', mode() === 'sit')
  check('回来后重新计时并回到工作状态', el('badge').textContent === '工作' && window.__dshStandReminder.state.nextDueAt > Date.now())
  check('回来状态已持久化', store().away === false)

  // 点显示器 = 收工（翘腿）
  click(el('pc'))
  check('再点显示器后收工翘腿', mode() === 'off')
  check('收工角标显示收工', el('badge').textContent === '收工')
  check('收工状态已持久化', store().pcOn === false && store().offWork === true)
  check('收工后数据仍保留', store().drinks === 2)

  // 再点显示器 = 重新开机
  click(el('pc'))
  check('收工后再点显示器可以重新开机', mode() === 'sit' && host.getAttribute('data-pc') === 'on')
  check('开机后今日累计清零', store().drinks === 0 && store().waterMs === 0 && store().workedMs === 0 && el('drinkCount').textContent === '0')

  // 动作和状态必须一一对应：翘腿=收工、敲键盘（坐姿）=工作、空椅子=离开
  const api = window.__dshStandReminder
  const badgeFor = (m) => { api.setMode(m); return el('badge').textContent }
  check('站姿（提醒中）算工作', badgeFor('stand') === '工作')
  check('举杯喝水算工作', badgeFor('sip') === '工作')
  check('起身离开算离开', badgeFor('leaving') === '离开')
  check('人不在椅子前算离开', badgeFor('away') === '离开')
  check('走回来算离开', badgeFor('returning') === '离开')
  check('翘腿收工算收工', badgeFor('off') === '收工')
  check('未开机算收工', badgeFor('boot') === '收工')
  check('今天不再提醒（翘腿）算收工', badgeFor('paused') === '收工')
  check('坐回工位算工作', badgeFor('sit') === '工作')

  // 迷你模式：收起到输入框底部的杯排
  el('miniBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  check('点最小化进入迷你模式', host.hasAttribute('data-mini'))
  check('迷你模式显示杯排', el('miniBar').hidden === false)
  check('杯排数量等于目标杯数', el('miniCups').children.length === Number(el('fWaterGoal').value))
  check('第一杯开始蓄水（其余是空的）', el('miniCups').children[0].className.indexOf('empty') < 0 && el('miniCups').children[1].className.indexOf('empty') >= 0)
  el('miniCups').children[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  check('点第一杯算喝掉', el('miniCups').children[0].className.indexOf('done') >= 0 && store().drinks === 1)
  check('喝完后第二杯接上', el('miniCups').children[1].className.indexOf('empty') < 0)
  el('miniCups').children[3].dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  check('点第 4 杯把前面的都算掉', store().drinks === 4 && el('miniCups').children[2].className.indexOf('done') >= 0)
  check('迷你模式持久化', store().settings.mini === true)

  // 迷你模式也要能看设置：齿轮按钮
  el('miniGear').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  check('迷你模式可以打开设置', el('panel').hidden === false)
  check('迷你模式设置面板是 fixed 定位', el('panel').style.position === 'fixed')
  el('miniGear').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  check('再点齿轮收起设置', el('panel').hidden === true)

  // 杯排可以拖走，松手记住坐标；双击回到跟随输入框
  const bar = el('miniBar')
  bar.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 21, clientX: 100, clientY: 300 }))
  bar.dispatchEvent(new window.PointerEvent('pointermove', { bubbles: true, button: 0, pointerId: 21, clientX: 40, clientY: 250 }))
  bar.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 21, clientX: 40, clientY: 250 }))
  check('拖动杯排后记住坐标', store().miniPos && typeof store().miniPos.left === 'number' && typeof store().miniPos.top === 'number')
  // 按在杯子上开始拖：也应该能动，而且不能顺手把水喝掉
  const drinksBefore = store().drinks
  const cup0 = el('miniCups').children[store().drinks]
  if (cup0) {
    cup0.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 22, clientX: 200, clientY: 300 }))
    bar.dispatchEvent(new window.PointerEvent('pointermove', { bubbles: true, button: 0, pointerId: 22, clientX: 150, clientY: 260 }))
    bar.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 22, clientX: 150, clientY: 260 }))
    check('按住杯子也能拖动杯排', store().miniPos && typeof store().miniPos.top === 'number')
    check('拖动不会误算喝一杯', store().drinks === drinksBefore)
  }
  bar.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }))
  check('双击杯排恢复跟随输入框', store().miniPos === null)
  el('miniRestore').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  check('点加号回到完整挂件', !host.hasAttribute('data-mini') && el('miniBar').hidden === true)

  // 恢复成完整挂件后要按锚点重新贴位（否则会停在 CSS 默认位置，看着像被重置）
  host.style.left = ''
  host.style.top = ''
  window.__dshStandReminder.setMini(true)
  window.__dshStandReminder.setMini(false)
  check('回到完整挂件后重新贴位', host.style.left !== '' && host.style.top !== '')

  // 语言切换：默认跟随系统（这里 stub 成 zh-CN），手动切到 English 后所有文案跟着换
  check('语言默认跟随系统', el('fLang').value === 'auto')
  check('中文时卡片标题是中文', el('card').querySelector('h2').textContent === '站起来活动活动，喝点水')
  check('中文时角标是中文', ['工作', '离开', '收工'].indexOf(el('badge').textContent) >= 0)

  window.__dshStandReminder.setMini(false)
  el('miniGear').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  el('fLang').value = 'en'
  el('fLang').dispatchEvent(new window.Event('change', { bubbles: true }))
  check('切到英文后卡片标题变英文', el('card').querySelector('h2').textContent === 'Time to stand up and drink some water')
  check('切到英文后角标变英文', ['Working', 'Away', 'Off'].indexOf(el('badge').textContent) >= 0)
  check('切到英文后面板标签变英文', el('fInterval').parentElement.querySelector('span').textContent === 'Remind every')
  check('切到英文后喝水提示是英文', /one cup every \d+ min/.test(el('waterNote').textContent))
  check('切到英文后按钮是英文', el('ack').textContent === 'I stood up!')
  check('语言选择写入存档', store().settings.lang === 'en')

  el('fLang').value = 'zh'
  el('fLang').dispatchEvent(new window.Event('change', { bubbles: true }))
  check('切回中文后文案恢复', el('ack').textContent === '我站起来了！' && /约 \d+ 分钟一杯/.test(el('waterNote').textContent))
  el('fLang').value = 'auto'
  el('fLang').dispatchEvent(new window.Event('change', { bubbles: true }))
  check('切回跟随系统用中文', el('ack').textContent === '我站起来了！' && store().settings.lang === 'auto')
  el('panelClose').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))

  check('运行期没有未捕获错误', errors.length === 0)
  if (errors.length) console.log(errors)
  window.close()
}

main()
