<script setup>
import { reactive, ref, watch } from 'vue'
import { Message } from '@arco-design/web-vue'
import { state, send } from '../useStore.js'
import { PUNISH_LIMITS } from '../../shared/constants.js'
import { stampOf } from '../../shared/time.js'

const form = reactive({
  dailyGoalMinutes: 120,
  baseCooldown: 15,
  hardMode: false,
  pledge: ''
})

let synced = false
watch(
  state,
  (s) => {
    if (!s || synced) return
    form.dailyGoalMinutes = s.dailyGoalMinutes
    form.baseCooldown = s.punish.baseCooldown
    form.hardMode = s.punish.hardMode
    form.pledge = s.punish.pledge || ''
    synced = true
  },
  { immediate: true }
)

const busy = ref(false)

async function save() {
  busy.value = true
  const res = await send('UPDATE_SETTINGS', { patch: { ...form } })
  busy.value = false
  if (res.ok) Message.success('设置已保存')
  else Message.error(res.error || '保存失败')
}

async function resetStats() {
  const res = await send('RESET_STATS')
  if (res.ok) {
    synced = false
    Message.success('统计数据已重置')
  }
}

function exportData() {
  const json = JSON.stringify(state.value, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `focus-guard-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
  Message.success('已导出备份')
}

const importVisible = ref(false)
const importText = ref('')

async function doImport() {
  const res = await send('IMPORT_DATA', { data: importText.value })
  if (res.ok) {
    importVisible.value = false
    importText.value = ''
    synced = false
    Message.success('导入成功')
  } else {
    Message.error(res.error || '导入失败')
  }
}
</script>

<template>
  <div class="view" v-if="state">
    <div class="card">
      <div class="card-hd"><span class="card-title">奖励与惩罚参数</span></div>

      <div class="field">
        <div class="grow">
          <div class="field-title">每日达标目标</div>
          <div class="muted">当日专注满该时长即算打卡成功</div>
        </div>
        <a-input-number
          v-model="form.dailyGoalMinutes"
          size="small"
          :min="PUNISH_LIMITS.dailyGoal.min"
          :max="PUNISH_LIMITS.dailyGoal.max"
          :step="10"
          style="width: 96px"
        />
      </div>

      <div class="field">
        <div class="grow">
          <div class="field-title">提前解除基础冷却</div>
          <div class="muted">第 n 次解除按 2 的 n-1 次方递增，上限 240 分钟</div>
        </div>
        <a-input-number
          v-model="form.baseCooldown"
          size="small"
          :min="PUNISH_LIMITS.baseCooldown.min"
          :max="PUNISH_LIMITS.baseCooldown.max"
          :step="5"
          style="width: 96px"
        />
      </div>

      <div class="field">
        <div class="grow">
          <div class="field-title">严格模式</div>
          <div class="muted">屏蔽期间禁用「提前解除」，只能使用通行证</div>
        </div>
        <a-switch v-model="form.hardMode" size="small" />
      </div>

      <div class="field-title" style="margin-top: 4px">承诺语</div>
      <div class="muted" style="margin-bottom: 6px">
        填写后，解除屏蔽需要逐字输入该句才能确认
      </div>
      <a-input v-model="form.pledge" size="small" placeholder="如 我正在专注，不刷短视频" />

      <a-button long type="primary" style="margin-top: 12px" :loading="busy" @click="save">
        保存设置
      </a-button>
    </div>

    <div class="card">
      <div class="card-hd">
        <span class="card-title">惩罚记录</span>
        <span class="muted">近期 {{ state.punish.unlocks?.length || 0 }} 次</span>
      </div>
      <div v-if="!state.punish.unlocks?.length" class="empty">没有提前解除记录，保持住</div>
      <div v-else class="list">
        <div class="list-item" v-for="u in state.punish.unlocks.slice(0, 8)" :key="u.at">
          <div class="list-main">
            <div class="list-title">{{ stampOf(u.at) }} 提前解除</div>
            <div class="list-sub">
              已坚持 {{ u.minutes }} 分钟 · 冷却 {{ u.cooldownMinutes }} 分钟
            </div>
          </div>
          <a-tag size="mini" color="red">-{{ u.points }}</a-tag>
        </div>
      </div>
      <div class="muted" style="margin-top: 8px">
        剩余冷却：
        {{
          state.punish.cooldownUntil > Date.now()
            ? Math.ceil((state.punish.cooldownUntil - Date.now()) / 60000) + ' 分钟'
            : '无'
        }}
      </div>
    </div>

    <div class="card">
      <div class="card-hd"><span class="card-title">机制说明</span></div>
      <div class="rules">
        <div class="rule-line"><b>积分</b>：屏蔽期间每分钟 +1 分，定时屏蔽 ×1.2，严格模式 ×1.5。</div>
        <div class="rule-line"><b>连胜</b>：当日专注达标记 1 天，断档清零；每周自动补 1 个护盾。</div>
        <div class="rule-line">
          <b>提前解除</b>：扣「本次收益 50% + 30×档位」分，进入指数递增冷却，当日达标记失败。
        </div>
        <div class="rule-line"><b>护盾</b>：可抵挡一次连胜清零，最多持有 3 个。</div>
        <div class="rule-line"><b>通行证</b>：豁免 30 分钟且完全免罚，是唯一的「合法逃生口」。</div>
      </div>
    </div>

    <div class="card">
      <div class="card-hd"><span class="card-title">数据</span></div>
      <div class="row">
        <a-button class="grow" size="small" type="outline" @click="exportData">导出备份</a-button>
        <a-button class="grow" size="small" type="outline" @click="importVisible = true">导入</a-button>
        <a-popconfirm content="将清空积分、连胜、徽章与记录，确定？" @ok="resetStats">
          <a-button size="small" status="danger" type="outline">重置统计</a-button>
        </a-popconfirm>
      </div>
    </div>

    <a-modal v-model:visible="importVisible" title="导入数据" :footer="false" :width="330">
      <a-textarea v-model="importText" placeholder="粘贴导出的 JSON" :auto-size="{ minRows: 6 }" />
      <a-button long type="primary" style="margin-top: 10px" @click="doImport">确认导入</a-button>
    </a-modal>
  </div>
</template>

<style scoped>
.field {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
}

.field-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--fg-text);
}

.rules {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.rule-line {
  font-size: 11px;
  line-height: 1.75;
  color: var(--fg-text-2);
  background: #f7f8fa;
  border-radius: 8px;
  padding: 8px 10px;
}

.rule-line b {
  color: var(--fg-blue);
  margin-right: 4px;
}
</style>
