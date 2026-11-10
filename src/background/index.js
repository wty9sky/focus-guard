import {
  BLOCK_PAGE,
  END_ALARM,
  PUNISH_LIMITS,
  QUERY_FLAG,
  RULE_ID_BASE,
  SESSION_KEY,
  SHOP_ITEMS,
  TICK_ALARM
} from '../shared/constants.js'
import { computeBlock, nextScheduleStart, normalizePattern, patternToFilter } from '../shared/blocking.js'
import { createDefaultState, loadState, saveState } from '../shared/state.js'
import { accruePoints, settleDays } from '../shared/reward.js'
import { applyForceUnlock, applyPassUnlock, previewForceUnlock } from '../shared/punish.js'
import { guardClock } from '../shared/clock.js'
import { MINUTE } from '../shared/time.js'

const EMPTY_MANUAL = { until: 0, startedAt: 0, plannedMinutes: 0, pointsAtStart: 0 }
const MAX_RULES = 2000
/** 本浏览器会话内的时间观测锚点（session 存储在浏览器退出后自动清空） */
const CLOCK_ANCHOR_KEY = 'fg.clock.anchor'
const uid = () => crypto.randomUUID()

/* ---------------- 串行化，避免并发写 ----------------- */
/** 单次任务的最长等待时间：超时就不再排队，避免某个 API 卡死把整条链路堵住 */
const LOCK_TIMEOUT = 5_000
let chain = Promise.resolve()

function exclusive(fn) {
  const run = chain.then(fn, fn)
  chain = run.then(
    () => undefined,
    () => undefined
  )

  let timer = null
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => {
      // 队列已被污染（上一个任务卡住），直接重置，让后续请求能继续
      chain = Promise.resolve()
      reject(new Error('后台处理超时，请重试'))
    }, LOCK_TIMEOUT)
  })

  return Promise.race([run, guard]).finally(() => clearTimeout(timer))
}

/** 某些环境（极旧的 Chromium / 特殊构建）可能没有 storage.session，降级到内存 */
const memorySession = new Map()
const sessionArea = () =>
  chrome.storage?.session || {
    async get(keys) {
      const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys || {})
      return Object.fromEntries(list.filter((k) => memorySession.has(k)).map((k) => [k, memorySession.get(k)]))
    },
    async set(obj) {
      for (const [k, v] of Object.entries(obj || {})) memorySession.set(k, v)
    }
  }

async function sessionGet(keys) {
  try {
    return await sessionArea().get(keys)
  } catch (err) {
    console.warn('[focus-guard] session 存储读取失败', err)
    return {}
  }
}

async function sessionSet(obj) {
  try {
    await sessionArea().set(obj)
  } catch (err) {
    console.warn('[focus-guard] session 存储写入失败', err)
  }
}

/* ---------------- 状态刷新与规则同步 ----------------- */
/**
 * 时钟守卫：把「改系统时间」变成无效操作。
 * 跳变/回拨时按真实流逝重新锚定屏蔽截止时间，并记录异常供状态页展示。
 */
async function applyClockGuard(state, now) {
  const cached = await sessionGet(CLOCK_ANCHOR_KEY)
  const anchor = cached?.[CLOCK_ANCHOR_KEY]
  const anomaly = guardClock(state, now, {
    present: !!anchor,
    lastAt: anchor?.at
  })
  await sessionSet({ [CLOCK_ANCHOR_KEY]: { at: now } })
  if (anomaly) {
    console.warn('[focus-guard] 检测到系统时间被调整', anomaly)
  }
  return anomaly
}

/**
 * 刷新状态：loadState 之外的一切都是「尽力而为」，
 * 任何一步失败都不能让 GET_STATE 整条失败（否则弹窗会永远停在「正在读取状态」）。
 */
async function refreshState(now = Date.now()) {
  const state = await loadState(now)
  const sig = (s) =>
    [
      s.reward.todayKey,
      s.reward.todayFocusMinutes,
      s.reward.points,
      s.reward.streak,
      s.reward.totalFocusMinutes,
      s.reward.shields,
      s.manual.until,
      s.pauseUntil,
      s.punish.cooldownUntil,
      s.reward.accrue?.active ? 1 : 0,
      Math.floor((s.reward.accrue?.lastAt || 0) / MINUTE),
      s.clock?.jumps,
      s.clock?.rewinds,
      Math.floor((s.clock?.lastSeenAt || 0) / MINUTE)
    ].join('|')
  const before = sig(state)

  try {
    await applyClockGuard(state, now)
  } catch (err) {
    console.warn('[focus-guard] 时钟守卫失败', err)
  }

  try {
    settleDays(state, now)
  } catch (err) {
    console.warn('[focus-guard] 跨天结算失败', err)
  }

  const block = computeBlock(state, now)

  try {
    accruePoints(state, block, now)
  } catch (err) {
    console.warn('[focus-guard] 积分结算失败', err)
  }

  const dirty = sig(state) !== before
  if (dirty) {
    try {
      await saveState(state)
    } catch (err) {
      console.warn('[focus-guard] 状态保存失败', err)
    }
  }
  return { state, block, dirty }
}

