<script setup>
import { computed } from 'vue'
const props = defineProps({ history: Object, paused: Boolean })
const emit = defineEmits(['date', 'play', 'seconds', 'walk', 'restart', 'pause'])
const dates = computed(() => props.history.manifest?.dates || [])
const index = computed(() => Math.max(0, dates.value.indexOf(props.history.date)))
const peak = computed(() => Math.max(1, ...Object.values(props.history.manifest?.daily || {}).map(day => day.welds)))
const ticks = computed(() => [...new Set([0, Math.floor(dates.value.length / 4), Math.floor(dates.value.length / 2), Math.floor(dates.value.length * .75), dates.value.length - 1])].filter(i => i >= 0).map(i => dates.value[i]))
function changeDate(event) {
  if (!dates.value.includes(event.target.value)) { event.target.value = props.history.date; return }
  emit('date', event.target.value)
}
</script>
<template>
  <section class="history-timeline" aria-label="历史派工日期时间轴">
    <div class="history-timeline-heading"><strong>历史派工回放</strong><span>{{ history.summary?.workers || 0 }} 名盖面焊工 · {{ history.summary?.welds || 0 }} 道焊口</span><span class="history-day-duration">{{ (history.dayElapsed || 0).toFixed(1) }} / 每天 {{ Math.ceil((history.dayDuration || 0) * 10) / 10 }} 秒（固定，含行走）</span><progress aria-label="当日作业演示进度" :max="history.dayDuration || 1" :value="history.dayElapsed || 0"></progress><span v-if="history.loading" class="muted">正在读取…</span><span v-if="history.error" class="error-text">{{ history.error }} <button @click="$emit('date', history.date)">重试</button></span></div>
    <div class="history-date-controls">
      <button aria-label="上一天" :disabled="index === 0" @click="$emit('date', dates[index - 1])">←</button>
      <input type="date" aria-label="历史派工日期" :min="dates[0]" :max="dates.at(-1)" :value="history.date" @change="changeDate">
      <button aria-label="下一天" :disabled="index + 1 >= dates.length" @click="$emit('date', dates[index + 1])">→</button>
      <button class="primary" :disabled="!dates.length" @click="$emit('play')">{{ history.playing ? '暂停日期回放' : '播放日期回放' }}</button>
      <select aria-label="日期回放速度" :value="history.playbackSeconds" @change="$emit('seconds', Number($event.target.value))"><option :value="2">2 秒 / 天</option><option :value="4">4 秒 / 天</option><option :value="8">8 秒 / 天</option></select>
      <select aria-label="历史行走速度" :value="history.walkSpeed" @change="$emit('walk', Number($event.target.value))"><option :value="30">行走 30 m/s</option><option :value="120">行走 120 m/s</option><option :value="300">行走 300 m/s</option></select>
      <button @click="$emit('pause')">{{ paused ? '恢复动作' : '暂停动作' }}</button>
      <button @click="$emit('restart')">重新演示当天</button>
    </div>
    <div class="history-date-track">
      <div class="history-bars" aria-hidden="true"><i v-for="day in dates" :key="day" :class="{ current: day === history.date }" :style="{ height: `${Math.max(2, (history.manifest.daily[day]?.welds || 0) / peak * 100)}%` }"></i></div>
      <input type="range" aria-label="历史日期时间轴" min="0" :max="Math.max(0, dates.length - 1)" step="1" :value="index" @input="$emit('date', dates[Number($event.target.value)])">
    </div>
    <div class="history-ticks"><span v-for="tick in ticks" :key="tick">{{ tick }}</span></div>
    <p class="history-caveat">严格按设定日时长播放，每秒最多展示 1 道焊口（含快速行走），多余焊口不演示，台账统计不变。调整时长或行走速度会重新演示当天。台账无日内时刻，行走与先后顺序仅为示意。</p>
  </section>
</template>
