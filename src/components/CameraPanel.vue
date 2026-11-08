<script setup>
defineProps({ mode: String, followedId: String, workers: Array, disabled: Boolean, readOnly: Boolean, distance: { type: Number, default: 6 }, targetDistance: { type: Number, default: 6 }, manualSpeed: { type: Number, default: 4.5 } })
defineEmits(['mode', 'worker', 'previous', 'next', 'distance', 'speed', 'reset'])
</script>

<template>
  <section class="camera-panel" aria-label="视角控制">
    <div class="section-title"><h2>视角控制</h2><span class="muted small">{{ mode === 'worker' ? (distance < 0.55 ? '第一人称操控' : '第三人称操控') : '自由审阅' }}</span></div>
    <div class="camera-tabs">
      <button :disabled="disabled" :class="{ active: mode === 'review' }" :aria-pressed="mode === 'review'" @click="$emit('mode', 'review')">审阅视角</button>
      <button :disabled="disabled || !workers.length" :class="{ active: mode === 'worker' }" :aria-pressed="mode === 'worker'" @click="$emit('mode', 'worker')">焊工视角</button>
    </div>
    <div class="camera-worker-controls">
      <button aria-label="上一名焊工" title="上一名焊工（←）" :disabled="disabled || !workers.length" @click="$emit('previous')">←</button>
      <select aria-label="视角跟随焊工" :disabled="disabled || !workers.length" :value="followedId || ''" @change="$emit('worker', $event.target.value)">
        <option value="" disabled>选择焊工</option>
        <option v-for="worker in workers" :key="worker.id" :value="worker.id">{{ worker.id }}</option>
      </select>
      <button aria-label="下一名焊工" title="下一名焊工（→）" :disabled="disabled || !workers.length" @click="$emit('next')">→</button>
    </div>
    <details v-if="mode === 'worker'" class="worker-settings">
      <summary>{{ readOnly ? '跟随设置' : `操控设置 · ${manualSpeed} m/s` }} · {{ distance.toFixed(1) }} m</summary>
      <label v-if="!readOnly">手动速度<select aria-label="手动移动速度" :value="manualSpeed" @change="$emit('speed', Number($event.target.value))"><option :value="2">2 m/s</option><option :value="4.5">4.5 m/s</option><option :value="8">8 m/s</option><option :value="16">16 m/s</option></select></label>
      <label>跟随距离<input aria-label="焊工相机距离" type="range" min="0" max="25" step="0.5" :value="targetDistance" @input="$emit('distance', Number($event.target.value))"></label>
      <button class="full" @click="$emit('reset')">恢复背后视角</button>
    </details>
    <p v-if="mode === 'worker' && readOnly" class="camera-shortcuts">拖动鼠标观察 · 滚轮远近<br>← → 切人 · Esc 返回审阅<br>历史作业位置由台账决定</p>
    <p v-else-if="mode === 'worker'" class="camera-shortcuts">WASD 移动 · 空格跳跃<br>左键观察 · 右键转向 · 双键前进<br>滚轮远近 · ← → 切人 · Esc 审阅</p>
    <p v-else class="camera-shortcuts">← → 切换当前单元焊工 · Esc 返回审阅</p>
  </section>
</template>
