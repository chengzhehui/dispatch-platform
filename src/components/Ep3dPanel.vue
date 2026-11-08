<script setup>
import { computed } from 'vue'
import Ep3dTree from './Ep3dTree.vue'
const props = defineProps({ model: { type: Object, default: () => ({}) }, unit: String, workers: Array, results: Array, ground: Number, cameraMode: String, readOnly: Boolean })
const emit = defineEmits(['close', 'search', 'select', 'focus', 'bind', 'clear'])
const selected = computed(() => props.model.selected)
const crew = computed(() => props.workers.filter(worker => worker.selected && worker.unit === props.unit))
const owner = computed(() => props.workers.find(worker => worker.weldTask?.unit === props.unit && worker.weldTask?.weldId === selected.value?.id))
const height = computed(() => selected.value?.bounds ? (selected.value.bounds[2] + selected.value.bounds[5]) / 2 - props.ground : null)
const canBind = computed(() => selected.value?.isWeld && height.value >= 0 && crew.value.length === 1 && !owner.value)
</script>

<template>
  <section class="ep3d-panel" aria-label="EP3D 焊缝与属性">
    <div class="section-title"><h2>EP3D 焊缝与属性</h2><button class="text-button" aria-label="关闭焊缝面板" @click="$emit('close')">收起</button></div>
    <p v-if="model.loading" class="ep3d-hint">正在加载 {{ unit }} 单元属性索引…</p>
    <p v-else-if="model.error" class="error-text small">{{ model.error }} · 可点击场景“重新加载”重试</p>
    <p v-else-if="!model.available" class="ep3d-hint">{{ unit }} 单元当前只有设计模型，源项目尚无该单元的 EP3D 焊缝属性。</p>
    <template v-else>
      <p class="ep3d-hint">{{ model.componentCount.toLocaleString() }} 个元件 · {{ model.weldCount.toLocaleString() }} 道可定位焊缝</p>
      <Ep3dTree :unit="unit" :lines="results" :selected="selected" :ready="model.ready" @search="$emit('search', $event)" @select="$emit('select', $event)" @focus="$emit('focus', $event)" />
      <div v-if="selected" class="component-details">
        <div class="component-heading"><strong>{{ selected.isWeld ? '焊缝' : selected.kind }} · {{ selected.label || selected.id }}</strong><span>{{ selected.geometryIds.length }} 个子几何联合高亮</span></div>
        <button class="text-button" @click="$emit('clear')">取消选择 · Esc</button>
        <button class="full" aria-label="定位选中对象" @click="$emit('focus', selected.id)">{{ cameraMode === 'worker' ? '看向选中对象' : '定位选中对象' }} · PageDown</button>
        <dl><dt>单元</dt><dd>{{ selected.sourceUnit || unit }}</dd><dt>管线</dt><dd>{{ selected.line }}</dd><dt>对象 ID</dt><dd>{{ selected.id }}</dd><dt v-if="selected.diameter">公称直径</dt><dd v-if="selected.diameter">{{ selected.diameter }}</dd></dl>
        <template v-if="selected.isWeld && !readOnly">
          <p v-if="owner" class="weld-assignment">{{ owner.id }} · {{ owner.weldTask.status === 'welding' ? '焊接中' : '前往焊缝' }}<span v-if="owner.weldTask.status === 'welding'"> · {{ Math.floor(owner.weldTask.elapsed) }} s</span></p>
          <p v-if="height < 0" class="ep3d-hint">该节点位于当前地面以下，暂不能派工，请核对标高。</p>
          <p v-else-if="height > 1.9" class="ep3d-hint">高处作业点：首版按标高直线到位，不计算爬梯路径。</p>
          <button class="primary full" :disabled="!canBind" @click="$emit('bind', selected.id)">{{ crew.length !== 1 ? '请先选中 1 名焊工' : owner ? `已绑定 ${owner.id}` : '绑定并前往焊缝' }}</button>
          <p class="ep3d-caption">每道焊缝绑定 1 人，作业持续到停止或改派。</p>
        </template>
        <p v-if="selected.loading" class="ep3d-hint">正在读取属性…</p>
        <p v-else-if="selected.propertyError" class="error-text small">{{ selected.propertyError }}</p>
        <details v-else :key="selected.id" class="ep3d-properties" open><summary>EP3D 属性 · {{ selected.properties.length }} 项</summary><dl><template v-for="row in selected.properties" :key="`${row.set}:${row.name}`"><dt>{{ row.name }}</dt><dd>{{ row.value }}</dd></template></dl></details>
      </div>
      <p v-else class="ep3d-hint">{{ readOnly ? '历史界面支持查看模型属性；焊工作业由当日盖面记录确定。' : '选中 1 名焊工后，点击真实焊缝可直接派工；仅查看属性时先取消焊工选择。' }}</p>
    </template>
  </section>
</template>
