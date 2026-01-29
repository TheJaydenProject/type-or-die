<script setup>
defineProps({
  remainingTime: { type: Number, required: true },
  mistakeStrikes: { type: Number, default: 0 },
  currentSentenceIndex: { type: Number, default: 0 },
  totalSentences: { type: Number, default: 0 },
  mistypeFlash: { type: Boolean, default: false }
})
</script>

<template>
  <div class="game-status-bar">
    <div class="strikes-container">
      <span 
        v-for="n in 3" 
        :key="n"
        class="strike-box"
        :class="{
          'crossed': (n - 1) < mistakeStrikes,
          'flash-strike': mistypeFlash && (n - 1) === (mistakeStrikes - 1)
        }"
      >
        {{ (n - 1) < mistakeStrikes ? '☒' : '☐' }}
      </span>
    </div>
    
    <span class="term-label">
      SENTENCE {{ currentSentenceIndex + 1 }}/{{ totalSentences }}
    </span>
    
    <span class="term-timer" :class="{ 'critical': remainingTime < 5 }">
      {{ remainingTime.toFixed(1) }}S
    </span>
  </div>
</template>