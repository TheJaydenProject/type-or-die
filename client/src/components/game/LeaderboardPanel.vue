<script setup>
import { computed } from 'vue'

const props = defineProps({
  players: { type: Object, required: true },
  playerId: { type: String, required: true },
  totalSentences: { type: Number, default: 1 },
  // Keeping as a Prop function to match the logic in GameScreen
  onPlayerClick: { type: Function, default: null }, 
  highlightedPlayerId: String
})

// Sort players based on status (Alive first), completion, then accuracy
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

const currentPlayer = computed(() => props.players[props.playerId] || {})

// Calculate accuracy for the stats panel
const accuracy = computed(() => {
  const p = currentPlayer.value
  return p.totalTypedChars > 0 
    ? ((p.totalCorrectChars / p.totalTypedChars) * 100).toFixed(1) 
    : 100
})

// Handle click logic safely
const handleEntryClick = (player) => {
  if (props.onPlayerClick && player.status === 'ALIVE') {
    props.onPlayerClick(player.id)
  }
}
</script>

<template>
  <div class="leaderboard-zone">
    <div class="lb-header">LIVE LEADERBOARD</div>
    
    <div class="lb-list">
      <div 
        v-for="(player, idx) in sortedPlayers" 
        :key="player.id"
        class="lb-entry"
        :class="{
          'lb-dead': player.status === 'DEAD',
          'lb-you': player.id === (highlightedPlayerId || playerId),
          'lb-clickable': !!onPlayerClick && player.status === 'ALIVE'
        }"
        @click="handleEntryClick(player)"
        :style="{ cursor: (onPlayerClick && player.status === 'ALIVE') ? 'pointer' : 'default' }"
      >
        <div class="lb-rank">
          {{ idx + 1 }}. {{ player.nickname }}
          {{ player.status === 'DEAD' ? ' [X]' : '' }}
        </div>
        
        <div class="lb-bar">
          <div 
            class="lb-fill" 
            :style="{ width: `${(player.completedSentences / totalSentences) * 100}%` }"
          ></div>
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
      <div class="stats-line">ACC: {{ accuracy }}%</div>
      <div class="stats-line">HIT: {{ currentPlayer.totalCorrectChars || 0 }}</div>
      <div class="stats-line">ERR: {{ currentPlayer.totalMistypes || 0 }}</div>
    </div>
  </div>
</template>