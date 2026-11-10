import { PUNISH_LIMITS } from './constants.js'
import { computeBlock } from './blocking.js'
import { rateFor } from './reward.js'
import { DAY, MINUTE } from './time.js'

const EMPTY_MANUAL = { until: 0, startedAt: 0, plannedMinutes: 0, pointsAtStart: 0 }

/**
 * 计算「提前解除」的代价预览（纯函数，不改状态）
 */
export function previewForceUnlock(state, now = Date.now()) {
  const punish = state.punish || {}
  const reward = state.reward || {}
  const block = computeBlock(state, now)

  const cooldownLeft = Math.max(0, (punish.cooldownUntil || 0) - now)
  const recent = (punish.unlocks || []).filter((u) => now - u.at < DAY)
  const nth = recent.length + 1

  const base = punish.baseCooldown || 15
  const cooldownMinutes = Math.min(
    Math.round(base * Math.pow(2, nth - 1)),
    PUNISH_LIMITS.cooldownCap
  )

  // 本次屏蔽的起点：所有生效来源中最早的开始时间
  const starts = (block.sources || []).map((s) => s.startAt).filter(Boolean)
  const sessionStart = starts.length ? Math.min(...starts) : now
  const sessionMinutes = Math.max(0, Math.round((now - sessionStart) / MINUTE))
  // 本次已获积分按会话时长 × 当前倍率估算；罚没 = 收益的 50% + 固定 30 分 × 档位（最多 3 档）
  const sessionPoints = Math.round(sessionMinutes * rateFor(block, state))
  const rawCost = Math.round(sessionPoints * 0.5) + 30 * Math.min(nth, 3)
  const pointCost = Math.min(reward.points || 0, rawCost)

  const scheduleOnly =
    block.sources.length > 0 && block.sources.every((s) => s.type === 'schedule')

  return {
    blocked: block.blocked,
    sources: block.sources,
    until: block.until,
    cooldownLeft,
    nth,
    cooldownMinutes,
    rawCost,
    pointCost,
    sessionMinutes,
    sessionPoints,
    streakAtRisk: reward.streak || 0,
    shieldAvailable: (reward.shields || 0) > 0,
    passAvailable: (reward.passes || 0) > 0,
    hardBlocked: !!punish.hardMode,
    scheduleOnly,
    pledge: punish.pledge || ''
  }
}

/**
 * 执行「提前解除」：扣分 + 冷却 + 连胜清零（有护盾则抵挡一次）
 */
export function applyForceUnlock(state, now = Date.now()) {
  const preview = previewForceUnlock(state, now)
  if (!preview.blocked) return { ok: false, reason: 'not-blocked', preview }
  if (preview.cooldownLeft > 0) return { ok: false, reason: 'cooldown', preview }
  if (preview.hardBlocked) return { ok: false, reason: 'hard-mode', preview }

  const reward = state.reward
  reward.points = Math.max(0, (reward.points || 0) - preview.pointCost)

  state.punish.cooldownUntil = now + preview.cooldownMinutes * MINUTE
  state.punish.unlocks = [
    {
      at: now,
      points: preview.pointCost,
      cooldownMinutes: preview.cooldownMinutes,
      minutes: preview.sessionMinutes
    },
    ...(state.punish.unlocks || [])
  ].slice(0, 50)

  state.manual = { ...EMPTY_MANUAL }
  // 定时屏蔽不允许永久解除，仅暂停一个冷却周期
  state.pauseUntil = now + preview.cooldownMinutes * MINUTE
  state.pauseKind = 'snooze'
  reward.todayFailed = true
  reward.accrue = { active: false, lastAt: 0 }

  let shieldUsed = false
  let streakReset = false
  if ((reward.shields || 0) > 0) {
    reward.shields -= 1
    shieldUsed = true
  } else if ((reward.streak || 0) > 0) {
    reward.streak = 0
    streakReset = true
  }

  return { ok: true, preview, extra: { shieldUsed, streakReset } }
}

/**
 * 使用「自由通行证」解除屏蔽：无惩罚
 */
export function applyPassUnlock(state, minutes = 30, now = Date.now()) {
  const reward = state.reward
  if ((reward.passes || 0) <= 0) return { ok: false, reason: 'no-pass' }
  reward.passes -= 1
  state.manual = { ...EMPTY_MANUAL }
  state.pauseUntil = now + minutes * MINUTE
  state.pauseKind = 'pass'
  reward.accrue = { active: false, lastAt: 0 }
  return { ok: true, extra: { minutes } }
}
