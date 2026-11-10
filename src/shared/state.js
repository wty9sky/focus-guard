import { STORAGE_KEY } from './constants.js'
import { dayKey, weekKey } from './time.js'

export function createDefaultState(now = Date.now()) {
  return {
    version: 1,
    sites: [],
    quickMinutes: 120,
    manual: { until: 0, startedAt: 0, plannedMinutes: 0, pointsAtStart: 0 },
    pauseUntil: 0,
    pauseKind: '',
    schedules: [],
    dailyGoalMinutes: 120,
    customRewards: [],
    reward: {
      points: 0,
      totalFocusMinutes: 0,
      todayFocusMinutes: 0,
      todayKey: dayKey(now),
      todayFailed: false,
      sessions: 0,
      streak: 0,
      bestStreak: 0,
      badges: [],
      passes: 0,
      shields: 1,
      lastShieldWeek: weekKey(now),
      accrue: { active: false, lastAt: 0 },
      history: []
    },
    punish: {
      baseCooldown: 15,
      cooldownUntil: 0,
      unlocks: [],
      hardMode: false,
      pledge: ''
    },
    redemptions: [],
    clock: {
      lastSeenAt: 0,
      jumps: 0,
      rewinds: 0,
      lastAnomalyAt: 0,
      lastAnomalyMs: 0,
      lastAnomalyKind: ''
    }
  }
}

const isPlainObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v)

/** 用默认值补齐缺失字段（升级兼容） */
function fillDefaults(target, defaults) {
  for (const [key, def] of Object.entries(defaults)) {
    const cur = target[key]
    if (cur === undefined || cur === null) {
      target[key] = Array.isArray(def) ? [] : isPlainObject(def) ? structuredClone(def) : def
    } else if (isPlainObject(def) && isPlainObject(cur)) {
      fillDefaults(cur, def)
    }
  }
  return target
}

const ARRAY_FIELDS = ['sites', 'schedules', 'customRewards', 'redemptions', 'badges', 'history', 'unlocks']
const OBJECT_FIELDS = ['manual', 'reward', 'punish', 'clock', 'accrue']

/**
 * 把任意来源的状态（旧版本、导入数据、被人手改过的存储）洗成安全结构。
 * 关键点：数组字段必须是数组，对象字段必须是对象，否则后续 for..of / .slice 会直接抛错，
 * 导致 GET_STATE 失败、弹窗一直停在「正在读取状态」。
 */
export function normalizeState(input, now = Date.now()) {
  const defaults = createDefaultState(now)
  if (!isPlainObject(input)) return defaults

  const out = { ...defaults, ...input }
  for (const key of ARRAY_FIELDS) {
    if (!Array.isArray(out[key])) out[key] = []
  }
  for (const key of OBJECT_FIELDS) {
    if (!isPlainObject(out[key])) {
      out[key] = structuredClone(defaults[key] ?? {})
    } else {
      out[key] = { ...out[key] }
    }
  }

  fillDefaults(out, defaults)

  // 数值兜底，避免 undefined / NaN 参与计算
  const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback)
  out.quickMinutes = num(out.quickMinutes, 120) || 120
  out.dailyGoalMinutes = num(out.dailyGoalMinutes, 120) || 120
  out.pauseUntil = num(out.pauseUntil, 0)
  out.pauseKind = typeof out.pauseKind === 'string' ? out.pauseKind : ''

  const r = out.reward
  for (const key of [
    'points',
    'totalFocusMinutes',
    'todayFocusMinutes',
    'sessions',
    'streak',
    'bestStreak',
    'passes',
    'shields'
  ]) {
    r[key] = num(r[key], 0)
  }
  r.todayFailed = !!r.todayFailed
  if (!isPlainObject(r.accrue)) r.accrue = { active: false, lastAt: 0 }
  r.accrue = { active: !!r.accrue.active, lastAt: num(r.accrue.lastAt, 0) }

  out.sites = out.sites.filter((s) => isPlainObject(s) && s.pattern)
  out.schedules = out.schedules.filter((s) => isPlainObject(s) && s.id)
  out.customRewards = out.customRewards.filter((s) => isPlainObject(s) && s.id)
  out.redemptions = out.redemptions.filter((s) => isPlainObject(s))
  r.badges = r.badges.filter((b) => isPlainObject(b) && b.id)
  r.history = r.history.filter((h) => isPlainObject(h))

  return out
}

export async function loadState(now = Date.now()) {
  let stored
  try {
    const raw = await chrome.storage.local.get(STORAGE_KEY)
    stored = raw?.[STORAGE_KEY]
  } catch (err) {
    console.warn('[focus-guard] 读取本地状态失败，使用默认状态', err)
    return createDefaultState(now)
  }

  if (!stored) {
    const fresh = createDefaultState(now)
    try {
      await saveState(fresh)
    } catch (err) {
      console.warn('[focus-guard] 初始化状态写入失败', err)
    }
    return fresh
  }

  return normalizeState(stored, now)
}

export async function saveState(state) {
  await chrome.storage.local.set({ [STORAGE_KEY]: state })
}

export { STORAGE_KEY }
