<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { block, lastError, now, ready, retry, state, startStore, stopStore } from './useStore.js'
import { clockOf, formatClock } from '../shared/time.js'
import StatusView from './views/StatusView.vue'
import SitesView from './views/SitesView.vue'
import ScheduleView from './views/ScheduleView.vue'
import RewardView from './views/RewardView.vue'
import RulesView from './views/RulesView.vue'

const tab = ref('status')

const booting = ref(false)

async function onRetry() {
  booting.value = true
  await retry()
  booting.value = false
}

const subtitle = computed(() => {
  if (!state.value) return ready.value ? '状态读取失败' : '正在读取状态…'
  if (block.value.blocked) {
    return `屏蔽中 · 剩余 ${formatClock(block.value.until - now.value)}`
  }
  if (block.value.paused) {
    return `${block.value.pausedKind === 'pass' ? '通行证豁免' : '暂停'} · 至 ${clockOf(block.value.pausedUntil)}`
  }
  const count = (state.value.sites || []).length
  return `今日专注 ${state.value.reward?.todayFocusMinutes || 0} 分钟 · 黑名单 ${count} 条`
})

onMounted(startStore)
onUnmounted(stopStore)
</script>

<template>
  <div class="app">
    <header class="hd">
      <div class="hd-left">
        <div class="logo">🛡</div>
        <div>
          <div class="hd-title">专注守门员</div>
          <div class="hd-sub">{{ subtitle }}</div>
        </div>
      </div>
      <a-tag v-if="block.blocked" size="small">已屏蔽</a-tag>
      <a-tag v-else-if="block.paused" size="small">豁免中</a-tag>
      <a-tag v-else size="small">自由</a-tag>
    </header>

    <a-tabs v-model:active-key="tab" class="fg-tabs" size="small" :animation="false">
      <a-tab-pane key="status" title="状态">
        <StatusView />
      </a-tab-pane>
      <a-tab-pane key="sites" title="黑名单">
        <SitesView />
      </a-tab-pane>
      <a-tab-pane key="schedule" title="定时">
        <ScheduleView />
      </a-tab-pane>
      <a-tab-pane key="reward" title="奖励">
        <RewardView />
      </a-tab-pane>
      <a-tab-pane key="rules" title="规则">
        <RulesView />
      </a-tab-pane>
    </a-tabs>

    <div v-if="!ready" class="boot">加载中…</div>
    <div v-else-if="!state" class="boot is-error">
      <div class="boot-box">
        <div class="boot-title">没能读到本地数据</div>
        <div class="boot-msg">{{ lastError || '后台无响应' }}</div>
        <a-button size="small" type="primary" :loading="booting" @click="onRetry">重试</a-button>
        <div class="boot-tip">若一直失败：打开 chrome://extensions → 找到「专注守门员」→ 点「重新加载」</div>
      </div>
    </div>
  </div>
</template>

<style>
.boot {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.86);
  font-size: 13px;
  color: #86909c;
}

.boot.is-error {
  background: #fff;
  padding: 16px;
}

.boot-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  text-align: center;
}

.boot-title {
  font-size: 13px;
  font-weight: 600;
  color: #1d2129;
}

.boot-msg {
  font-size: 12px;
  color: #f53f3f;
  word-break: break-all;
  line-height: 1.6;
}

.boot-tip {
  font-size: 11px;
  color: #86909c;
  line-height: 1.6;
}
</style>