function buildRules(sites, withHostParam) {
  return sites.map((site, index) => {
    const path = withHostParam
      ? `/${BLOCK_PAGE}?host=${encodeURIComponent(site.pattern)}`
      : `/${BLOCK_PAGE}`
    return {
      id: RULE_ID_BASE + index,
      priority: 1,
      action: { type: 'redirect', redirect: { extensionPath: path } },
      condition: {
        urlFilter: patternToFilter(site.pattern),
        resourceTypes: ['main_frame']
      }
    }
  })
}

async function syncRules(state, now = Date.now()) {
  const block = computeBlock(state, now)
  const dnr = chrome.declarativeNetRequest
  if (!dnr?.updateDynamicRules) return block

  const sites = (state.sites || []).slice(0, MAX_RULES)
  const signature = block.blocked ? sites.map((s) => s.pattern).join(',') : ''

  const cached = await sessionGet([SESSION_KEY, QUERY_FLAG])
  if (cached?.[SESSION_KEY] === signature) return block

  const existing = await dnr.getDynamicRules()
  const removeRuleIds = existing.map((r) => r.id)
  const withHostParam = cached?.[QUERY_FLAG] !== false

  if (removeRuleIds.length || block.blocked) {
    const apply = (rules) => dnr.updateDynamicRules({ removeRuleIds, addRules: rules })

    try {
      await apply(block.blocked ? buildRules(sites, withHostParam) : [])
    } catch (err) {
      // 某些 Chrome 版本不接受带查询串的 extensionPath，降级为不带站点信息
      if (!block.blocked || !withHostParam) throw err
      await sessionSet({ [QUERY_FLAG]: false })
      await apply(buildRules(sites, false))
    }
  }

  await sessionSet({ [SESSION_KEY]: signature })
  return block
}

let lastBadge = null
async function updateBadge(block, now = Date.now()) {
  const text = block.blocked
    ? (() => {
        const mins = Math.max(1, Math.ceil((block.until - now) / MINUTE))
        return mins >= 60 ? `${Math.round(mins / 60)}h` : `${mins}m`
      })()
    : ''
  if (text === lastBadge) return
  lastBadge = text
  await chrome.action.setBadgeText({ text })
  if (text) await chrome.action.setBadgeBackgroundColor({ color: '#F53F3F' })
}

async function ensureAlarms(block, state, now = Date.now()) {
  const tick = await chrome.alarms.get(TICK_ALARM)
  if (!tick) {
    // 首次 15 秒后就校正一次，尽量缩短「浏览器重启后规则残留」的时间窗，之后每分钟一次
    await chrome.alarms.create(TICK_ALARM, { when: now + 15_000, periodInMinutes: 1 })
  }

  await chrome.alarms.clear(END_ALARM)
  const target = block.blocked ? block.until : nextScheduleStart(state, now)
  if (target && target > now) {
    await chrome.alarms.create(END_ALARM, { when: Math.max(now + 5_000, target + 500) })
  }
}

/** 规则同步最多等这么久，卡住就直接用内存里的屏蔽状态顶上，不让消息通道跟着卡死 */
const RULE_SYNC_TIMEOUT = 1500

/** 规则同步失败不应影响状态读写，宁可降级也不能让后台整条链路报错 */
async function safeSync(state, now) {
  try {
    const task = syncRules(state, now)
    // 超时后原任务可能仍会 reject，先挂一个 handler，避免未处理异常
    task.catch(() => {})
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), RULE_SYNC_TIMEOUT))
    const block = await Promise.race([task, timeout])
    if (block) return block
    console.warn('[focus-guard] 规则同步超时，本次跳过')
    return computeBlock(state, now)
  } catch (err) {
    console.warn('[focus-guard] 规则同步失败', err)
    return computeBlock(state, now)
  }
}

/** 角标 / 闹钟都是锦上添花，失败也不能影响主流程 */
async function safeUi(block, state, now) {
  try {
    await updateBadge(block, now)
  } catch (err) {
    console.warn('[focus-guard] 角标更新失败', err)
  }
  try {
    await ensureAlarms(block, state, now)
  } catch (err) {
    console.warn('[focus-guard] 闹钟注册失败', err)
  }
}

async function commit(state, now, extra = {}) {
  await saveState(state)
  const block = await safeSync(state, now)
  await safeUi(block, state, now)
  return {
    ok: true,
    state,
    block,
    now,
    preview: previewForceUnlock(state, now),
    ...extra
  }
}

