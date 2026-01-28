<template>
  <div class="leaderboard-zone">
    <div class="lb-header">LIVE LEADERBOARD</div>
    <div class="lb-list">
      <div
        v-for="(player, idx) in sortedPlayers"
        :key="player.id"
        :class="[
          'lb-entry',
          { 'lb-dead': player.status === 'DEAD' },
          { 'lb-you': player.id === (highlightedPlayerId || playerId) },
          { 'lb-clickable': onPlayerClick && player.status === 'ALIVE' }
        ]"
        @click="handlePlayerClick(player)"
        :style="{ cursor: onPlayerClick && player.status === 'ALIVE' ? 'pointer' : 'default' }"
      >
        <div class="lb-rank">
          {{ idx + 1 }}. {{ player.nickname }}
          {{ player.status === 'DEAD' ? ' [X]' : '' }}
        </div>
        <div class="lb-bar">
          <div 
            class="lb-fill" 
            :style="{ width: `${(player.completedSentences / totalSentences) * 100}%` }"
          />
        </div>
        <div class="lb-stats">
          <span>{{ player.completedSentences }}/{{ totalSentences }}</span>
          <span>{{ player.status === 'ALIVE' ? `1/${player.rouletteOdds}` : '--' }}</span>
          <span>WPM {{ player.averageWPM || 0 }}</span>
        </div>
      </div>
    </div>

    <div class="stats-panel">
      <div class="stats-header">YOUR DATA</div>
      <div class="stats-line">
        ACC: {{ currentPlayer.totalTypedChars > 0 
          ? ((currentPlayer.totalCorrectChars / currentPlayer.totalTypedChars) * 100).toFixed(1) 
          : 100 }}%
      </div>
      <div class="stats-line">HIT: {{ currentPlayer.totalCorrectChars || 0 }}</div>
      <div class="stats-line">ERR: {{ currentPlayer.totalMistypes || 0 }}</div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  players: {
    type: Object,
    required: true
  },
  playerId: {
    type: String,
    required: true
  },
  totalSentences: {
    type: Number,
    required: true
  },
  onPlayerClick: {
    type: Function,
    default: undefined
  },
  highlightedPlayerId: {
    type: String,
    default: null
  }
})

const sortedPlayers = computed(() => {
  return Object.values(props.players).sort((a, b) => {
    if (a.status === 'ALIVE' && b.status !== 'ALIVE') return -1
    if (a.status !== 'ALIVE' && b.status === 'ALIVE') return 1
    if (b.completedSentences !== a.completedSentences) {
      return b.completedSentences - a.completedSentences
    }
    return b.totalCorrectChars - a.totalCorrectChars
  })
})

const currentPlayer = computed(() => 
  props.players[props.playerId] || {}
)

function handlePlayerClick(player) {
  if (props.onPlayerClick && player.status === 'ALIVE') {
    props.onPlayerClick(player.id)
  }
}
</script>