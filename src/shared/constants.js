export const STORAGE_KEY = 'focusGuard:state:v1'
export const SESSION_KEY = 'fgRuleSignature'
export const QUERY_FLAG = 'fgQuerySupported'
export const BLOCK_PAGE = 'blocked/index.html'
export const RULE_ID_BASE = 10_000
export const TICK_ALARM = 'fg:tick'
export const END_ALARM = 'fg:end'

/** 一键屏蔽的快捷时长 */
export const QUICK_DURATIONS = [
  { label: '25 分钟', value: 25 },
  { label: '45 分钟', value: 45 },
  { label: '90 分钟', value: 90 },
  { label: '2 小时', value: 120 },
  { label: '4 小时', value: 240 },
  { label: '8 小时', value: 480 }
]

/** 成就徽章：达成后一次性发放奖励积分 */
export const BADGE_DEFS = [
  { id: 's1', name: '首次屏蔽', desc: '完成第一次有效屏蔽', type: 'session', value: 1, bonus: 10, icon: '🌱' },
  { id: 'h10', name: '初入佳境', desc: '累计专注满 10 小时', type: 'hours', value: 10, bonus: 50, icon: '🍀' },
  { id: 'h50', name: '心无旁骛', desc: '累计专注满 50 小时', type: 'hours', value: 50, bonus: 200, icon: '🔥' },
  { id: 'h100', name: '定海神针', desc: '累计专注满 100 小时', type: 'hours', value: 100, bonus: 400, icon: '⚓' },
  { id: 'h500', name: '十年磨剑', desc: '累计专注满 500 小时', type: 'hours', value: 500, bonus: 2000, icon: '🗡️' },
  { id: 'k3', name: '三日之约', desc: '连续达标 3 天', type: 'streak', value: 3, bonus: 80, icon: '🥉' },
  { id: 'k7', name: '一周自律', desc: '连续达标 7 天', type: 'streak', value: 7, bonus: 200, icon: '🥈' },
  { id: 'k14', name: '半月不辍', desc: '连续达标 14 天', type: 'streak', value: 14, bonus: 500, icon: '🥇' },
  { id: 'k30', name: '一月之墙', desc: '连续达标 30 天', type: 'streak', value: 30, bonus: 1200, icon: '💎' }
]

/** 积分兑换商店 */
export const SHOP_ITEMS = [
  {
    id: 'pass30',
    name: '自由通行证',
    desc: '屏蔽期间豁免 30 分钟：不扣积分、不清连胜、不进冷却',
    cost: 200,
    kind: 'pass',
    minutes: 30
  },
  {
    id: 'shield',
    name: '连胜护盾',
    desc: '提前解除屏蔽时抵挡一次「连胜清零」，最多持有 3 个',
    cost: 400,
    kind: 'shield',
    max: 3
  }
]

/** 常见分心站点，便于快速添加 */
export const PRESET_SITES = [
  'bilibili.com',
  'douyin.com',
  'weibo.com',
  'xiaohongshu.com',
  'zhihu.com',
  'youtube.com',
  'x.com',
  'instagram.com',
  'reddit.com',
  'taobao.com'
]

export const PUNISH_LIMITS = {
  baseCooldown: { min: 1, max: 120 },
  dailyGoal: { min: 10, max: 720 },
  cooldownCap: 240
}
