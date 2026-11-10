<script setup>
import { computed, ref } from 'vue'
import { Message } from '@arco-design/web-vue'
import { state, send } from '../useStore.js'
import { BADGE_DEFS, SHOP_ITEMS } from '../../shared/constants.js'
import { stampOf } from '../../shared/time.js'

const busy = ref('')
const customName = ref('')
const customCost = ref(100)

const reward = computed(() => state.value?.reward || {})
const ownedIds = computed(() => new Set((reward.value.badges || []).map((b) => b.id)))
const customRewards = computed(() => state.value?.customRewards || [])

const hourProgress = computed(() => Math.floor((reward.value.totalFocusMinutes || 0) / 60))

async function redeem(item) {
  busy.value = item.id
  const res = await send('REDEEM', { id: item.id })
  busy.value = ''
  if (res.ok) Message.success(`已兑换：${item.name}`)
  else Message.error(res.error || '兑换失败')
}

async function addCustom() {
  const name = customName.value.trim()
  if (!name) {
    Message.warning('请填写奖励名称')
    return
  }
  const res = await send('ADD_CUSTOM_REWARD', { name, cost: customCost.value })
  if (res.ok) {
    customName.value = ''
    Message.success('已添加现实奖励')
  } else {
    Message.error(res.error || '添加失败')
  }
}

async function removeCustom(item) {
  await send('REMOVE_CUSTOM_REWARD', { id: item.id })
}
</script>

<template>
  <div class="view" v-if="state">
    <div class="card">
      <div class="card-hd">
        <span class="card-title">我的成就</span>
        <span class="muted">累计 {{ hourProgress }} 小时</span>
      </div>
      <div class="stats">
        <div class="stat">
          <div class="stat-value">{{ reward.points }}</div>
          <div class="stat-label">可用积分</div>
        </div>
        <div class="stat">
          <div class="stat-value">{{ reward.streak }}</div>
          <div class="stat-label">连续达标</div>
        </div>
        <div class="stat">
          <div class="stat-value">{{ reward.bestStreak || 0 }}</div>
          <div class="stat-label">最长连胜</div>
        </div>
      </div>
      <div class="muted" style="margin-top: 10px">
        护盾 {{ reward.shields }} 个 · 通行证 {{ reward.passes }} 张 · 已解锁徽章
        {{ ownedIds.size }}/{{ BADGE_DEFS.length }}
      </div>
    </div>

    <div class="card">
      <div class="card-hd"><span class="card-title">徽章</span></div>
      <div class="badges">
        <div class="badge" v-for="b in BADGE_DEFS" :key="b.id" :class="{ on: ownedIds.has(b.id) }">
          <div class="badge-icon">{{ b.icon }}</div>
          <div class="badge-name">{{ b.name }}</div>
          <div class="badge-desc">{{ b.desc }}</div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-hd">
        <span class="card-title">积分商店</span>
        <span class="muted">{{ reward.points }} 分</span>
      </div>
      <div class="list">
        <div class="list-item" v-for="item in SHOP_ITEMS" :key="item.id">
          <div class="list-main">
            <div class="list-title">{{ item.name }}</div>
            <div class="list-sub">{{ item.desc }}</div>
          </div>
          <a-button
            size="mini"
            type="primary"
            :disabled="reward.points < item.cost"
            :loading="busy === item.id"
            @click="redeem(item)"
          >
            {{ item.cost }} 分
          </a-button>
        </div>
        <div class="list-item" v-for="item in customRewards" :key="item.id">
          <div class="list-main">
            <div class="list-title">{{ item.name }}</div>
            <div class="list-sub">自定义现实奖励 · 兑现给自己一次</div>
          </div>
          <a-button
            size="mini"
            type="primary"
            :disabled="reward.points < item.cost"
            :loading="busy === item.id"
            @click="redeem(item)"
          >
            {{ item.cost }} 分
          </a-button>
          <a-button size="mini" type="text" status="danger" @click="removeCustom(item)">删</a-button>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-hd"><span class="card-title">添加现实奖励</span></div>
      <div class="row">
        <a-input v-model="customName" class="grow" size="small" placeholder="如 看一集剧 / 一杯奶茶" />
        <a-input-number v-model="customCost" size="small" :min="1" :step="50" style="width: 92px" />
        <a-button size="small" type="outline" @click="addCustom">添加</a-button>
      </div>
      <div class="muted" style="margin-top: 8px">用积分兑换真实的放松，才让坚持有回报。</div>
    </div>

    <div class="card" v-if="state.redemptions?.length">
      <div class="card-hd"><span class="card-title">兑换记录</span></div>
      <div class="list">
        <div class="list-item" v-for="r in state.redemptions.slice(0, 6)" :key="r.id">
          <div class="list-main">
            <div class="list-title">{{ r.name }}</div>
            <div class="list-sub">{{ stampOf(r.at) }}</div>
          </div>
          <a-tag size="mini" color="orange">-{{ r.cost }}</a-tag>
        </div>
      </div>
    </div>
  </div>
</template>
