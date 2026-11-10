import { formatClock, clockOf } from '../shared/time.js'
import { STORAGE_KEY } from '../shared/constants.js'
import { normalizeState } from '../shared/state.js'
import { computeBlock } from '../shared/blocking.js'
import { previewForceUnlock } from '../shared/punish.js'

const $ = (id) => document.getElementById(id)

const params = new URLSearchParams(location.search)
const host = (params.get('host') || '').trim()

const el = {
  title: $('title'),
  sub: $('sub'),
  host: $('host'),
  clock: $('clock'),
  clockLabel: $('clockLabel'),
  meta: $('meta'),
  quote: $('quote'),
  actions: $('actions'),
  pass: $('btn-pass'),
  force: $('btn-force'),
  back: $('btn-back'),
  panel: $('panel'),
  penalty: $('penalty'),
  pledgeWrap: $('pledgeWrap'),
  pledgeInput: $('pledgeInput'),
  pledgeHint: $('pledgeHint'),
  confirm: $('btn-confirm'),
  cancel: $('btn-cancel')
}

const btnContinue = document.createElement('button')
btnContinue.className = 'btn primary'
btnContinue.textContent = '继续访问'
btnContinue.hidden = true
el.actions.appendChild(btnContinue)

const btnStay = document.createElement('button')
btnStay.className = 'btn ghost'
btnStay.textContent = '留在本页'
btnStay.hidden = true
el.actions.appendChild(btnStay)

/* ---------------- 误拦自动放行 ---------------- */
const AUTO_RETURN_DELAY = 2000
let autoReturnAt = 0
let autoReturnTimer = null

function cancelAutoReturn() {
  autoReturnAt = 0
  if (autoReturnTimer) clearInterval(autoReturnTimer)
  autoReturnTimer = null
  btnStay.hidden = true
}

/**
 * 屏蔽已失效但仍被拦截（典型场景：关机期间到期，重启后 DNR 规则尚未清理），
 * 自查通过后自动把用户送回原站点，不必再点一次「继续访问」。
 */
function scheduleAutoReturn() {
  if (!host || autoReturnAt) return
  autoReturnAt = Date.now() + AUTO_RETURN_DELAY
  btnStay.hidden = false
  if (autoReturnTimer) clearInterval(autoReturnTimer)
  autoReturnTimer = setInterval(() => {
    if (!autoReturnAt) {
      clearInterval(autoReturnTimer)
      return
    }
    const left = autoReturnAt - Date.now()
    if (left <= 0) {
      clearInterval(autoReturnTimer)
      autoReturnTimer = null
      location.replace(`https://${host}/`)
      return
    }
    el.clockLabel.textContent = `屏蔽已解除 · ${Math.ceil(left / 1000)} 秒后自动返回`
  }, 200)
}

const QUOTES = [
  '你不是必须打开它。这个念头大约 90 秒就会消退。',
  '把注意力还给你自己：起身、喝水、深呼吸三次。',
  '真正的休息不是切换屏幕，而是让大脑空下来。',
  '每抵挡一次冲动，你的自控肌肉就强壮一点。',
  '问一句：打开它，是为了什么？答案往往是「无聊」。',
  '屏蔽期间，去完成那件你一直推迟的小事。',
  '你已经坚持到这里了，别在最后一公里放弃。'
]

let snapshot = null
let panelOpen = false
let calm = 10
let calmTimer = null
let pollCount = 0
let refreshing = false
let busy = false
let quoteIndex = 0

const PLEDGE = () => snapshot?.preview?.pledge || ''

function canConfirm() {
  const p = snapshot?.preview
  if (!p || busy) return false
  if (calm > 0) return false
  if (p.hardBlocked) return false
  if (p.cooldownLeft > 0) return false
  if (p.pledge && el.pledgeInput.value.trim() !== p.pledge) return false
  return true
}

function refreshConfirmState() {
  const p = snapshot?.preview
  el.confirm.disabled = !canConfirm()
  if (calm > 0) {
    el.confirm.textContent = `冷静 ${calm} 秒后可确认`
  } else if (p?.cooldownLeft > 0) {
    el.confirm.textContent = `冷却中，还需 ${Math.ceil(p.cooldownLeft / 60000)} 分钟`
  } else if (p?.hardBlocked) {
    el.confirm.textContent = '严格模式已开启'
  } else {
    el.confirm.textContent = '确认解除，接受惩罚'
  }
}

