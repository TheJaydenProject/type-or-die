<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  gameEndData: Object,
  room: Object,
  playerId: String,
  sentences: Array
})

const emit = defineEmits(['mainMenu', 'replay'])

const activeTab = ref('leaderboard')

// --- COMPUTED PROPERTIES ---

const isValidSession = computed(() => {
  return props.gameEndData && props.room && props.playerId
})

const winnerId = computed(() => props.gameEndData?.winnerId)
const finalStats = computed(() => props.gameEndData?.finalStats || {})
const currentPlayer = computed(() => finalStats.value[props.playerId] || {})

const totalSentences = computed(() => {
  return props.sentences?.length || props.room?.settings?.sentenceCount || 0
})

/**
 * Calculates player performance grade based on completion and survival status.
 * Grading system:
 * - S: Completed all sentences and survived
 * - P: In progress or partial completion
 * - F: Died before completing all sentences
 * - -: Spectator or invalid status
 */
const grade = computed(() => {
  const p = currentPlayer.value;
  if (!p || !p.status || p.status === 'SPECTATOR') return '-';
  
  if (p.status === 'DEAD') return 'F';
  if (p.completedSentences >= totalSentences.value) return 'S';
  return 'P';
});

/**
 * Calculates typing accuracy as percentage of correct characters vs total typed.
 * Returns "0.00" for players with no input to avoid division by zero.
 */
const accuracy = computed(() => {
  const p = currentPlayer.value
  return p.totalTypedChars > 0
    ? ((p.totalCorrectChars / p.totalTypedChars) * 100).toFixed(2)
    : "0.00"
})

/**
 * Sorts players for leaderboard display using server-side tiebreaker logic.
 * Ranking criteria (in order):
 * 1. Winner takes first place
 * 2. Alive players before dead players
 * 3. Completed sentences (descending)
 * 4. Efficiency score: correct chars - mistakes (descending)
 * 5. Total correct chars (descending)
 * 
 * NOTE: This mirrors the checkGameOver() logic in playerActionHandlers.ts
 */
const sortedPlayers = computed(() => {
  return Object.values(finalStats.value).sort((a, b) => {
    // Winner always first
    if (a.id === winnerId.value) return -1
    if (b.id === winnerId.value) return 1
    
    // Alive players before dead
    if (a.status === 'ALIVE' && b.status !== 'ALIVE') return -1
    if (a.status !== 'ALIVE' && b.status === 'ALIVE') return 1
    
    // Primary: Sentence completion
    if (b.completedSentences !== a.completedSentences) {
      return b.completedSentences - a.completedSentences
    }
    
    // Secondary: Efficiency (correct - mistakes)
    const scoreA = a.totalCorrectChars - a.totalMistypes
    const scoreB = b.totalCorrectChars - b.totalMistypes
    if (scoreB !== scoreA) return scoreB - scoreA
    
    // Tiebreaker: Raw output
    return b.totalCorrectChars - a.totalCorrectChars
  })
})

/**
 * Reverses roulette history for display (most recent first).
 * Each entry contains: odds, survived status, and roll result.
 */
const rouletteHistoryReversed = computed(() => {
  const history = currentPlayer.value.rouletteHistory || []
  return [...history].reverse()
})

// --- ACTIONS ---

const onMainMenu = () => emit('mainMenu')
const onReplay = () => emit('replay')
</script>

