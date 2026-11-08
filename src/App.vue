<script setup>
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { DispatchScene } from './scene/DispatchScene.js'
import { UNIT_IDS } from './domain.js'
import ZoneStatus from './components/ZoneStatus.vue'
import CameraPanel from './components/CameraPanel.vue'
import Ep3dPanel from './components/Ep3dPanel.vue'
import HistoryTimeline from './components/HistoryTimeline.vue'
import HistoryRoster from './components/HistoryRoster.vue'
import { DieselHistoryScene } from './scene/DieselHistoryScene.js'

const projectId = ref(new URLSearchParams(location.search).get('project') === 'diesel-4d' ? 'diesel-4d' : 'uae')
const isHistory = computed(() => projectId.value === 'diesel-4d')
const host = ref(null), engine = shallowRef(null), state = ref({ workers: [], zones: [], unit: '213', layer: 0, loaded: 0, errors: 0, site: null, paused: false })
const count = ref(12), gridSize = ref(50), groundElevation = ref(81.105), gridVisible = ref(true), message = ref('正在初始化三维场景…'), fatal = ref(''), ready = ref(false), help = ref(false)
const zoneOpen = ref(true), inspectorOpen = ref(false), treeLines = ref([])
const viewportMedia = window.matchMedia('(max-width: 700px)'), narrowView = ref(viewportMedia.matches)
const viewportChange = event => { narrowView.value = event.matches }
viewportMedia.addEventListener('change', viewportChange)
const today = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long' }).format(new Date())
const history = computed(() => state.value.history || {})
const unitIds = computed(() => isHistory.value ? ['ALL', ...(history.value.manifest?.units || [])] : UNIT_IDS)
const selected = computed(() => state.value.workers.filter(w => w.selected))
const activeWorkers = computed(() => state.value.workers.filter(w => w.unit === state.value.unit))
const totals = computed(() => {
  const workers = state.value.workers, assigned = workers.filter(w => w.zone).length
  if (isHistory.value) return { total: history.value.summary?.workers || 0, reserve: Math.max(0, (history.value.summary?.workers || 0) - assigned), moving: workers.filter(w => w.historicalMoving).length, assigned, welding: workers.filter(w => w.weldTask?.status === 'welding').length }
  return { total: workers.length, reserve: workers.filter(w => !w.zone).length, moving: workers.filter(w => w.target || w.manualMoving).length, assigned, welding: workers.filter(w => w.weldTask?.status === 'welding').length }
})
const workerStatus = computed(() => selected.value.some(w => w.weldTask?.status === 'welding') ? (state.value.paused ? '焊接暂停' : '焊接中') : selected.value.some(w => w.weldTask) ? '前往焊缝' : selected.value.some(w => w.jumping) ? '跳跃中' : selected.value.some(w => w.manualMoving) ? '手动移动' : selected.value.some(w => w.target) ? (state.value.paused ? '移动暂停' : '前往目标') : '待命')
const layers = computed(() => Array.from({ length: state.value.site?.ny || 1 }, (_, i) => i))
watch(() => `${state.value.unit}:${activeWorkers.value.length}`, () => { count.value = activeWorkers.value.length })
watch(() => state.value.site?.groundElevation, value => { if (value !== undefined) groundElevation.value = value })
watch(() => state.value.ep3d?.selectionVersion, () => { if (state.value.ep3d?.selected) inspectorOpen.value = true })
function searchWelds(query) { treeLines.value = engine.value?.ep3d.tree(query) || [] }
function applyCount() { try { engine.value.setCount(Number(count.value)); message.value = `${state.value.unit} 单元已设置 ${count.value} 名焊工 · 其他单元人数不变` } catch (e) { message.value = e.message } }
function switchUnit(unit, force = false) { if (!ready.value || (!force && state.value.unit === unit)) return; engine.value.loadUnit(unit, { force }); message.value = `${force ? '重新' : '正在按需'}加载 ${unit} 单元 ${isHistory.value ? ' · 按当前日期筛选作业记录' : ' · 已保留其他单元的人员位置'}` }
function applyGround() { try { engine.value.setGroundElevation(Number(groundElevation.value)); message.value = `${state.value.unit} 单元地面已校准至模型标高 ${Number(groundElevation.value).toFixed(3)} m，预备区、网格及人物已对齐` } catch (e) { message.value = e.message } }
function selectWorker(id) { engine.value.select([id]) }
function toggleGrid() { gridVisible.value = !gridVisible.value; engine.value.gridVisible = gridVisible.value; engine.value.cubes.visible = gridVisible.value }
function pause() { engine.value.paused = !engine.value.paused; if (isHistory.value) engine.value.scheduleJustReset = true; engine.value.emit() }
function returnSelected() { engine.value.command(null, true) }
function reload() { window.location.reload() }
let projectVersion = 0
async function mountProject(id) {
  const version = ++projectVersion
  ready.value = false; gridVisible.value = id === 'uae'; fatal.value = ''; inspectorOpen.value = false; treeLines.value = []
  engine.value?.dispose(); engine.value = null
  state.value = { workers: [], zones: [], unit: id === 'uae' ? '213' : 'ALL', layer: 0, loaded: 0, errors: 0, site: null, paused: false }
  const url = new URL(location.href); url.searchParams.set('project', id); window.history.replaceState(null, '', url)
  try {
    const current = new (id === 'diesel-4d' ? DieselHistoryScene : DispatchScene)(host.value, next => { if (version === projectVersion) state.value = next }, text => { if (version === projectVersion) message.value = text })
    engine.value = current
    await current.init()
    if (version !== projectVersion) return
    if (id === 'uae' && !current.restore()) current.setCount(12)
    count.value = activeWorkers.value.length; ready.value = true
    if (id === 'uae') message.value = '点击人物后点工区派工 · 中键平移 / Shift＋中键旋转 · ← → 切换焊工视角'
  } catch (e) { if (version === projectVersion) { fatal.value = `场景初始化失败：${e.message}`; message.value = fatal.value } }
}
function changeHistoryDate(day) { engine.value.playing = false; void engine.value.setDate(day) }
function toggleHistoryPlay() { engine.value.toggleDatePlayback() }
onMounted(() => mountProject(projectId.value))
onBeforeUnmount(() => { viewportMedia.removeEventListener('change', viewportChange); engine.value?.dispose() })
</script>