function renderClock() {
  if (!snapshot) return
  const block = snapshot.block
  if (!block.blocked) return
  const left = Math.max(0, block.until - Date.now())
  el.clock.textContent = formatClock(left)
  const cooldownLeft = snapshot.preview?.cooldownLeft || 0
  el.clockLabel.textContent =
    cooldownLeft > 0
      ? `距离解除屏蔽还剩 · 冷却中 ${Math.ceil(cooldownLeft / 60000)} 分钟`
      : left > 0
        ? `距离解除屏蔽还剩 · 预计 ${clockOf(block.until)}`
        : '屏蔽即将结束…'
}

function tag(text, cls = '') {
  const span = document.createElement('span')
  span.className = `tag ${cls}`.trim()
  span.textContent = text
  return span
}

function renderMeta() {
  el.meta.replaceChildren()
  const block = snapshot.block
  if (block.blocked) {
    for (const source of block.sources || []) {
      el.meta.appendChild(tag(source.label))
    }
    for (const source of block.sources || []) {
      if (source.type === 'schedule') {
        el.meta.appendChild(
          tag(`${clockOf(source.startAt)} - ${clockOf(source.until)}`, 'gray')
        )
      }
    }
  } else {
    el.meta.appendChild(tag('屏蔽已解除', 'green'))
  }
}

function renderPanel() {
  if (!panelOpen) {
    el.panel.hidden = true
    return
  }
  const p = snapshot?.preview
  if (!p) return
  el.panel.hidden = false
  el.penalty.replaceChildren()

  const rows = [
    ['扣除积分', `-${p.pointCost}`],
    ['进入冷却', `${p.cooldownMinutes} 分钟`],
    p.shieldAvailable ? ['消耗护盾', '1 个（保住连胜）'] : ['连胜清零', `${p.streakAtRisk} 天 → 0`],
    ['今日达标', '记为失败']
  ]
  if (p.scheduleOnly) rows.push(['定时屏蔽', `仅暂停 ${p.cooldownMinutes} 分钟`])

  for (const [label, value] of rows) {
    const li = document.createElement('li')
    const span = document.createElement('span')
    span.textContent = label
    const b = document.createElement('b')
    b.textContent = value
    li.append(span, b)
    el.penalty.appendChild(li)
  }

  const pledge = PLEDGE()
  el.pledgeWrap.hidden = !pledge
  el.pledgeHint.textContent = pledge ? `需输入：${pledge}` : ''
  refreshConfirmState()
}

function render() {
  if (!snapshot) return
  el.actions.hidden = false
  const block = snapshot.block
  const p = snapshot.preview || {}

  if (block.blocked) {
    document.title = `屏蔽中 · ${host || '专注守门员'}`
    el.title.textContent = '这个网站已被暂时屏蔽'
    el.sub.innerHTML = ''
    el.sub.append('你正在访问 ')
    const b = document.createElement('b')
    b.textContent = host || '该站点'
    el.sub.append(b, '，它位于你的自我节制黑名单中。')
    cancelAutoReturn()
    el.clock.classList.remove('unlocked')
    renderClock()
    renderMeta()

    el.pass.hidden = !(p.passAvailable && !p.hardBlocked)
    el.force.hidden = !!p.hardBlocked
    el.back.hidden = false
    btnContinue.hidden = true
    if (p.hardBlocked) {
      el.sub.append(' 严格模式下无法提前解除。')
    }
    if (p.cooldownLeft > 0 && !p.hardBlocked) {
      el.clockLabel.textContent = `距离解除屏蔽还剩 · 冷却中 ${Math.ceil(p.cooldownLeft / 60000)} 分钟`
    }
  } else {
    document.title = '屏蔽已解除'
    el.title.textContent = block.paused ? '屏蔽已暂停' : '屏蔽已解除'
    el.sub.innerHTML = ''
    if (block.paused) {
      el.sub.append(
        `当前处于${block.pausedKind === 'pass' ? '通行证豁免' : '暂停'}状态，将在 `
      )
      const b = document.createElement('b')
      b.textContent = clockOf(block.pausedUntil)
      el.sub.append(b, ' 后自动恢复屏蔽。')
    } else {
      el.sub.append('你现在可以正常访问该网站了。')
    }
    el.clock.classList.add('unlocked')
    el.clock.textContent = '已解除'
    if (!autoReturnAt) el.clockLabel.textContent = '专注守门员已放行'
    renderMeta()
    el.pass.hidden = true
    el.force.hidden = true
    el.back.hidden = true
    btnContinue.hidden = !host
    panelOpen = false
    renderPanel()
    scheduleAutoReturn()
  }
}

