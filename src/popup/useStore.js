import { ref } from 'vue'
import { STORAGE_KEY } from '../shared/constants.js'
import { normalizeState } from '../shared/state.js'
import { computeBlock } from '../shared/blocking.js'
import { previewForceUnlock } from '../shared/punish.js'

export const state = ref(null)
export const block = ref({
  blocked: false,
  until: 0,
  sources: [],
  paused: false,
  pausedUntil: 0,
  pausedKind: ''
})
export const preview = ref(null)
export const now = ref(Date.now())
export const ready = ref(false)
export const lastError = ref('')

/** 后台没响应时的兜底提示 */
const NO_BG = '后台无响应，请到 chrome://extensions 重新加载扩展后再试'

let ticker = null

/** 单条消息最多等这么久，避免弹窗永远停在「正在读取状态」 */
const MESSAGE_TIMEOUT = 8000

function withTimeout(promise, ms, message) {
  let timer = null
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms)
    })
  ]).finally(() => clearTimeout(timer))
}

function apply(res) {
  if (!res) return
  if (res.state) state.value = res.state
  if (res.block) block.value = res.block
  if (res.preview !== undefined) preview.value = res.preview
}

export async function send(type, payload = {}) {
  try {
    if (!globalThis.chrome?.runtime?.sendMessage) throw new Error(NO_BG)
    const res = await withTimeout(
      chrome.runtime.sendMessage({ type, ...payload }),
      MESSAGE_TIMEOUT,
      NO_BG
    )
    apply(res)
    if (!res) {
      lastError.value = NO_BG
      return { ok: false, error: NO_BG }
    }
    if (res.ok === false && res.error) lastError.value = res.error
    else lastError.value = ''
    return res
  } catch (err) {
    lastError.value = err?.message || String(err)
    return { ok: false, error: lastError.value }
  }
}

/**
 * 后台彻底不可用时的兜底：直接读本地存储，把弹窗需要的状态拼出来。
 * 这样即使 service worker 挂了，界面也不会卡在「正在读取状态」。
 */
export async function loadFromStorage() {
  try {
    if (!globalThis.chrome?.storage?.local) throw new Error(NO_BG)
    const raw = await chrome.storage.local.get(STORAGE_KEY)
    const local = normalizeState(raw?.[STORAGE_KEY])
    const at = Date.now()
    state.value = local
    block.value = computeBlock(local, at)
    preview.value = previewForceUnlock(local, at)
    return true
  } catch (err) {
    if (!lastError.value) lastError.value = err?.message || String(err)
    return false
  }
}

async function bootstrap() {
  ready.value = false
  const res = await send('GET_STATE')
  if (!res?.ok || !res.state) {
    // service worker 没起来（或超时）：用本地存储兜底，保证界面可用
    await loadFromStorage()
  }
  ready.value = true
}

export function startStore() {
  bootstrap()
  if (!ticker) {
    ticker = setInterval(() => {
      now.value = Date.now()
    }, 1000)
  }
}

/** 出错后手动重试 */
export async function retry() {
  lastError.value = ''
  await bootstrap()
}

export function stopStore() {
  if (ticker) {
    clearInterval(ticker)
    ticker = null
  }
}
