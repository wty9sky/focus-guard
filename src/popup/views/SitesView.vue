<script setup>
import { computed, ref } from 'vue'
import { Message } from '@arco-design/web-vue'
import { state, send } from '../useStore.js'
import { PRESET_SITES } from '../../shared/constants.js'

const draft = ref('')
const busy = ref(false)

const sites = computed(() => state.value?.sites || [])
const suggestions = computed(() =>
  PRESET_SITES.filter((p) => !sites.value.some((s) => s.pattern === p))
)

async function add(pattern) {
  const value = (pattern ?? draft.value).trim()
  if (!value) return
  if (busy.value) return
  busy.value = true
  const res = await send('ADD_SITE', { pattern: value })
  busy.value = false
  if (res.ok) {
    if (pattern == null) draft.value = ''
    Message.success('已加入黑名单')
  } else {
    Message.error(res.error || '添加失败')
  }
}

async function remove(site) {
  const res = await send('REMOVE_SITE', { id: site.id })
  if (res.ok) Message.success('已移除')
}

async function clearAll() {
  const res = await send('CLEAR_SITES')
  if (res.ok) Message.success('已清空')
}
</script>

<template>
  <div class="view" v-if="state">
    <div class="card">
      <div class="card-hd">
        <span class="card-title">添加网站</span>
        <span class="muted">{{ sites.length }} 个</span>
      </div>
      <div class="row">
        <a-input
          v-model="draft"
          class="grow"
          size="small"
          placeholder="如 bilibili.com（含子域名）"
          allow-clear
          @press-enter="add()"
        />
        <a-button type="primary" size="small" :loading="busy" @click="add()">添加</a-button>
      </div>
      <div class="chip-wrap" v-if="suggestions.length">
        <div class="chip" v-for="p in suggestions.slice(0, 8)" :key="p" @click="add(p)">
          + {{ p }}
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-hd">
        <span class="card-title">黑名单</span>
        <a-button v-if="sites.length" size="mini" status="danger" type="text" @click="clearAll">
          清空
        </a-button>
      </div>

      <div v-if="!sites.length" class="empty">还没有添加任何网站</div>
      <div v-else class="list">
        <div class="list-item" v-for="site in sites" :key="site.id">
          <div class="list-main">
            <div class="list-title">{{ site.pattern }}</div>
            <div class="list-sub">匹配 {{ site.pattern }} 及其所有子域名</div>
          </div>
          <a-button size="mini" type="text" status="danger" @click="remove(site)">移除</a-button>
        </div>
      </div>
    </div>

    <div class="muted" style="padding: 0 4px">
      提示：黑名单只在「一键屏蔽」开启或「定时屏蔽」生效时才拦截；关闭时不会影响正常浏览。
    </div>
  </div>
</template>

<style scoped>
.chip-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

.chip {
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--fg-blue-soft);
  color: var(--fg-blue);
  cursor: pointer;
  transition: opacity 0.2s;
}

.chip:hover {
  opacity: 0.75;
}
</style>
