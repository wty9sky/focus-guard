import { MINUTE } from './time.js'

/** 单次观测到的时间前进超过该值，视为系统时钟被拨快（或从长时间休眠恢复） */
export const CLOCK_JUMP_MS = 10 * MINUTE
/** 时间倒退超过该值，视为系统时钟被回拨 */
export const CLOCK_REWIND_MS = 30_000
/** 单次最多补回的时长，避免异常数据把屏蔽无限拉长 */
export const MAX_CLOCK_SHIFT_MS = 4 * 60 * MINUTE

/** 把"跳变前仍然生效"的截止时间整体平移，未过期的不动，避免复活已结束的屏蔽 */
function shiftDeadlines(state, ref, shift) {
  const apply = (value) => (value > ref ? value + shift : value)
  if (state.manual && state.manual.until > 0) {
    state.manual.until = apply(state.manual.until)
  }
  if (state.pauseUntil > 0) {
    state.pauseUntil = apply(state.pauseUntil)
  }
  if (state.punish && state.punish.cooldownUntil > 0) {
    state.punish.cooldownUntil = apply(state.punish.cooldownUntil)
  }
}

/**
 * 检测系统时钟跳变，并把仍生效的截止时间按"真实流逝"重新锚定，
 * 让「改系统时间提前解禁」失效。
 *
 * 规则：
 * - 同一浏览器会话内，单次前进 > 10 分钟 → 视为跳变，按跳变量顺延；
 * - 时间倒退 > 30 秒 → 视为回拨，按倒退量回退，剩余时长保持不变；
 * - 浏览器刚启动时只纠正"倒退"（关机期间拨钟），正向间隔视为正常离场，不追讨。
 *
 * @param {object} state 完整状态
 * @param {number} now 当前墙钟
 * @param {{ present?: boolean, lastAt?: number }} session 本浏览器会话内的上次观测
 * @returns {{ kind: 'jump'|'rewind', shift: number, ref: number } | null}
 */
export function guardClock(state, now, session = {}) {
  const clock = state.clock
  if (!clock) return null

  const anchor = clock.lastSeenAt || 0
  const last = session.present ? session.lastAt || 0 : 0
  const ref = last || anchor || now
  const delta = now - ref

  let kind = ''
  if (!session.present) {
    if (anchor && delta < -CLOCK_REWIND_MS) kind = 'rewind'
  } else if (last) {
    if (delta < -CLOCK_REWIND_MS) kind = 'rewind'
    else if (delta > CLOCK_JUMP_MS) kind = 'jump'
  }

  clock.lastSeenAt = now
  if (!kind) return null

  const shift = Math.max(-MAX_CLOCK_SHIFT_MS, Math.min(MAX_CLOCK_SHIFT_MS, delta))
  shiftDeadlines(state, ref, shift)

  const key = kind === 'jump' ? 'jumps' : 'rewinds'
  clock[key] = (clock[key] || 0) + 1
  clock.lastAnomalyAt = now
  clock.lastAnomalyMs = Math.abs(shift)
  clock.lastAnomalyKind = kind

  return { kind, shift, ref }
}
