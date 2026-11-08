<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
const props = defineProps({ unit: String, lines: { type: Array, default: () => [] }, selected: Object, ready: Boolean })
const emit = defineEmits(['search', 'select', 'focus'])
const query = ref(''), rootOpen = ref(true), linePage = ref(0), expanded = ref(new Set()), childPages = ref({})
const lineSize = 40, childSize = 60
const pages = computed(() => Math.max(1, Math.ceil(props.lines.length / lineSize)))
const pageLines = computed(() => props.lines.slice(linePage.value * lineSize, (linePage.value + 1) * lineSize))
let timer
watch([query, () => props.unit, () => props.ready], () => {
  clearTimeout(timer); linePage.value = 0
  timer = setTimeout(() => emit('search', query.value), 150)
}, { immediate: true })
watch(() => props.unit, () => { query.value = ''; expanded.value = new Set(); childPages.value = {}; rootOpen.value = true })
function reveal() {
  const index = props.lines.findIndex(line => line.objects.some(object => object.id === props.selected?.id))
  if (index < 0) return
  const line = props.lines[index]
  rootOpen.value = true; linePage.value = Math.floor(index / lineSize)
  expanded.value = new Set([...expanded.value, line.id])
  childPages.value = { ...childPages.value, [line.id]: Math.floor(line.objects.findIndex(object => object.id === props.selected.id) / childSize) }
}
watch(() => props.selected?.id, reveal, { immediate: true })
watch(() => props.lines, lines => {
  if (query.value.trim() && lines.length <= 8) expanded.value = new Set([...expanded.value, ...lines.map(line => line.id)])
  reveal()
})
function toggle(id) { const next = new Set(expanded.value); next.has(id) ? next.delete(id) : next.add(id); expanded.value = next }
function isOpen(line) { return expanded.value.has(line.id) }
function children(line) { const page = childPages.value[line.id] || 0; return line.objects.slice(page * childSize, (page + 1) * childSize) }
onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <div class="ep3d-tree-browser">
    <input v-model="query" class="ep3d-search" aria-label="搜索结构树" placeholder="搜索当前单元的管线、元件、焊缝" :disabled="!ready">
    <p class="ep3d-caption">当前单元结构树 · {{ lines.length }} 条{{ query.trim() ? '匹配' : '' }}管线</p>
    <div class="ep3d-tree" role="tree" aria-label="EP3D 模型结构树">
      <div role="treeitem" :aria-expanded="rootOpen">
        <button class="tree-unit" @click="rootOpen = !rootOpen"><span>{{ rootOpen ? '▾' : '▸' }}</span>{{ unit === 'ALL' ? '全部单元' : `单元 ${unit}` }}</button>
        <ul v-if="rootOpen" role="group" class="tree-lines">
          <li v-for="line in pageLines" :key="line.id" role="treeitem" :aria-expanded="isOpen(line)">
            <button class="tree-line" :aria-label="`${isOpen(line) ? '收起' : '展开'}管线 ${line.label}`" @click="toggle(line.id)"><span>{{ isOpen(line) ? '▾' : '▸' }}</span><span class="tree-line-label" :title="line.label">{{ line.label }}</span><small>{{ line.objects.length }}</small></button>
            <ul v-if="isOpen(line)" role="group" class="tree-objects">
              <li v-for="object in children(line)" :key="object.id" role="treeitem" :aria-selected="selected?.id === object.id" class="tree-object" :class="{ active: selected?.id === object.id }">
                <button class="tree-object-main" :aria-label="`选择${object.isWeld ? '焊缝' : '元件'} ${object.label || object.kind} ${object.id}`" @click="$emit('select', object.id)"><span class="tree-kind" :class="{ weld: object.isWeld }">{{ object.isWeld ? '焊缝' : object.kind }}</span><span :title="object.label || object.id">{{ object.label || object.id }}</span></button>
                <button v-if="object.bounds" class="weld-focus-button" :aria-label="`定位${object.isWeld ? '焊缝' : '元件'} ${object.label || object.kind} ${object.id}`" @click="$emit('focus', object.id)">定位</button>
              </li>
              <li v-if="line.objects.length > childSize" role="none" class="tree-paging"><button :disabled="!(childPages[line.id] || 0)" @click="childPages[line.id]--">上一页</button><span>{{ (childPages[line.id] || 0) + 1 }} / {{ Math.ceil(line.objects.length / childSize) }}</span><button :disabled="(childPages[line.id] || 0) + 1 >= Math.ceil(line.objects.length / childSize)" @click="childPages[line.id] = (childPages[line.id] || 0) + 1">下一页</button></li>
            </ul>
          </li>
        </ul>
      </div>
      <p v-if="!lines.length" class="ep3d-hint">{{ ready ? '没有匹配的树节点' : '正在读取结构树…' }}</p>
    </div>
    <div v-if="rootOpen && pages > 1" class="tree-paging"><button :disabled="linePage === 0" aria-label="上一页管线" @click="linePage--">上一页</button><span>管线 {{ linePage + 1 }} / {{ pages }}</span><button :disabled="linePage + 1 >= pages" aria-label="下一页管线" @click="linePage++">下一页</button></div>
  </div>
</template>
