import { BADGE_DEFS } from './constants.js'
import { MINUTE, addDaysToKey, todayKey, weekKey } from './time.js'

/** 每分钟积分倍率：定时屏蔽略高于手动（更难临时取消），严格模式额外加成 */
export function rateFor(block, state) {
  let rate = 1
  const hasSchedule = (block?.sources || []).some((s) => s.type === 'schedule')
  if (hasSchedule) rate *= 1.2
  if (state.punish?.hardMode) rate *= 1.5
  return Math.round(rate * 100) / 100
}

/** 记一笔专注：分钟数 -> 积分 / 时长 / 徽章 */
function credit(state, block, minutes) {
  if (!(minutes > 0)) return 0
  const r = state.reward
  const gained = Math.round(minutes * rateFor(block, state))
  r.points += gained
  r.totalFocusMinutes += minutes
  r.todayFocusMinutes += minutes
  r.sessions = (r.sessions || 0) + 1
  checkBadges(state)
  return gained
}

/**
 * 屏蔽结束时的「零头结算」：不足一分钟的尾巴也尽量记上，
 * 否则 25 分钟的屏蔽常常只结算 24 分钟，用户会觉得「计时完成却没加分」。
 */
function flushTail(state, block, now) {
  const r = state.reward
  const a = r.accrue
  if (!a?.active || !a.lastAt) return 0
  const manualEnd = Number(state.manual?.until) || 0
  // 手动屏蔽以计划结束时间为界，避免关机很久后一次性补进几小时
  const end = Math.min(now, manualEnd > a.lastAt ? manualEnd : now)
  const left = end - a.lastAt
  if (left <= 0) return 0
  const minutes = Math.min(240, Math.round(left / MINUTE))
  if (minutes <= 0) return 0
  return credit(state, block, minutes)
}

/**
 * 累积专注时长与积分（按整分钟结算，幂等）
 * @returns {number} 本次新增积分
 */
export function accruePoints(state, block, now = Date.now()) {
  const r = state.reward
  if (!r.accrue) r.accrue = { active: false, lastAt: 0 }

  if (!block?.blocked) {
    const gained = flushTail(state, block, now)
    r.accrue = { active: false, lastAt: 0 }
    return gained
  }

  if (!r.accrue.active || !r.accrue.lastAt) {
    r.accrue = { active: true, lastAt: now }
    return 0
  }

  // 时钟回拨：把锚点拉回当前时间，宁可少算也不要算出负数
  if (now < r.accrue.lastAt) {
    r.accrue.lastAt = now
    return 0
  }

  const elapsed = now - r.accrue.lastAt
  const wholeMinutes = Math.floor(elapsed / MINUTE)
  if (wholeMinutes <= 0) return 0

  r.accrue.lastAt += wholeMinutes * MINUTE
  return credit(state, block, wholeMinutes)
}

/** 结算徽章 */
export function checkBadges(state) {
  const r = state.reward
  if (!Array.isArray(r.badges)) r.badges = []
  const owned = new Set(r.badges.map((b) => b.id))
  const gained = []
  for (const def of BADGE_DEFS) {
    if (owned.has(def.id)) continue
    let ok = false
    if (def.type === 'hours') ok = r.totalFocusMinutes >= def.value * 60
    else if (def.type === 'streak') ok = r.streak >= def.value
    else if (def.type === 'session') ok = (r.sessions || 0) >= def.value
    if (ok) {
      r.badges.push({ id: def.id, name: def.name, at: Date.now() })
      r.points += def.bonus || 0
      gained.push(def)
    }
  }
  return gained
}

function grantWeeklyShield(state, now) {
  const r = state.reward
  const wk = weekKey(now)
  if (r.lastShieldWeek !== wk) {
    r.lastShieldWeek = wk
    r.shields = Math.min(3, (r.shields || 0) + 1)
  }
}

/**
 * 跨天结算：达标则连胜 +1 并发放达标奖励分，未达标则连胜清零
 */
export function settleDays(state, now = Date.now()) {
  const r = state.reward
  const goal = state.dailyGoalMinutes || 0
  const today = todayKey(now)
  let guard = 0

  while (r.todayKey !== today && guard++ < 400) {
    const minutes = r.todayFocusMinutes || 0
    const ok = !r.todayFailed && minutes >= goal
    if (ok) {
      r.streak = (r.streak || 0) + 1
      r.bestStreak = Math.max(r.bestStreak || 0, r.streak)
      r.points += Math.round(goal * 0.6)
    } else {
      r.streak = 0
    }
    if (!Array.isArray(r.history)) r.history = []
    r.history = [{ day: r.todayKey, minutes, ok }, ...r.history].slice(0, 90)
    r.todayKey = addDaysToKey(r.todayKey, 1)
    r.todayFocusMinutes = 0
    r.todayFailed = false
  }

  grantWeeklyShield(state, now)
  checkBadges(state)
  return r.streak
}