async function send(type, payload = {}) {
  try {
    const task = chrome.runtime.sendMessage({ type, ...payload })
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('后台无响应')), 4000)
    )
    return (await Promise.race([task, timeout])) || { ok: false }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
}

/** 后台不可用时直接读本地存储，至少能把「已屏蔽 / 剩余时间」渲染出来 */
async function readLocal() {
  try {
    const raw = await chrome.storage.local.get(STORAGE_KEY)
    const at = Date.now()
    const local = normalizeState(raw?.[STORAGE_KEY], at)
    return {
      ok: true,
      state: local,
      block: computeBlock(local, at),
      preview: previewForceUnlock(local, at),
      now: at
    }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
}

let lastFailAt = 0

function renderFailure() {
  if (snapshot) return
  document.title = '无法读取屏蔽状态'
  el.title.textContent = '读取屏蔽状态失败'
  el.sub.innerHTML = ''
  el.sub.append('扩展后台没有响应。请到 chrome://extensions 重新加载「专注守门员」后再刷新本页。')
  el.clock.textContent = '--:--'
  el.clockLabel.textContent = '后台未响应'
  el.actions.hidden = true
}

async function refresh() {
  if (refreshing) return
  refreshing = true
  let res = await send('GET_STATE')
  if (!res.ok) res = await readLocal()
  refreshing = false
  if (!res.ok) {
    const at = Date.now()
    // 失败时不要每秒重试，避免刷屏
    if (at - lastFailAt > 3000) {
      lastFailAt = at
      renderFailure()
    }
    return
  }
  snapshot = res
  render()
}

function openPanel() {
  panelOpen = true
  calm = 10
  el.pledgeInput.value = ''
  renderPanel()
  clearInterval(calmTimer)
  calmTimer = setInterval(() => {
    if (calm > 0) {
      calm -= 1
      refreshConfirmState()
    } else {
      clearInterval(calmTimer)
    }
  }, 1000)
}

function closePanel() {
  panelOpen = false
  clearInterval(calmTimer)
  renderPanel()
}

/* ---------------- 事件 ---------------- */
el.force.addEventListener('click', openPanel)
el.cancel.addEventListener('click', closePanel)

el.pass.addEventListener('click', async () => {
  if (busy) return
  busy = true
  const res = await send('UNLOCK', { mode: 'pass' })
  busy = false
  if (!res.ok) {
    alert(res.error || '通行证不足')
    return
  }
  await refresh()
})

el.confirm.addEventListener('click', async () => {
  if (!canConfirm()) return
  busy = true
  const res = await send('UNLOCK', { mode: 'force' })
  busy = false
  if (!res.ok) {
    alert(res.error || '无法解除屏蔽')
    refreshConfirmState()
    return
  }
  closePanel()
  await refresh()
})

el.back.addEventListener('click', () => {
  cancelAutoReturn()
  if (history.length > 1) history.back()
  else location.replace('about:blank')
})

btnContinue.addEventListener('click', () => {
  cancelAutoReturn()
  if (host) location.replace(`https://${host}/`)
  else location.replace('about:blank')
})

btnStay.addEventListener('click', () => {
  cancelAutoReturn()
  el.clockLabel.textContent = '已取消自动返回'
})

el.pledgeInput.addEventListener('input', refreshConfirmState)

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && panelOpen) closePanel()
})

/* ---------------- 倒计时与轮询 ---------------- */
setInterval(() => {
  if (!snapshot) {
    // 还没拿到状态（后台未响应）时也要继续重试
    pollCount += 1
    if (pollCount % 5 === 0) refresh()
    return
  }
  if (snapshot.block.blocked) {
    renderClock()
    if (snapshot.block.until - Date.now() <= 0) refresh()
  }
  pollCount += 1
  if (pollCount % 5 === 0) refresh()
  if (pollCount % 12 === 0 && snapshot.block.blocked) {
    quoteIndex = (quoteIndex + 1) % QUOTES.length
    el.quote.textContent = QUOTES[quoteIndex]
  }
}, 1000)

el.quote.textContent = QUOTES[0]
refresh()