<template>
  <div class="results-overlay">
    
    <!-- Error state: displayed when session data is corrupted or missing -->
    <div v-if="!isValidSession" class="terminal-results error-state">
      <div class="results-header">
        <span>FATAL ERROR</span>
        <span>DATA_CORRUPT</span>
      </div>
      <div class="error-body">
        <p>CRITICAL SYSTEM FAILURE</p>
        <p>SESSION LOST</p>
        <button @click="onMainMenu" class="results-btn primary">
          FORCE ABORT
        </button>
      </div>
    </div>

    <!-- Main results display -->
    <div v-else class="terminal-results">
      
      <div class="results-header">
        <span class="header-title">MISSION REPORT</span>
        <span class="header-id">ID: {{ room.roomCode }}</span>
      </div>

      <div class="results-grid">
        
        <!-- Left panel: Player performance summary -->
        <div class="results-summary">
          <div class="grade-container">
            <span class="grade-label">ASSESSMENT</span>
            <span class="grade-value" :class="`grade-${grade}`">{{ grade }}</span>
          </div>

          <div class="stats-block">
            <div class="stat-row">
              <span class="stat-label">STATUS</span>
              <span 
                class="stat-value" 
                :class="currentPlayer.status === 'DEAD' ? 'status-dead' : 'status-alive'"
              >
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

        <!-- Right panel: Tabbed data views -->
        <div class="results-data">
          <div class="tabs-nav">
            <button 
              class="tab-btn" 
              :class="{ active: activeTab === 'leaderboard' }"
              @click="activeTab = 'leaderboard'"
            >
              RANKING
            </button>
            <button 
              class="tab-btn" 
              :class="{ active: activeTab === 'sentences' }"
              @click="activeTab = 'sentences'"
            >
              LOGS
            </button>
            <button 
              class="tab-btn" 
              :class="{ active: activeTab === 'roulette' }"
              @click="activeTab = 'roulette'"
            >
              CASUALTY
            </button>
          </div>

          <div class="tab-viewport">
            
            <!-- Tab 1: Leaderboard with all players -->
            <div v-if="activeTab === 'leaderboard'" class="data-list">
              <div 
                v-for="(p, i) in sortedPlayers" 
                :key="p.id" 
                class="data-row"
                :class="{ 
                  'is-self': p.id === playerId, 
                  'is-dead': p.status === 'DEAD' 
                }"
              >
                <span class="row-rank">{{ (i + 1).toString().padStart(2, '0') }}</span>
                <span class="row-name">
                  {{ p.nickname }}
                  <span v-if="p.id === winnerId" class="badge-win">[WINNER]</span>
                  <span v-if="p.status === 'DEAD'" class="badge-dead">[KIA]</span>
                </span>
                <span class="row-stat">{{ p.completedSentences }}/{{ totalSentences }}</span>
                <span class="row-stat">{{ p.averageWPM }} WPM</span>
              </div>
            </div>

            <!-- Tab 2: Per-sentence performance log -->
            <div v-if="activeTab === 'sentences'" class="data-list">
              <div 
                v-for="(s, idx) in (currentPlayer.sentenceHistory || [])" 
                :key="idx" 
                class="data-row history-row"
              >
                <span class="row-index">{{ (s.sentenceIndex + 1).toString().padStart(2, '0') }}</span>
                <span class="row-content">
                  {{ s.completed ? 'COMPLETED' : `FAILED: ${s.deathReason}` }}
                </span>
                <span class="row-stat">{{ s.wpm || 0 }} WPM</span>
                <span class="row-stat">{{ s.timeUsed.toFixed(1) }}s</span>
              </div>
              <div v-if="!currentPlayer.sentenceHistory?.length" class="empty-state">
                NO_DATA_AVAILABLE
              </div>
            </div>

            <!-- Tab 3: Roulette event history (most recent first) -->
            <div v-if="activeTab === 'roulette'" class="data-list">
              <div 
                v-for="(r, i) in rouletteHistoryReversed" 
                :key="i" 
                class="data-row roulette-row"
                :class="r.survived ? 'survived' : 'fatal'"
              >
                <span class="row-odds">{{ r.odds }}</span>
                <span class="row-chamber">[{{ r.survived ? 'EMPTY' : 'BULLET' }}]</span>
                <span class="row-result">{{ r.survived ? 'SURVIVED' : 'FATAL' }}</span>
              </div>
              <div v-if="!currentPlayer.rouletteHistory?.length" class="empty-state">
                NO_CASUALTY_EVENTS
              </div>
            </div>

          </div>
        </div>
      </div>

      <!-- Action buttons: Return to lobby or exit to main menu -->
      <div class="results-actions">
        <button class="results-btn" @click="onReplay">
          RETURN TO LOBBY
        </button>
        <button class="results-btn" @click="onMainMenu">
          EXIT TO MENU
        </button>
      </div>

    </div>
  </div>
</template>

<style scoped>
@import './GameEndScreen.css';
</style>