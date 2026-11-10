<script setup>
import { computed, onUnmounted, ref, watch } from 'vue'
import { Message } from '@arco-design/web-vue'
import { block, now, preview, state, send } from '../useStore.js'
import { QUICK_DURATIONS } from '../../shared/constants.js'
import { clockOf, formatClock, formatDuration, stampOf } from '../../shared/time.js'

const quickMinutes = ref(state.value?.quickMinutes || 120)
watch(
  () => state.value?.quickMinutes,
  (v) => {
    if (v) quickMinutes.value = v
  }
)

const busy = ref(false)

const remaining = computed(() => Math.max(0, (block.value.until || 0) - now.value))

const percent = computed(() => {
  if (!block.value.blocked) return 0
  const starts = (block.value.sources || []).map((s) => s.startAt || now.value)
  const start = starts.length ? Math.min(...starts) : now.value
  const total = Math.max(1, block.value.until - start)
  const elapsed = Math.min(total, Math.max(0, now.value - start))
  return Math.min(100, Math.round((elapsed / total) * 100))
})

const countdownText = computed(() => {
  if (block.value.blocked) return formatClock(remaining.value)
  if (block.value.paused) return formatClock(Math.max(0, block.value.pausedUntil - now.value))
  return '00:00'
})

const heroLabel = computed(() => {
  if (block.value.blocked) return `预计 ${clockOf(block.value.until)} 解除`
  if (block.value.paused) return `豁免中 · ${clockOf(block.value.pausedUntil)} 恢复`
  return '当前未屏蔽'
})

const clockNotice = computed(() => {
  const c = state.value?.clock
  const total = (c?.jumps || 0) + (c?.rewinds || 0)
  if (!total) return ''
  const kind = c.lastAnomalyKind === 'rewind' ? '回拨' : '快进'
  const ms = c.lastAnomalyMs || 0
  return `检测到 ${total} 次系统时间${kind}，最近一次在 ${stampOf(c.lastAnomalyAt)}，已自动补回约 ${formatDuration(ms)} 的屏蔽时长。`
})

const todayMinutes = computed(() => state.value?.reward?.todayFocusMinutes || 0)
const goal = computed(() => state.value?.dailyGoalMinutes || 120)
const goalPercent = computed(() =>
  Math.min(100, Math.round((todayMinutes.value / Math.max(1, goal.value)) * 100))
)

async function onToggle(val) {
  if (busy.value) return
  if (val) {
    busy.value = true
    const res = await send('BLOCK_NOW', { minutes: quickMinutes.value })
    busy.value = false
    if (res.ok) Message.success(`已屏蔽 ${quickMinutes.value} 分钟`)
    else Message.error(res.error || '屏蔽失败')
  } else {
    openUnlock()
  }
}

/* ---------------- 解除屏蔽确认 ---------------- */
const unlockVisible = ref(false)
const calm = ref(10)
const pledgeInput = ref('')
const acting = ref(false)
let calmTimer = null

function openUnlock() {
  pledgeInput.value = ''
  calm.value = 10
  unlockVisible.value = true
  clearInterval(calmTimer)
  calmTimer = setInterval(() => {
    if (calm.value > 0) calm.value -= 1
    else clearInterval(calmTimer)
  }, 1000)
}

onUnmounted(() => clearInterval(calmTimer))

const canConfirm = computed(() => {
  const p = preview.value
  if (!p || calm.value > 0 || acting.value) return false
  if (p.hardBlocked) return false
  if (p.cooldownLeft > 0) return false
  if (p.pledge && pledgeInput.value.trim() !== p.pledge) return false
  return true
})

async function confirmUnlock() {
  acting.value = true
  const res = await send('UNLOCK', { mode: 'force' })
  acting.value = false
  if (!res.ok) {
    Message.error(res.error || '解除失败')
    return
  }
  unlockVisible.value = false
  const p = res.preview || {}
  Message.warning(
    `已解除：扣除 ${p.pointCost || 0} 积分，冷却 ${p.cooldownMinutes || 0} 分钟${p.shieldAvailable ? '，已消耗 1 个护盾' : ''}`
  )
}

async function usePass() {
  acting.value = true
  const res = await send('UNLOCK', { mode: 'pass' })
  acting.value = false
  if (!res.ok) {
    Message.error(res.error || '通行证不足')
    return
  }
  unlockVisible.value = false
  Message.success('已使用自由通行证，豁免 30 分钟')
}
</script>

