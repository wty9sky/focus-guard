export const MINUTE = 60_000
export const DAY = 86_400_000

const pad = (n) => String(n).padStart(2, '0')

export function startOfDay(ts = Date.now()) {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function dayKey(ts = Date.now()) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const todayKey = dayKey

export function addDaysToKey(key, n) {
  const [y, m, d] = key.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + n)
  return dayKey(dt.getTime())
}

export function parseHM(value) {
  if (typeof value !== 'string') return null
  const m = value.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const h = Number(m[1])
  const mi = Number(m[2])
  if (h > 24 || mi > 59) return null
  return h * 60 + mi
}

export function formatHM(minutes) {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`
}

/** 毫秒 -> mm:ss 或 HH:mm:ss */
export function formatClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

/** 毫秒 -> 人类可读时长 */
export function formatDuration(ms) {
  const mins = Math.max(0, Math.round(ms / MINUTE))
  if (mins < 60) return `${mins} 分钟`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h} 小时 ${m} 分` : `${h} 小时`
}

/** 时间戳 -> HH:mm */
export function clockOf(ts) {
  if (!ts) return '--:--'
  const d = new Date(ts)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 时间戳 -> MM-DD HH:mm */
export function stampOf(ts) {
  if (!ts) return '--'
  const d = new Date(ts)
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** ISO 周标识，用于「每周发放护盾」 */
export function weekKey(ts = Date.now()) {
  const d = new Date(startOfDay(ts))
  const day = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - day + 3)
  const year = d.getFullYear()
  const jan4 = new Date(year, 0, 4)
  const jan4Day = (jan4.getDay() + 6) % 7
  const week1Thursday = jan4.getTime() + (3 - jan4Day) * DAY
  const week = 1 + Math.round((d.getTime() - week1Thursday) / (7 * DAY))
  return `${year}-W${pad(week)}`
}

export const WEEKDAYS = [
  { value: 1, label: '一' },
  { value: 2, label: '二' },
  { value: 3, label: '三' },
  { value: 4, label: '四' },
  { value: 5, label: '五' },
  { value: 6, label: '六' },
  { value: 0, label: '日' }
]
