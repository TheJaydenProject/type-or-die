<script setup lang="ts">
import { computed } from 'vue'
import { PlayerState } from '@typeordie/shared'

const props = defineProps<{
  players: Record<string, PlayerState>
  playerId: string
  totalSentences: number
  highlightedPlayerId?: string
  onPlayerClick?: (id: string) => void
}>()

// Sort players based on pure race metrics: Status -> Completion -> Correct Chars
const sortedPlayers = computed(() => {
  return Object.values(props.players).sort((a, b) => {
    // 1. Status (Alive first)
    if (a.status === 'ALIVE' && b.status !== 'ALIVE') return -1
    if (a.status !== 'ALIVE' && b.status === 'ALIVE') return 1
    
    // 2. Sentence Completion (Highest first)
    if (b.completedSentences !== a.completedSentences) {
      return b.completedSentences - a.completedSentences
    }

    // 3. Efficiency Score (Correct - Mistakes)
    const scoreA = a.totalCorrectChars - a.totalMistypes
    const scoreB = b.totalCorrectChars - b.totalMistypes

    if (scoreB !== scoreA) {
      return scoreB - scoreA
    }

    // 4. Tie-Breaker (Raw Speed)
    return b.totalCorrectChars - a.totalCorrectChars
  })
})

// Current player lookup
const currentPlayer = computed(() => props.players[props.playerId])

// Calculate accuracy for the stats panel
const accuracy = computed(() => {
  const p = currentPlayer.value
  if (!p) return '100.0'
  
  return p.totalTypedChars > 0 
    ? ((p.totalCorrectChars / p.totalTypedChars) * 100).toFixed(1) 
    : '100.0'
})

// Handle click logic
const handleEntryClick = (player: PlayerState) => {
  if (props.onPlayerClick && player.status === 'ALIVE') {
    props.onPlayerClick(player.id)
  }
}
</script>

<template>
  <div class="leaderboard-zone">
    <div class="lb-header">LIVE RANKING</div>
    
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
          {{ player.status === 'DEAD' ? ' [KIA]' : '' }}
        </div>
        
        <div class="lb-bar">
          <div 
            class="lb-fill" 
            :style="{ width: `${(player.completedSentences / totalSentences) * 100}%` }"
          ></div>
        </div>
        
        <div class="lb-stats">
          <span>PROGRESS: {{ player.completedSentences }}/{{ totalSentences }}</span>
          <span>CHAMBER: {{ player.status === 'ALIVE' ? `1/${player.rouletteOdds}` : '--' }}</span>
          <span>SPEED: {{ player.averageWPM || 0 }} WPM</span>
        </div>
      </div>
    </div>

    <div class="stats-panel">
      <div class="stats-header">YOUR DATA</div>
      <div class="stats-line">ACCURACY: {{ accuracy }}%</div>
      <div class="stats-line">TOTAL HITS: {{ currentPlayer?.totalCorrectChars || 0 }}</div>
      <div class="stats-line">TOTAL ERRORS: {{ currentPlayer?.totalMistypes || 0 }}</div>
    </div>
  </div>
</template>