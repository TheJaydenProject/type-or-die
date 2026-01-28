<template>
  <div class="game-status-bar">
    <div class="strikes-container">
      <span 
        v-for="i in 3"
        :key="i - 1"
        :class="[
          'strike-box',
          { 'crossed': (i - 1) < mistakeStrikes },
          { 'flash-strike': mistypeFlash && (i - 1) === mistakeStrikes - 1 }
        ]"
      >
        {{ (i - 1) < mistakeStrikes ? '☒' : '☐' }}
      </span>
    </div>
    
    <span class="term-label">
      SENTENCE {{ currentSentenceIndex + 1 }}/{{ totalSentences }}
    </span>
    
    <span 
      :class="['term-timer', { 'critical': remainingTime < 5 }]"
    >
      {{ remainingTime.toFixed(1) }}S
    </span>
  </div>
</template>

<script setup>
defineProps({
  remainingTime: {
    type: Number,
    required: true
  },
  mistakeStrikes: {
    type: Number,
    required: true
  },
  currentSentenceIndex: {
    type: Number,
    required: true
  },
  totalSentences: {
    type: Number,
    required: true
  },
  mistypeFlash: {
    type: Boolean,
    required: true
  }
})
</script>