<template>
  <div class="app-shell" :class="{ 'history-app-shell': isHistory }">
    <header class="app-header"><div class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></div><h1>派工可视化平台</h1><select v-model="projectId" class="project-switch" aria-label="项目界面" :disabled="!ready" @change="mountProject(projectId)"><option value="uae">阿联酋ADNOC项目 · 派工</option><option value="diesel-4d">柴油轻馏分优化利用项目 · 历史派工</option></select><time>{{ today }}</time></header>
    <aside class="sidebar" :class="{ 'history-sidebar': isHistory }">
      <HistoryRoster v-if="isHistory" :history="history" :selected-id="selected[0]?.id || ''" @worker="engine.focusHistoricalWorker($event)" @weld="engine.focusHistoryRecord($event)" />
      <section v-if="!isHistory" class="crew-section"><h2>今日焊工 <span>{{ state.unit }} 单元</span></h2><form @submit.prevent="applyCount"><label class="count-field"><input v-model="count" aria-label="今日焊工人数" type="number" min="0" max="200" step="1" required><span>人</span></label><button class="primary full" type="submit" :disabled="!ready">设置人数</button></form><p class="muted small">每单元 0–200 人 · 只调整当前单元人数</p></section>
      <section><div class="section-title"><h2>单元加载</h2><span class="muted small">按需加载</span></div><nav aria-label="模型单元"><button v-for="unit in unitIds" :key="unit" class="unit-row" :class="{ active: state.unit === unit }" :disabled="!ready" @click="switchUnit(unit)"><span class="unit-icon" aria-hidden="true">▱</span><strong>{{ unit === 'ALL' ? '全部单元' : unit }}</strong><span class="unit-count">{{ isHistory ? (unit === 'ALL' ? (history.projectSummary?.workers || 0) : (history.unitCounts?.[unit] || 0)) : state.workers.filter(w => w.unit === unit).length }} 人</span><span class="unit-indicator" :class="{ lit: state.unit === unit }"></span></button></nav></section>
      <section v-if="!isHistory" class="selection-section"><div class="section-title"><h2>选中焊工</h2><span class="selection-number">{{ selected.length }} 人</span></div><template v-if="selected.length"><div class="worker-detail"><img class="worker-avatar worker-portrait" src="/models/workers/worker.jpg" alt="Quaternius 工人模型"><div><h3>{{ selected.length === 1 ? selected[0].id : `${selected.length} 人编队` }}</h3><p class="worker-state"><i></i>{{ workerStatus }}</p></div></div><dl><dt>所属单元</dt><dd>{{ state.unit }}</dd><dt>当前位置</dt><dd>{{ selected.length === 1 ? (selected[0].zone || '预备区') : '多个人员' }}</dd><template v-if="selected.length === 1 && selected[0].weldTask"><dt>绑定焊缝</dt><dd>{{ selected[0].weldTask.name }}</dd><dt>所属管线</dt><dd>{{ selected[0].weldTask.line }}</dd></template><dt>目标位置</dt><dd>{{ selected[0].target ? selected[0].target.map(v => v.toFixed(1)).join(', ') + ' m' : '—' }}</dd></dl><div class="button-pair"><button @click="returnSelected">返回预备区</button><button @click="engine.stop()">{{ selected.some(w => w.weldTask) ? "停止作业" : "停止移动" }}</button></div></template><div v-else class="empty-selection"><span class="selection-cross" aria-hidden="true"></span><p>点击人物以选中焊工</p><span>也可在场景中拖动框选</span></div></section>
      <section v-if="!isHistory" class="roster-section"><div class="section-title"><h2>人员列表</h2><button class="text-button" :disabled="!ready" @click="engine.select(activeWorkers.map(w => w.id))">全选</button></div><div class="roster"><button v-for="worker in activeWorkers" :key="worker.id" :class="{ selected: worker.selected }" @click="selectWorker(worker.id)"><span class="person-dot" :class="{ moving: worker.target || worker.manualMoving }"></span><span>{{ worker.id }}</span><span class="roster-location" :class="{ welding: worker.weldTask?.status === 'welding' }">{{ worker.weldTask?.status === 'welding' ? '焊接中' : worker.weldTask ? '前往焊缝' : worker.jumping ? '跳跃中' : worker.manualMoving ? '手动移动' : worker.target ? '移动中' : (worker.zone || '预备区') }}</span></button><p v-if="!activeWorkers.length" class="muted small">当前单元暂无焊工</p></div></section>
      <button class="help-button" :aria-expanded="help" @click="help = !help">操作指南 <span>{{ help ? '收起' : '展开' }}</span></button><div v-if="help && !isHistory" class="help-copy">左键点击人物选中，再点工区地面移动。拖动框选，Shift 加选，A 全选。中键平移、Shift＋中键旋转、滚轮平滑缩放；审阅模式的右键保留给后续菜单。← → 进入并切换当前单元焊工视角，Esc 返回审阅。焊工模式下 WASD 移动、空格跳跃；左键单击焊缝派工、按住拖动观察，右键转向、双键前进，滚轮平滑拉远近，拉近到人物可进入第一人称。手动移动会取消该焊工的自动派工。选中焊缝或元件后呼吸高亮，PageDown 或面板按钮定位；焊工模式定位只看向目标。打开“焊缝与属性”可搜索、定位和查看 EP3D 属性；只选中一名焊工后点击真实焊缝，到位后自动进入焊接状态。每个单元独立设置人数。地面标高使用原始模型标高，可手动校准。首版仍为直线移动，不含设备避障。</div>
      <div v-if="help && isHistory" class="help-copy">按盖面日期回看每日盖面焊工和焊口，拖动底部日期时间轴或选择日期。选择单元筛选，点击焊工查看当日工区和全部焊口，青色点标记该焊工的作业面；点击焊口定位模型。每个焊工每天只有一个人物，严格按设定日时长播放，每秒最多演示 1 道焊口，快速行走包含在演示时段内，时长不足时可自动加快行走，多余焊口不演示但保留台账和统计。默认行走速度 120 m/s，可调节。相邻日期保留同一焊工的位置并行走到下一作业点，暂停动作同时冻结行走与当日进度。该顺序和时长仅为示意，不代表实际作业时刻。未定位和缺盖面焊工的台账保留计数，不生成虚构位置。历史界面只读，可通过视角面板跟随人物，不接受 WASD 移动或重新派工。</div>
      <div id="mobile-ep3d-controls"></div>
      <div id="mobile-camera-controls"></div><div id="mobile-zone-controls"></div>
    </aside>
    <main class="workspace" :class="{ 'history-workspace': isHistory }"><div ref="host" class="scene-host" aria-label="三维派工场景"></div><div class="canvas-toolbar"><div class="toolbar-group"><button :disabled="!ready" @click="engine.overview()">全景</button><button v-if="!isHistory" :disabled="!ready" @click="engine.focusStaging()">预备区</button><button :class="{ toggled: gridVisible }" :disabled="!ready" :aria-pressed="gridVisible" @click="toggleGrid">工区网格</button><button :disabled="!ready" :class="{ toggled: inspectorOpen }" @click="inspectorOpen = !inspectorOpen">焊缝与属性</button><button :disabled="!ready" :class="{ toggled: zoneOpen }" :aria-pressed="zoneOpen" @click="zoneOpen = !zoneOpen">工区统计</button><button :disabled="!ready" :class="{ toggled: state.showDesignModels !== false }" @click="engine.showDesignModels = !engine.showDesignModels">设计模型</button></div><div class="toolbar-group"><label>工区尺寸<select v-model.number="gridSize" :disabled="!ready" @change="engine.setGridSize(gridSize)"><option :value="25">25 m</option><option :value="50">50 m</option><option :value="100">100 m</option></select></label><label>派工楼层<select :value="state.layer" :disabled="!ready" @change="engine.setLayer(Number($event.target.value))"><option v-for="layer in layers" :key="layer" :value="layer">{{ layer + 1 }} 层 · {{ (layer * gridSize + (state.site?.groundElevation || 0)).toFixed(2) }} m</option></select></label></div><form v-if="!isHistory" class="toolbar-group ground-control" @submit.prevent="applyGround"><label>地面标高<input v-model="groundElevation" aria-label="地面标高" type="number" step="0.001" required :disabled="!ready"><span>m</span></label><button type="submit" :disabled="!ready">校准</button></form></div>
      <div class="scene-meta"><span class="live-dot"></span>{{ state.unit === 'ALL' ? '全部单元' : `单元 ${state.unit}` }}<span class="meta-divider"></span>{{ state.loaded }} 个模型瓦片已载入<span v-if="state.errors" class="error-text"> · {{ state.errors }} 个加载异常</span><button class="text-button" :disabled="!ready" @click="switchUnit(state.unit, true)">重新加载</button></div>
      <div class="scene-side-panels"><Teleport defer to="#mobile-camera-controls" :disabled="!narrowView"><CameraPanel :read-only="isHistory" :mode="state.cameraMode || 'review'" :followed-id="state.followedId" :workers="activeWorkers" :disabled="!ready" :distance="state.workerDistance ?? 6" :target-distance="state.workerDistanceTarget ?? 6" :manual-speed="state.manualSpeed || 4.5" @distance="engine.workerController.setDistance($event)" @speed="engine.workerController.moveSpeed = $event" @reset="engine.workerController.resetView()" @mode="engine.setCameraMode($event)" @worker="engine.setCameraMode('worker', $event)" @previous="engine.switchWorker(-1)" @next="engine.switchWorker(1)" /></Teleport>
      <Teleport defer to="#mobile-zone-controls" :disabled="!narrowView"><ZoneStatus v-if="zoneOpen" :read-only="isHistory" :zones="state.zones" :totals="totals" :unit="state.unit" :layer="state.layer" @focus="engine?.focusZone($event)" @close="zoneOpen = false" /></Teleport></div>
      <Teleport defer to="#mobile-ep3d-controls" :disabled="!narrowView"><Ep3dPanel v-if="inspectorOpen" :read-only="isHistory" :unit="state.unit" :model="state.ep3d" :camera-mode="state.cameraMode" :workers="state.workers" :results="treeLines" :ground="state.site?.groundElevation || 0" @close="inspectorOpen = false" @search="searchWelds" @select="engine.selectComponent($event)" @focus="engine.focusComponent($event)" @bind="engine.bindSelectedToWeld($event)" @clear="engine.clearSelection()" /></Teleport>
      <div v-if="fatal" class="fatal-error" role="alert"><h2>三维场景暂不可用</h2><p>{{ fatal }}</p><p>请使用支持 WebGL 2 的浏览器，并确认模型文件已完整复制。</p><button @click="reload">刷新页面</button></div>
      <div v-if="!isHistory" class="scene-bottom"><span class="scene-instruction">{{ state.cameraMode === 'worker' ? `操控 ${state.followedId} · WASD 移动 · 单击焊缝派工 · 拖动观察` : (selected.length ? `已选中 ${selected.length} 人 · 点击工区地面下达移动指令` : '左键选人 / 框选 · 中键平移 · Shift＋中键旋转') }}</span><div class="simulation-controls"><label>派工速度<select :value="state.speed || 16" :disabled="!ready" @change="engine.speed = Number($event.target.value)"><option :value="4">4 m/s</option><option :value="16">16 m/s</option><option :value="30">30 m/s</option><option :value="60">60 m/s</option></select></label><button :disabled="!ready" @click="pause">{{ state.paused ? '继续移动' : '暂停移动' }}</button></div></div>
      <HistoryTimeline v-if="isHistory && history.manifest" :history="history" :paused="state.paused" @date="changeHistoryDate" @play="toggleHistoryPlay" @seconds="engine.setPlaybackSeconds($event)" @walk="engine.setWalkSpeed($event)" @restart="engine.replanDay(); engine.emit()" @pause="pause" />
    </main>
    <footer class="message-bar" role="status"><span class="message-dot"></span>{{ message }}<span class="save-note">{{ isHistory ? '历史台账快照 · 只读展示' : '今日派工自动保存在本机浏览器' }}</span></footer>
  </div>
</template>
