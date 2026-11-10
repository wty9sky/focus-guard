<script setup>
import { computed, reactive, ref } from 'vue'
import { Message } from '@arco-design/web-vue'
import { block, state, send } from '../useStore.js'
import { WEEKDAYS } from '../../shared/time.js'

const form = reactive({
  id: '',
  name: '',
  start: '09:00',
  end: '18:00',
  days: [1, 2, 3, 4, 5]
})

const busy = ref(false)
const schedules = computed(() => state.value?.schedules || [])

const activeIds = computed(
  () => new Set((block.value.sources || []).filter((s) => s.type === 'schedule').map((s) => s.id))
)

function reset() {
  form.id = ''
  form.name = ''
  form.start = '09:00'
  form.end = '18:00'
  form.days = [1, 2, 3, 4, 5]
}

function edit(item) {
  form.id = item.id
  form.name = item.name
  form.start = item.start
  form.end = item.end
  form.days = [...item.days]
}

async function save() {
  if (!form.days.length) {
    Message.warning('请至少选择一天')
    return
  }
  busy.value = true
  const res = await send('SAVE_SCHEDULE', {
    schedule: {
      id: form.id || undefined,
      name: form.name,
      start: form.start,
      end: form.end,
      days: [...form.days]
    }
  })
  busy.value = false
  if (res.ok) {
    Message.success('已保存')
    reset()
  } else {
    Message.error(res.error || '保存失败')
  }
}

async function toggle(item) {
  await send('TOGGLE_SCHEDULE', { id: item.id })
}

async function remove(item) {
  const res = await send('REMOVE_SCHEDULE', { id: item.id })
  if (res.ok) Message.success('已删除')
}

function dayText(days) {
  if (!days?.length) return '未设置'
  if (days.length === 7) return '每天'
  const sorted = [...days].sort((a, b) => a - b)
  return sorted
    .map((d) => WEEKDAYS.find((w) => w.value === d)?.label || '')
    .map((l) => `周${l}`)
    .join(' ')
}
</script>

<template>
  <div class="view" v-if="state">
    <div class="card">
      <div class="card-hd">
        <span class="card-title">{{ form.id ? '编辑时段' : '新建时段' }}</span>
        <a-button v-if="form.id" size="mini" type="text" @click="reset">取消编辑</a-button>
      </div>

      <div class="field">
        <span class="label">名称</span>
        <a-input v-model="form.name" size="small" placeholder="如 工作时间" />
      </div>

      <div class="field">
        <span class="label">时间</span>
        <div class="row grow">
          <a-time-picker
            v-model="form.start"
            size="small"
            format="HH:mm"
            :allow-clear="false"
            class="grow"
          />
          <span class="muted">至</span>
          <a-time-picker
            v-model="form.end"
            size="small"
            format="HH:mm"
            :allow-clear="false"
            class="grow"
          />
        </div>
      </div>

      <div class="field" style="align-items: flex-start">
        <span class="label">重复</span>
        <a-checkbox-group v-model="form.days" class="grow days">
          <a-checkbox v-for="d in WEEKDAYS" :key="d.value" :value="d.value">
            {{ d.label }}
          </a-checkbox>
        </a-checkbox-group>
      </div>

      <a-button long type="primary" :loading="busy" @click="save">
        {{ form.id ? '保存修改' : '添加定时屏蔽' }}
      </a-button>
    </div>

    <div class="card">
      <div class="card-hd">
        <span class="card-title">定时规则</span>
        <span class="muted">{{ schedules.length }} 条</span>
      </div>

      <div v-if="!schedules.length" class="empty">暂无定时屏蔽规则</div>
      <div v-else class="list">
        <div class="list-item" v-for="item in schedules" :key="item.id">
          <div class="list-main">
            <div class="list-title">
              {{ item.name }}
              <a-tag v-if="activeIds.has(item.id)" color="red" size="mini">生效中</a-tag>
            </div>
            <div class="list-sub">
              {{ dayText(item.days) }} · {{ item.start }} - {{ item.end }}
            </div>
          </div>
          <a-button size="mini" type="text" @click="edit(item)">编辑</a-button>
          <a-switch size="small" :model-value="item.enabled" @change="toggle(item)" />
          <a-button size="mini" type="text" status="danger" @click="remove(item)">删</a-button>
        </div>
      </div>
    </div>

    <div class="muted" style="padding: 0 4px">
      定时屏蔽到点自动生效，未到点无法提前触发。生效期间「提前解除」只会暂停，规则本身不会被删除。
    </div>
  </div>
</template>

<style scoped>
.field {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.label {
  font-size: 12px;
  color: var(--fg-text-2);
  width: 32px;
  flex: none;
}

.days {
  display: flex;
  gap: 2px;
}

.days :deep(.arco-checkbox) {
  margin-right: 0;
  padding-left: 18px;
}
</style>