async function runTick() {
  return exclusive(async () => {
    const now = Date.now()
    const { state } = await refreshState(now)
    const block = await safeSync(state, now)
    await safeUi(block, state, now)
    return { ok: true, state, block, now, preview: previewForceUnlock(state, now) }
  })
}

/* ---------------- 业务动作 ----------------- */
async function handleMessage(message) {
  const type = message?.type
  const now = Date.now()

  if (type === 'GET_STATE') {
    return exclusive(async () => {
      const { state } = await refreshState(now)
      const block = await safeSync(state, now)
      await safeUi(block, state, now)
      return {
        ok: true,
        state,
        block,
        now,
        preview: previewForceUnlock(state, now)
      }
    })
  }

  return exclusive(async () => {
    const at = Date.now()
    const state = await loadState()
    // 任何写操作前都先做一次时钟守卫，避免基于被人为调整过的时间做判断
    try {
      await applyClockGuard(state, at)
    } catch (err) {
      console.warn('[focus-guard] 时钟守卫失败', err)
    }

    switch (type) {
      /* ---- 一键屏蔽 ---- */
      case 'BLOCK_NOW': {
        const minutes = Math.max(1, Math.min(1440, Math.round(Number(message.minutes) || state.quickMinutes || 120)))
        state.quickMinutes = minutes
        state.manual = {
          until: at + minutes * MINUTE,
          startedAt: at,
          plannedMinutes: minutes,
          pointsAtStart: state.reward.points
        }
        state.pauseUntil = 0
        state.pauseKind = ''
        // 立刻落下计分锚点，否则第一分钟会被丢掉（用户会觉得「计时了却没加分」）
        state.reward.accrue = { active: true, lastAt: at }
        return commit(state, at, { message: `已屏蔽 ${minutes} 分钟` })
      }

      /* ---- 解除屏蔽 ---- */
      case 'UNLOCK': {
        const mode = message.mode || 'force'
        if (mode === 'pass') {
          const minutes = Number(message.minutes) || 30
          const res = applyPassUnlock(state, minutes, at)
          if (!res.ok) return commit(state, at, { ok: false, error: '通行证不足' })
          return commit(state, at, { message: `已使用通行证，豁免 ${minutes} 分钟` })
        }
        if (message.previewOnly) {
          return { ok: true, state, block: computeBlock(state, at), preview: previewForceUnlock(state, at) }
        }
        const res = applyForceUnlock(state, at)
        if (!res.ok) {
          const reasonMap = {
            cooldown: '冷却期内无法解除屏蔽',
            'hard-mode': '严格模式已开启，需等待自动结束或使用通行证',
            'not-blocked': '当前没有生效中的屏蔽'
          }
          return { ok: false, error: reasonMap[res.reason] || '无法解除', state, preview: res.preview }
        }
        return commit(state, at, { preview: res.preview })
      }

      /* ---- 黑名单 ---- */
      case 'ADD_SITE': {
        const pattern = normalizePattern(message.pattern)
        if (!pattern) return { ok: false, error: '域名格式不正确，例如 bilibili.com', state }
        if ((state.sites || []).some((s) => s.pattern === pattern)) {
          return { ok: false, error: `${pattern} 已在黑名单中`, state }
        }
        state.sites = [
          ...(state.sites || []),
          { id: uid(), pattern, createdAt: at, note: message.note || '' }
        ]
        return commit(state, at, { message: `已加入黑名单：${pattern}` })
      }
      case 'REMOVE_SITE': {
        state.sites = (state.sites || []).filter((s) => s.id !== message.id)
        return commit(state, at, { message: '已从黑名单移除' })
      }
      case 'CLEAR_SITES': {
        state.sites = []
        return commit(state, at, { message: '黑名单已清空' })
      }

      /* ---- 定时屏蔽 ---- */
      case 'SAVE_SCHEDULE': {
        const input = message.schedule || {}
        const days = Array.isArray(input.days) ? input.days.map(Number) : []
        if (!days.length) return { ok: false, error: '请至少选择一天', state }
        if (!input.start || !input.end) return { ok: false, error: '请填写开始与结束时间', state }
        const payload = {
          id: input.id || uid(),
          name: (input.name || '').trim() || '专注时段',
          start: input.start,
          end: input.end,
          days,
          enabled: input.enabled !== false
        }
        const list = state.schedules || []
        state.schedules = list.some((s) => s.id === payload.id)
          ? list.map((s) => (s.id === payload.id ? payload : s))
          : [...list, payload]
        return commit(state, at, { message: '定时屏蔽已保存' })
      }
      case 'TOGGLE_SCHEDULE': {
        state.schedules = (state.schedules || []).map((s) =>
          s.id === message.id ? { ...s, enabled: !s.enabled } : s
        )
        return commit(state, at, {})
      }
      case 'REMOVE_SCHEDULE': {
        state.schedules = (state.schedules || []).filter((s) => s.id !== message.id)
        return commit(state, at, { message: '定时屏蔽已删除' })
      }

      /* ---- 设置 ---- */
      case 'UPDATE_SETTINGS': {
        const patch = message.patch || {}
        if (patch.quickMinutes != null) {
          state.quickMinutes = Math.max(1, Math.min(1440, Math.round(Number(patch.quickMinutes) || 120)))
        }
        if (patch.dailyGoalMinutes != null) {
          state.dailyGoalMinutes = Math.max(
            PUNISH_LIMITS.dailyGoal.min,
            Math.min(PUNISH_LIMITS.dailyGoal.max, Math.round(Number(patch.dailyGoalMinutes)))
          )
        }
        if (patch.baseCooldown != null) {
          state.punish.baseCooldown = Math.max(
            PUNISH_LIMITS.baseCooldown.min,
            Math.min(PUNISH_LIMITS.baseCooldown.max, Math.round(Number(patch.baseCooldown)))
          )
        }
        if (patch.hardMode != null) state.punish.hardMode = !!patch.hardMode
        if (patch.pledge != null) state.punish.pledge = String(patch.pledge).slice(0, 40)
        return commit(state, at, { message: '设置已保存' })
      }

      /* ---- 兑换 ---- */
      case 'REDEEM': {
        const item = SHOP_ITEMS.find((i) => i.id === message.id)
        const custom = (state.customRewards || []).find((i) => i.id === message.id)
        const target = item || custom
        if (!target) return { ok: false, error: '奖励不存在', state }
        const cost = Number(target.cost) || 0
        if (state.reward.points < cost) return { ok: false, error: '积分不足', state }

        if (target.kind === 'shield' && (state.reward.shields || 0) >= (target.max || 3)) {
          return { ok: false, error: '护盾已达上限', state }
        }
        state.reward.points -= cost
        if (target.kind === 'pass') state.reward.passes = (state.reward.passes || 0) + 1
        else if (target.kind === 'shield') state.reward.shields = (state.reward.shields || 0) + 1

        state.redemptions = [
          { id: uid(), itemId: target.id, name: target.name, cost, at, kind: target.kind || 'custom' },
          ...(state.redemptions || [])
        ].slice(0, 60)
        return commit(state, at, { message: `已兑换：${target.name}` })
      }
      case 'ADD_CUSTOM_REWARD': {
        const name = (message.name || '').trim()
        const cost = Math.max(1, Math.round(Number(message.cost) || 100))
        if (!name) return { ok: false, error: '请填写奖励名称', state }
        state.customRewards = [
          ...(state.customRewards || []),
          { id: uid(), name, cost, kind: 'custom', desc: '自定义现实奖励' }
        ]
        return commit(state, at, { message: '现实奖励已添加' })
      }
      case 'REMOVE_CUSTOM_REWARD': {
        state.customRewards = (state.customRewards || []).filter((r) => r.id !== message.id)
        return commit(state, at, {})
      }

      /* ---- 数据 ---- */
      case 'RESET_STATS': {
        const fresh = createDefaultState(at)
        fresh.sites = state.sites
        fresh.schedules = state.schedules
        fresh.quickMinutes = state.quickMinutes
        fresh.dailyGoalMinutes = state.dailyGoalMinutes
        fresh.punish.baseCooldown = state.punish.baseCooldown
        fresh.punish.hardMode = state.punish.hardMode
        fresh.punish.pledge = state.punish.pledge
        fresh.customRewards = state.customRewards
        return commit(fresh, at, { message: '统计数据已重置' })
      }
      case 'IMPORT_DATA': {
        try {
          const data = typeof message.data === 'string' ? JSON.parse(message.data) : message.data
          if (!data || typeof data !== 'object') throw new Error('数据格式不正确')
          const merged = { ...createDefaultState(at), ...data }
          return commit(merged, at, { message: '数据已导入' })
        } catch (err) {
          return { ok: false, error: `导入失败：${err.message}`, state }
        }
      }

      default:
        return { ok: false, error: `未知指令: ${type}`, state }
    }
  })
}

/* ---------------- 事件绑定 ----------------- */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }))
  return true
})

chrome.runtime.onInstalled.addListener(() => {
  runTick().catch(() => {})
})

chrome.runtime.onStartup.addListener(() => {
  runTick().catch(() => {})
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === TICK_ALARM || alarm.name === END_ALARM) runTick().catch(() => {})
})

// Service Worker 被唤醒时立即校正一次状态
runTick().catch(() => {})
