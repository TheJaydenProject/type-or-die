<template>
  <div class="results-overlay">
    <div v-if="!gameEndData || !room || !playerId" class="terminal-results error-state">
      <div class="results-header">
        <span>FATAL ERROR</span>
        <span>DATA_CORRUPT</span>
      </div>
      <div class="error-body">
        <p>CRITICAL SYSTEM FAILURE</p>
        <p>SESSION LOST</p>
        <button @click="$emit('mainMenu')" class="results-btn primary">
          FORCE ABORT
        </button>
      </div>
    </div>

    <div v-else class="terminal-results">
      <div class="results-header">
        <span class="header-title">MISSION REPORT</span>
        <span class="header-id">ID: {{ room.roomCode }}</span>
      </div>

      <div class="results-grid">
        <!-- LEFT COLUMN: SUMMARY -->
        <div class="results-summary">
          <div class="grade-container">
            <span class="grade-label">ASSESSMENT</span>
            <span :class="`grade-value grade-${grade}`">{{ grade }}</span>
          </div>

          <div class="stats-block">
            <div class="stat-row">
              <span class="stat-label">STATUS</span>
              <span :class="['stat-value', currentPlayer.status === 'DEAD' ? 'status-dead' : 'status-alive']">
                {{ currentPlayer.status || 'SPECTATOR' }}
              </span>
            </div>
            <div class="stat-row">
              <span class="stat-label">COMPLETION</span>
              <span class="stat-value">{{ currentPlayer.completedSentences || 0 }}/{{ totalSentences }}</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">ACCURACY</span>
              <span class="stat-value">{{ accuracy }}%</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">SPEED</span>
              <span class="stat-value">{{ currentPlayer.averageWPM || 0 }} WPM</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">ERRORS</span>
              <span class="stat-value">{{ currentPlayer.totalMistypes || 0 }}</span>
            </div>
          </div>
        </div>

        <!-- RIGHT COLUMN: DATA TABS -->
        <div class="results-data">
          <div class="tabs-nav">
            <button 
              :class="['tab-btn', { 'active': activeTab === 'leaderboard' }]"
              @click="activeTab = 'leaderboard'"
            >
              RANKING
            </button>
            <button 
              :class="['tab-btn', { 'active': activeTab === 'sentences' }]"
              @click="activeTab = 'sentences'"
            >
              LOGS
            </button>
            <button 
              :class="['tab-btn', { 'active': activeTab === 'roulette' }]"
              @click="activeTab = 'roulette'"
            >
              CASUALTY
            </button>
          </div>

          <div class="tab-viewport">
            <!-- LEADERBOARD TAB -->
            <div v-if="activeTab === 'leaderboard'" class="data-list">
              <div 
                v-for="(player, i) in sortedPlayers" 
                :key="player.id"
                :class="[
                  'data-row',
                  { 'is-self': player.id === playerId },
                  { 'is-dead': player.status === 'DEAD' }
                ]"
              >
                <span class="row-rank">{{ String(i + 1).padStart(2, '0') }}</span>
                <span class="row-name">
                  {{ player.nickname }}
                  <span v-if="player.id === winnerId" class="badge-win">[WINNER]</span>
                  <span v-if="player.status === 'DEAD'" class="badge-dead">[KIA]</span>
                </span>
                <span class="row-stat">{{ player.completedSentences }}/{{ totalSentences }}</span>
                <span class="row-stat">{{ player.averageWPM }} WPM</span>
              </div>
            </div>

            <!-- SENTENCES TAB -->
            <div v-else-if="activeTab === 'sentences'" class="data-list">
              <div 
                v-for="(sentence, idx) in sentenceHistory" 
                :key="idx"
                class="data-row history-row"
              >
                <span class="row-index">{{ String(sentence.sentenceIndex + 1).padStart(2, '0') }}</span>
                <span class="row-content">
                  {{ sentence.completed ? 'COMPLETED' : `FAILED: ${sentence.deathReason}` }}
                </span>
                <span class="row-stat">{{ sentence.wpm || 0 }} WPM</span>
                <span class="row-stat">{{ sentence.timeUsed.toFixed(1) }}s</span>
              </div>
              <div v-if="!sentenceHistory.length" class="empty-state">
                NO_DATA_AVAILABLE
              </div>
            </div>

            <!-- ROULETTE TAB -->
            <div v-else-if="activeTab === 'roulette'" class="data-list">
              <div 
                v-for="(roulette, i) in reversedRouletteHistory" 
                :key="i"
                :class="['data-row', 'roulette-row', roulette.survived ? 'survived' : 'fatal']"
              >
                <span class="row-odds">{{ roulette.odds }}</span>
                <span class="row-chamber">[{{ roulette.survived ? 'EMPTY' : 'BULLET' }}]</span>
                <span class="row-result">{{ roulette.survived ? 'SURVIVED' : 'FATAL' }}</span>
              </div>
              <div v-if="!reversedRouletteHistory.length" class="empty-state">
                NO_CASUALTY_EVENTS
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="results-actions">
        <button @click="$emit('replay')" class="results-btn">
          RETURN TO LOBBY
        </button>
        <button @click="$emit('mainMenu')" class="results-btn">
          EXIT TO MENU
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  gameEndData: {
    type: Object,
    required: true
  },
  room: {
    type: Object,
    required: true
  },
  playerId: {
    type: String,
    required: true
  },
  sentences: {
    type: Array,
    required: true
  }
})

defineEmits(['mainMenu', 'replay'])

const activeTab = ref('leaderboard')

const winnerId = computed(() => 
  props.gameEndData?.winnerId
)

const finalStats = computed(() => 
  props.gameEndData?.finalStats || {}
)

const currentPlayer = computed(() => 
  finalStats.value[props.playerId] || {}
)

const totalSentences = computed(() => 
  props.sentences?.length || props.room.settings?.sentenceCount || 0
)

const grade = computed(() => {
  const player = currentPlayer.value
  
  if (!player || player.status === 'SPECTATOR') return '-'
  if (player.status === 'DEAD') return 'F'
  if (!player.totalTypedChars) return '-'
  
  const acc = player.totalCorrectChars / player.totalTypedChars
  
  if (acc === 1) return 'SS'
  if (acc > 0.98) return 'S'
  if (acc > 0.95) return 'A'
  if (acc > 0.90) return 'B'
  return 'C'
})

const accuracy = computed(() => {
  const player = currentPlayer.value
  if (player.totalTypedChars > 0) {
    return ((player.totalCorrectChars / player.totalTypedChars) * 100).toFixed(2)
  }
  return "0.00"
})

const sortedPlayers = computed(() => {
  return Object.values(finalStats.value).sort((a, b) => {
    if (a.id === winnerId.value) return -1
    if (b.id === winnerId.value) return 1
    if (a.status === 'ALIVE' && b.status !== 'ALIVE') return -1
    if (a.status !== 'ALIVE' && b.status === 'ALIVE') return 1
    return b.completedSentences - a.completedSentences
  })
})

const sentenceHistory = computed(() => 
  currentPlayer.value.sentenceHistory || []
)

const reversedRouletteHistory = computed(() => 
  [...(currentPlayer.value.rouletteHistory || [])].reverse()
)
</script>

<style>
@import './GameEndScreen.css';
</style>