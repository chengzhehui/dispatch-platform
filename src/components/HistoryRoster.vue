<script setup>
import { computed, ref, watch } from 'vue'
const props = defineProps({ history: Object, selectedId: String })
const emit = defineEmits(['worker', 'weld'])
const query = ref(''), current = ref('')
watch(() => props.selectedId, id => { current.value = id || '' })
watch(() => props.history.date, () => { current.value = ''; query.value = '' })
const visible = computed(() => (props.history.workers || []).filter(worker => worker.id.toLowerCase().includes(query.value.trim().toLowerCase())))
const worker = computed(() => (props.history.workers || []).find(item => item.id === current.value))
function select(id) { current.value = id; emit('worker', id) }
</script>
<template>
  <section class="history-roster" aria-label="历史盖面焊工">
    <h2>历史作业 <span>{{ history.date }}</span></h2>
    <div class="history-kpis"><div><strong>{{ history.summary?.workers || 0 }}</strong><span>盖面焊工</span></div><div><strong>{{ history.summary?.welds || 0 }}</strong><span>当日焊口</span></div></div>
    <p class="muted small">当前范围已定位 {{ history.summary?.locatedWorkers || 0 }} 人 / {{ history.summary?.locatedWelds || 0 }} 口；未定位 {{ (history.summary?.welds || 0) - (history.summary?.locatedWelds || 0) }} 口。{{ history.summary?.missingWelder ? `${history.summary.missingWelder} 口缺少盖面焊工。` : '' }}</p>
    <p class="muted small">全项目当日 {{ history.projectSummary?.workers || 0 }} 人，按焊工编号去重；跨单元不重复计人。</p>
    <input v-model="query" class="ep3d-search" aria-label="搜索历史盖面焊工" placeholder="搜索盖面焊工编号">
    <div class="history-worker-list"><button v-for="item in visible" :key="item.id" :class="{ active: item.id === current }" @click="select(item.id)"><strong>{{ item.id }}</strong><span>{{ item.records.length }} 口 · {{ item.workfaces.length }} 个作业面</span><small v-if="!item.located.length">未定位</small><i v-else class="live-dot"></i></button></div>
    <p v-if="!visible.length" class="ep3d-hint">{{ history.loading ? '正在加载当日台账…' : '当前日期、单元没有匹配的盖面焊工' }}</p>
    <template v-if="worker">
      <div class="history-worker-details"><h3>盖面焊工 {{ worker.id }}</h3><p class="muted small">{{ worker.located.length }} / {{ worker.records.length }} 道焊口可定位；青色标记显示该焊工当日作业点。</p><p class="history-worker-progress">已演示 {{ worker.completedRecordIds?.length || 0 }} / {{ worker.located.length }} 口 · 每口演示 {{ (worker.slotSeconds || 0).toFixed(2) }} 秒 · {{ worker.omittedRecordIds?.length || 0 }} 口未演示</p>
        <div v-for="face in worker.workfaces" :key="`${face.unit}:${face.label}`" class="history-face"><span>{{ face.unit }} · {{ face.label }}</span><small>{{ face.count }} 口</small></div>
        <div class="history-weld-list"><button v-for="record in worker.records" :key="record.id" :disabled="!record.point" :class="{ active: record.id === worker.activeRecordId }" :title="record.point ? (worker.omittedRecordIds?.includes(record.id) ? '受日时长限制未演示，可定位查看' : '定位当日焊口') : '未匹配模型，保留台账记录'" @click="$emit('weld', record.id)"><strong>{{ record.weld }}</strong><span>{{ record.line }}</span><small>{{ worker.omittedRecordIds?.includes(record.id) ? '未演示' : worker.completedRecordIds?.includes(record.id) ? '已演示' : record.id === worker.activeRecordId ? (worker.phase === 'approaching' ? '前往焊口' : '焊接示意') : record.point ? '定位' : '未定位' }}</small></button></div>
      </div>
    </template>
  </section>
</template>
