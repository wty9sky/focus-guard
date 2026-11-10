import { DAY, MINUTE, parseHM, startOfDay } from './time.js'

/** 把用户输入规整成纯域名（去掉协议、路径、端口、www 前缀） */
export function normalizePattern(input) {
  let s = String(input || '')
    .trim()
    .toLowerCase()
  if (!s) return ''
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  s = s.split('/')[0].split('?')[0].split('#')[0]
  s = s.replace(/^www\./, '')
  s = s.replace(/:\d+$/, '')
  s = s.replace(/^\.+|\.+$/g, '')
  if (!/^[a-z0-9\u4e00-\u9fa5]([a-z0-9\u4e00-\u9fa5-]*[a-z0-9\u4e00-\u9fa5])?(\.[a-z0-9\u4e00-\u9fa5]([a-z0-9\u4e00-\u9fa5-]*[a-z0-9\u4e00-\u9fa5])?)+$/.test(s)) {
    return ''
  }
  return s
}

/** 域名 -> DNR urlFilter（|| 前缀可同时命中子域名） */
export function patternToFilter(pattern) {
  return `||${pattern}^`
}

/** 判断某个定时规则在给定时刻是否处于生效窗口内（支持跨零点） */
function windowFor(schedule, now, dayOffset) {
  const startMin = parseHM(schedule.start)
  const endMin = parseHM(schedule.end)
  if (startMin == null || endMin == null) return null
  const base = startOfDay(now) + dayOffset * DAY
  const weekday = new Date(base).getDay()
  const days = Array.isArray(schedule.days) ? schedule.days : []
  if (!days.includes(weekday)) return null
  const startAt = base + startMin * MINUTE
  const endAt = base + (endMin <= startMin ? endMin + 1440 : endMin) * MINUTE
  if (now < startAt || now >= endAt) return null
  return { startAt, endAt }
}

/** 当前正在生效的定时窗口 */
export function activeScheduleWindows(state, now = Date.now()) {
  const out = []
  for (const schedule of state.schedules || []) {
    if (!schedule.enabled) continue
    for (const offset of [-1, 0]) {
      const win = windowFor(schedule, now, offset)
      if (win) {
        out.push({
          id: schedule.id,
          label: schedule.name || '定时屏蔽',
          startAt: win.startAt,
          endAt: win.endAt
        })
        break
      }
    }
  }
  return out
}

/**
 * 计算当前屏蔽状态
 * @returns {{blocked:boolean, until:number, sources:Array, paused:boolean, pausedUntil:number, pausedKind:string}}
 */
export function computeBlock(state, now = Date.now()) {
  const paused = (state.pauseUntil || 0) > now
  const sources = []

  if (!paused) {
    if ((state.manual?.until || 0) > now) {
      sources.push({
        type: 'manual',
        label: '手动屏蔽',
        until: state.manual.until,
        startAt: state.manual.startedAt || now
      })
    }
    for (const win of activeScheduleWindows(state, now)) {
      sources.push({
        type: 'schedule',
        id: win.id,
        label: win.label,
        until: win.endAt,
        startAt: win.startAt
      })
    }
  }

  const blocked = sources.length > 0
  return {
    blocked,
    until: blocked ? Math.max(...sources.map((s) => s.until)) : 0,
    sources,
    paused: paused && !blocked,
    pausedUntil: paused ? state.pauseUntil : 0,
    pausedKind: paused ? state.pauseKind || 'pass' : ''
  }
}

/** 下一次定时屏蔽的开始时间（用于提前唤醒），没有则返回 0 */
export function nextScheduleStart(state, now = Date.now()) {
  let best = 0
  for (const schedule of state.schedules || []) {
    if (!schedule.enabled) continue
    const startMin = parseHM(schedule.start)
    const endMin = parseHM(schedule.end)
    if (startMin == null || endMin == null) continue
    const days = Array.isArray(schedule.days) ? schedule.days : []
    for (let offset = 0; offset <= 7; offset++) {
      const base = startOfDay(now) + offset * DAY
      if (!days.includes(new Date(base).getDay())) continue
      const at = base + startMin * MINUTE
      if (at > now) {
        if (!best || at < best) best = at
        break
      }
    }
  }
  return best
}