<template>
  <div class="view" v-if="state">
    <!-- 状态总览 -->
    <div class="hero" :class="{ 'is-blocked': block.blocked }">
      <div class="ring">
        <a-progress
          type="circle"
          :percent="percent / 100"
          :width="132"
          :stroke-width="7"
          :show-text="false"
          :color="block.blocked ? '#F53F3F' : '#C9CDD4'"
        />
        <div class="ring-inner">
          <div class="ring-value">{{ countdownText }}</div>
          <div class="ring-label">{{ heroLabel }}</div>
        </div>
      </div>

      <div class="hero-tags">
        <a-tag v-for="s in block.sources" :key="s.type + (s.id || '')" color="red" size="small">
          {{ s.label }}
        </a-tag>
        <a-tag v-if="block.paused" color="orange" size="small">
          {{ block.pausedKind === 'pass' ? '通行证豁免' : '冷却暂停' }}
        </a-tag>
        <a-tag v-if="!block.blocked && !block.paused" color="green" size="small">一切正常</a-tag>
      </div>
    </div>

    <!-- 一键屏蔽 -->
    <div class="card">
      <div class="card-hd">
        <span class="card-title">一键屏蔽</span>
        <a-switch :model-value="block.blocked" :disabled="busy" @change="onToggle" />
      </div>
      <a-radio-group v-model="quickMinutes" type="button" size="mini" class="durations">
        <a-radio v-for="d in QUICK_DURATIONS" :key="d.value" :value="d.value">
          {{ d.label }}
        </a-radio>
      </a-radio-group>
      <div class="muted" style="margin-top: 8px">
        开启后立即生效：命中黑名单的站点会被拦截并显示警告页。
      </div>
    </div>

    <!-- 今日数据 -->
    <div class="card">
      <div class="card-hd">
        <span class="card-title">今日专注</span>
        <span class="muted">{{ todayMinutes }} / {{ goal }} 分钟</span>
      </div>
      <div class="stats">
        <div class="stat">
          <div class="stat-value">{{ todayMinutes }}</div>
          <div class="stat-label">专注分钟</div>
        </div>
        <div class="stat">
          <div class="stat-value">{{ state.reward.points }}</div>
          <div class="stat-label">积分</div>
        </div>
        <div class="stat">
          <div class="stat-value">{{ state.reward.streak }}</div>
          <div class="stat-label">连续达标</div>
        </div>
      </div>
      <a-progress
        :percent="goalPercent / 100"
        :stroke-width="8"
        :show-text="false"
        style="margin-top: 10px"
        :color="goalPercent >= 100 ? '#00B42A' : '#165DFF'"
      />
    </div>

    <!-- 解除屏蔽 -->
    <div class="card">
      <div class="card-hd">
        <span class="card-title">解除屏蔽</span>
        <a-tag v-if="preview && preview.cooldownLeft > 0" color="orange" size="small">
          冷却 {{ Math.ceil(preview.cooldownLeft / 60000) }} 分钟
        </a-tag>
      </div>
      <div class="row">
        <a-button
          class="grow"
          status="danger"
          :disabled="!block.blocked"
          @click="openUnlock"
        >
          解除屏蔽（有代价）
        </a-button>
        <a-button
          class="grow"
          type="outline"
          :disabled="!state.reward.passes"
          @click="usePass"
        >
          通行证 ×{{ state.reward.passes }}
        </a-button>
      </div>
      <div class="muted" style="margin-top: 8px">
        护盾 {{ state.reward.shields }} · 通行证 {{ state.reward.passes }}
      </div>
    </div>

    <!-- 时钟保护 -->
    <div v-if="clockNotice" class="card">
      <div class="card-hd">
        <span class="card-title">时钟保护</span>
        <a-tag color="orange" size="small">已生效</a-tag>
      </div>
      <div class="muted">{{ clockNotice }}</div>
    </div>

    <!-- 解除确认弹窗 -->
    <a-modal
      v-model:visible="unlockVisible"
      title="提前解除屏蔽"
      :footer="false"
      :width="330"
      :mask-closable="false"
    >
      <div v-if="preview">
        <a-alert v-if="preview.hardBlocked" type="error" style="margin-bottom: 10px">
          严格模式已开启，无法提前解除。请等待计时结束，或使用自由通行证。
        </a-alert>
        <a-alert v-else-if="preview.cooldownLeft > 0" type="warning" style="margin-bottom: 10px">
          冷却期内无法再次解除，还需等待
          {{ Math.ceil(preview.cooldownLeft / 60000) }} 分钟。
        </a-alert>

        <div class="warn-list">
          <div class="warn-item">
            <span>扣除积分</span>
            <b>-{{ preview.pointCost }}</b>
          </div>
          <div class="warn-item">
            <span>进入冷却</span>
            <b>{{ preview.cooldownMinutes }} 分钟</b>
          </div>
          <div class="warn-item" v-if="preview.shieldAvailable">
            <span>连胜保护</span>
            <b>消耗 1 个护盾</b>
          </div>
          <div class="warn-item" v-else>
            <span>连胜清零</span>
            <b>{{ preview.streakAtRisk }} 天 → 0</b>
          </div>
          <div class="warn-item">
            <span>今日达标</span>
            <b>记为失败</b>
          </div>
          <div class="warn-item" v-if="preview.scheduleOnly">
            <span>定时屏蔽</span>
            <b>仅暂停 {{ preview.cooldownMinutes }} 分钟</b>
          </div>
        </div>

        <a-input
          v-if="preview.pledge"
          v-model="pledgeInput"
          size="small"
          placeholder="请输入承诺语以确认"
          style="margin-bottom: 10px"
        />
        <div class="muted" style="margin-bottom: 10px">
          本次为近 24 小时内第 {{ preview.nth }} 次提前解除，冷却按指数递增。
        </div>

        <a-button
          long
          type="primary"
          status="danger"
          :disabled="!canConfirm"
          :loading="acting"
          @click="confirmUnlock"
        >
          {{ calm > 0 ? `冷静 ${calm} 秒后可确认` : '确认解除，接受惩罚' }}
        </a-button>
        <a-button
          long
          type="outline"
          style="margin-top: 8px"
          :disabled="!preview.passAvailable"
          :loading="acting"
          @click="usePass"
        >
          改用自由通行证（免罚，剩 {{ state.reward.passes }} 张）
        </a-button>
      </div>
    </a-modal>
  </div>
</template>

<style scoped>
.durations {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.durations :deep(.arco-radio-button) {
  border-radius: 8px !important;
  margin: 0;
}
</style>
