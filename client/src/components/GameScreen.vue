<template>
  <GameEndScreen
    v-if="gameEnded"
    :game-end-data="gameEndData"
    :room="room"
    :player-id="playerId"
    :sentences="sentences"
    @main-menu="$emit('mainMenu')"
    @replay="$emit('replay')"
  />

  <div v-else :key="flashKey" :class="['terminal', { 'flash': mistypeFlash }]">
    <!-- Abort Confirmation Dialog -->
    <div v-if="showAbortConfirm" class="confirm-overlay">
      <div class="confirm-dialog">
        <div class="confirm-title">ABORT MISSION?</div>
        <div class="confirm-message">
          This will stop the game for everyone and return to lobby.
          
          Continue?
        </div>
        <div class="confirm-actions">
          <button @click="confirmAbort" class="confirm-btn confirm-btn-ok">
            OK
          </button>
          <button @click="cancelAbort" class="confirm-btn confirm-btn-cancel">
            CANCEL
          </button>
        </div>
      </div>
    </div>

    <!-- Roulette Overlay -->
    <RouletteRevolver
      v-if="showRoulette && rouletteResult"
      :survived="rouletteResult.survived"
      :previous-odds="rouletteResult.previousOdds"
      :new-odds="rouletteResult.newOdds"
      :roll="rouletteResult.roll"
    />

    <!-- Header -->
    <div class="terminal-header">
      <div v-if="isSpectator && spectatorTarget" class="spectator-header-badge">
        SPECTATING: {{ spectatorTarget.nickname }}
      </div>
      <div v-else></div>
      <div class="header-right">
        <button v-if="isHost" @click="handleResetGame" class="term-btn-reset">
          ABORT
        </button>
        <button @click="$emit('leave')" class="term-btn">EXIT</button>
      </div>
    </div>

    <!-- Main Game Area -->
    <div class="terminal-body">
      <div class="typing-zone">
        <!-- Death Screen Overlay -->
        <div v-if="status === 'DEAD' && !showRoulette && !gameEnded" class="death-screen">
          <div class="death-text">
            <p>YOU ARE DEAD</p>
            <p>FINAL: {{ currentPlayer.completedSentences }}/{{ sentences.length }}</p>
            <p class="death-sub">[SPECTATING]</p>
          </div>
        </div>

        <!-- Victory Screen Overlay -->
        <div v-if="showVictory && !gameEnded" class="victory-screen">
          <div class="victory-text">
            <p>MISSION COMPLETE</p>
            <p>SURVIVED: {{ currentPlayer.completedSentences }}/{{ sentences.length }}</p>
            <p class="victory-sub">[ANALYZING RESULTS]<span class="loading-dots" /></p>
          </div>
        </div>

        <!-- Game Over Screen Overlay (for alive non-winners) -->
        <div v-if="showGameOver && !gameEnded" class="victory-screen">
          <div class="victory-text">
            <p>GAME OVER</p>
            <p>COMPLETED: {{ currentPlayer.completedSentences }}/{{ sentences.length }}</p>
            <p class="victory-sub">[ANALYZING RESULTS]<span class="loading-dots" /></p>
          </div>
        </div>

        <!-- Status HUD -->
        <StatusHUD
          :remaining-time="isSpectator && spectatorTarget ? spectatorDisplayTime : remainingTime"
          :mistake-strikes="isSpectator && spectatorTarget ? (spectatorTarget.mistakeStrikes || 0) : (currentPlayer.mistakeStrikes || 0)"
          :current-sentence-index="isSpectator && spectatorTarget ? (spectatorTarget.currentSentenceIndex || 0) : currentSentenceIndex"
          :total-sentences="sentences.length"
          :mistype-flash="mistypeFlash"
        />

        <!-- Typing Field -->
        <TypingField
          :key="`typing-${isSpectator && spectatorTarget ? spectatingPlayerId : playerId}-${isSpectator && spectatorTarget ? (spectatorTarget.currentSentenceIndex || 0) : currentSentenceIndex}`"
          :sentences="sentences"
          :current-sentence-index="isSpectator && spectatorTarget ? (spectatorTarget.currentSentenceIndex || 0) : currentSentenceIndex"
          :current-word-index="isSpectator && spectatorTarget ? (spectatorTarget.currentWordIndex || 0) : currentWordIndex"
          :current-char-in-word="isSpectator && spectatorTarget ? (spectatorTarget.currentCharInWord || 0) : currentCharInWord"
        />
      </div>

      <!-- Leaderboard -->
      <LeaderboardPanel
        :players="players"
        :player-id="playerId"
        :total-sentences="sentences.length"
        :on-player-click="isSpectator ? setSpectatingPlayerId : undefined"
        :highlighted-player-id="isSpectator ? spectatingPlayerId : playerId"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import RouletteRevolver from './RouletteRevolver.vue'
import StatusHUD from './game/StatusHUD.vue'
import TypingField from './game/TypingField.vue'
import LeaderboardPanel from './game/LeaderboardPanel.vue'
import GameEndScreen from './GameEndScreen.vue'
import GameController from './game/GameController.js'

const props = defineProps({
  socket: {
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
  },
  isSpectator: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['leave', 'mainMenu', 'replay'])

// State
const currentSentenceIndex = ref(0)
const currentWordIndex = ref(0)
const currentCharInWord = ref(0)
const remainingTime = ref(20)
const status = ref('ALIVE')
const players = ref(props.room.players)
const mistypeFlash = ref(false)
const flashKey = ref(0)
const showRoulette = ref(false)
const rouletteResult = ref(null)
const isProcessingError = ref(false)
const showVictory = ref(false)
const showGameOver = ref(false)
const showAbortConfirm = ref(false)
const spectatingPlayerId = ref(null)
const rouletteActiveRef = ref(false)
const gameEnded = ref(false)
const gameEndData = ref(null)

// Computed
const currentSentence = computed(() => 
  props.sentences[currentSentenceIndex.value] || ''
)

const words = computed(() => 
  currentSentence.value.split(' ')
)

const currentWord = computed(() => 
  words.value[currentWordIndex.value] || ''
)

const currentPlayer = computed(() => 
  players.value[props.playerId] || {}
)

const spectatorTarget = computed(() => 
  props.isSpectator && spectatingPlayerId.value ? players.value[spectatingPlayerId.value] : null
)

const isHost = computed(() => 
  props.room.hostId === props.playerId
)

const spectatorDisplayTime = computed(() => 
  spectatorTarget.value?.calculatedTime ?? 20
)

// Functions
function handleResetGame() {
  if (!isHost.value) return
  showAbortConfirm.value = true
}

function confirmAbort() {
  props.socket.emit('force_reset_game', { roomCode: props.room.roomCode }, (response) => {
    if (!response.success) {
      console.error('Failed to reset game:', response.error)
    }
  })
  showAbortConfirm.value = false
}

function cancelAbort() {
  showAbortConfirm.value = false
}

function setSpectatingPlayerId(playerId) {
  spectatingPlayerId.value = playerId
}

// Keyboard Handler
function handleKeyPress(e) {
  if (status.value !== 'ALIVE' || isProcessingError.value || props.isSpectator || gameEnded.value || rouletteActiveRef.value) return
  
  e.preventDefault()
  const key = e.key

  if (GameController.isNavigationKey(key) && key !== ' ') return

  const currentWords = currentSentence.value.split(' ')
  const word = currentWords[currentWordIndex.value] || ''
  const charIndex = GameController.calculateGlobalCharIndex(currentWords, currentWordIndex.value, currentCharInWord.value)

  if (key === ' ') {
    if (GameController.shouldAdvanceWord(currentCharInWord.value, word)) {
      if (currentWordIndex.value < currentWords.length - 1) {
        currentWordIndex.value++
        currentCharInWord.value = 0
        
        props.socket.emit('char_typed', {
          roomCode: props.room.roomCode,
          char: ' ',
          charIndex: charIndex,
          timestamp: Date.now()
        })
      }
    } else {
      isProcessingError.value = true
      props.socket.emit('mistype', {
        roomCode: props.room.roomCode,
        expectedChar: word[currentCharInWord.value],
        typedChar: key,
        charIndex: charIndex,
        sentenceIndex: currentSentenceIndex.value
      })
      currentWordIndex.value = 0
      currentCharInWord.value = 0
    }
    return
  }

  const expectedChar = word[currentCharInWord.value]

  if (GameController.validateChar(key, expectedChar)) {
    const newCharInWord = currentCharInWord.value + 1
    currentCharInWord.value = newCharInWord

    props.socket.emit('char_typed', {
      roomCode: props.room.roomCode,
      char: key,
      charIndex: charIndex,
      timestamp: Date.now()
    })

    if (GameController.shouldCompleteSentence(currentWordIndex.value, currentWords, newCharInWord, word)) {
      const nextIndex = currentSentenceIndex.value + 1
      if (nextIndex < props.sentences.length) {
        props.socket.emit('sentence_completed', {
          roomCode: props.room.roomCode,
          sentenceIndex: currentSentenceIndex.value,
          newSentenceIndex: nextIndex
        })
        
        setTimeout(() => {
          currentSentenceIndex.value = nextIndex
          currentWordIndex.value = 0
          currentCharInWord.value = 0
          remainingTime.value = 20
        }, 100)
      }
    }
  } else {
    isProcessingError.value = true
    props.socket.emit('mistype', {
      roomCode: props.room.roomCode,
      expectedChar: expectedChar,
      typedChar: key,
      charIndex: charIndex,
      sentenceIndex: currentSentenceIndex.value
    })
    currentWordIndex.value = 0
    currentCharInWord.value = 0
  }
}

// Timer Logic
let timerInterval = null

watch([status, currentSentenceIndex, isProcessingError, rouletteActiveRef], () => {
  if (timerInterval) {
    clearInterval(timerInterval)
    timerInterval = null
  }

  if (props.isSpectator) return
  if (status.value !== 'ALIVE') return
  if (isProcessingError.value) return
  if (rouletteActiveRef.value) return

  remainingTime.value = 20

  timerInterval = setInterval(() => {
    remainingTime.value = Math.max(0, remainingTime.value - 0.1)
    if (remainingTime.value <= 0) {
      props.socket.emit('sentence_timeout', {
        roomCode: props.room.roomCode,
        sentenceIndex: currentSentenceIndex.value
      })
      clearInterval(timerInterval)
      timerInterval = null
    }
  }, 100)
}, { immediate: true })

// Spectator Timer Calculation
let spectatorTimerInterval = null

watch(() => spectatorTarget.value?.sentenceStartTime, (newVal, oldVal) => {
  if (spectatorTimerInterval) {
    clearInterval(spectatorTimerInterval)
    spectatorTimerInterval = null
  }

  if (!props.isSpectator || !spectatorTarget.value || spectatorTarget.value.status !== 'ALIVE') return
  if (!newVal) return

  spectatorTimerInterval = setInterval(() => {
    if (!spectatorTarget.value || !spectatorTarget.value.sentenceStartTime) {
      clearInterval(spectatorTimerInterval)
      spectatorTimerInterval = null
      return
    }

    const elapsed = (Date.now() - spectatorTarget.value.sentenceStartTime) / 1000
    const calculated = Math.max(0, 20 - elapsed)
    
    players.value = {
      ...players.value,
      [spectatingPlayerId.value]: {
        ...players.value[spectatingPlayerId.value],
        calculatedTime: calculated
      }
    }
  }, 100)
})

// Auto-select spectator target
watch(() => [props.isSpectator, spectatingPlayerId.value, players.value], () => {
  if (props.isSpectator && !spectatingPlayerId.value && players.value) {
    const alivePlayers = Object.values(players.value).filter(p => p.status === 'ALIVE')
    if (alivePlayers.length > 0) {
      spectatingPlayerId.value = alivePlayers[0].id
      console.log(`Auto-spectating: ${alivePlayers[0].nickname}`)
    }
  }
}, { immediate: true, deep: true })

// Switch spectator target when current target dies
watch(() => spectatorTarget.value?.status, (newStatus) => {
  if (props.isSpectator && newStatus === 'DEAD') {
    const alivePlayers = Object.values(players.value).filter(p => p.status === 'ALIVE' && p.id !== spectatingPlayerId.value)
    if (alivePlayers.length > 0) {
      spectatingPlayerId.value = alivePlayers[0].id
      console.log(`Target died, switching to: ${alivePlayers[0].nickname}`)
    }
  }
})

// Reset game state when room changes or new game starts
watch(() => props.room.gameState, (newState, oldState) => {
  console.log(`Game state changed: ${oldState} → ${newState}`)
  
  // Reset when leaving ENDED state or entering PLAYING state
  if (oldState === 'ENDED' && newState !== 'ENDED') {
    resetGameState()
  }
  
  if (newState === 'PLAYING') {
    resetGameState()
  }
})

watch(() => props.room.players, (newPlayers) => {
  players.value = newPlayers
}, { deep: true })

// Add this function to reset all game state
function resetGameState() {
  currentSentenceIndex.value = 0
  currentWordIndex.value = 0
  currentCharInWord.value = 0
  remainingTime.value = 20
  status.value = 'ALIVE'
  mistypeFlash.value = false
  flashKey.value = 0
  showRoulette.value = false
  rouletteResult.value = null
  isProcessingError.value = false
  showVictory.value = false
  showGameOver.value = false
  showAbortConfirm.value = false
  spectatingPlayerId.value = null
  rouletteActiveRef.value = false
  gameEnded.value = false
  gameEndData.value = null
  
  if (timerInterval) {
    clearInterval(timerInterval)
    timerInterval = null
  }
  if (spectatorTimerInterval) {
    clearInterval(spectatorTimerInterval)
    spectatorTimerInterval = null
  }
}

// Socket Event Handlers
function setupSocketListeners() {
  props.socket.on('player_progress', (data) => {
    players.value = {
      ...players.value,
      [data.playerId]: {
        ...players.value[data.playerId],
        currentCharIndex: data.charIndex,
        currentSentenceIndex: data.sentenceIndex,
        currentWordIndex: data.currentWordIndex || 0,
        currentCharInWord: data.currentCharInWord || 0,
        completedSentences: data.completedSentences,
        totalCorrectChars: data.totalCorrectChars,
        totalTypedChars: data.totalTypedChars,
        totalMistypes: data.totalMistypes,
        averageWPM: data.wpm,
        status: data.status,
        sentenceStartTime: data.sentenceStartTime
      }
    }
  })

  props.socket.on('player_strike', (data) => {
    players.value = {
      ...players.value,
      [data.playerId]: {
        ...players.value[data.playerId],
        mistakeStrikes: data.strikes,
        sentenceStartTime: data.sentenceStartTime,
        currentWordIndex: data.currentWordIndex,
        currentCharInWord: data.currentCharInWord,
        currentCharIndex: data.currentCharIndex
      }
    }

    if (data.playerId === props.playerId) {
      mistypeFlash.value = true
      flashKey.value++
      remainingTime.value = 20
      setTimeout(() => {
        mistypeFlash.value = false
      }, 300)

      if (data.strikes < 3) {
        setTimeout(() => {
          isProcessingError.value = false
        }, 300)
      }
    }
  })

  props.socket.on('roulette_result', (data) => {
    const isCurrentPlayer = data.playerId === props.playerId
    const isSpectatingThisPlayer = props.isSpectator && data.playerId === spectatingPlayerId.value
    
    if (isCurrentPlayer) {
      rouletteActiveRef.value = true
      showRoulette.value = true
      rouletteResult.value = data

      if (!data.survived) {
        status.value = 'DEAD'
      }
    }
    
    if (isSpectatingThisPlayer) {
      console.log(`🎰 Spectator seeing roulette for ${players.value[data.playerId]?.nickname}`)
      showRoulette.value = true
      rouletteResult.value = data
    }
    
    players.value = {
      ...players.value,
      [data.playerId]: {
        ...players.value[data.playerId],
        rouletteOdds: data.newOdds,
        mistakeStrikes: data.survived ? 0 : players.value[data.playerId].mistakeStrikes,
        sentenceStartTime: data.survived ? data.sentenceStartTime : players.value[data.playerId].sentenceStartTime
      }
    }
    
    setTimeout(() => {
      showRoulette.value = false
      rouletteResult.value = null
      
      if (isCurrentPlayer) {
        rouletteActiveRef.value = false
        
        if (data.survived) {
          currentWordIndex.value = 0
          currentCharInWord.value = 0
          remainingTime.value = 20
          isProcessingError.value = false
        }
      }
    }, 4500)
  })

  props.socket.on('player_died', (data) => {
    players.value = {
      ...players.value,
      [data.playerId]: {
        ...players.value[data.playerId],
        status: 'DEAD'
      }
    }

    if (data.playerId === props.playerId) {
      status.value = 'DEAD'
    }
  })

  props.socket.on('sentence_completed', (data) => {
    players.value = {
      ...players.value,
      [data.playerId]: {
        ...players.value[data.playerId],
        completedSentences: (players.value[data.playerId].completedSentences || 0) + 1,
        currentSentenceIndex: data.newSentenceIndex,
        sentenceStartTime: data.sentenceStartTime,
        currentWordIndex: 0,
        currentCharInWord: 0,
        currentCharIndex: 0
      }
    }
  })

  props.socket.on('game_ended', (data) => {
    console.log('🏁 Game ended event received:', data)
    const updatedPlayers = {}
    Object.keys(data.finalStats).forEach(pId => {
      updatedPlayers[pId] = {
        ...players.value[pId],
        ...data.finalStats[pId]
      }
    })
    players.value = updatedPlayers
    
    gameEndData.value = data
    
    if (data.winnerId === props.playerId && data.reason === 'COMPLETION') {
      showVictory.value = true
      setTimeout(() => {
        showVictory.value = false
        gameEnded.value = true
      }, 6000)
    } else if (status.value === 'ALIVE') {
      showGameOver.value = true
      setTimeout(() => {
        showGameOver.value = false
        gameEnded.value = true
      }, 6000)
    } else {
      setTimeout(() => {
        gameEnded.value = true
      }, 6000)
    }
  })
}

function cleanupSocketListeners() {
  props.socket.off('player_progress')
  props.socket.off('player_strike')
  props.socket.off('roulette_result')
  props.socket.off('player_died')
  props.socket.off('sentence_completed')
  props.socket.off('game_ended')
}

// Lifecycle
onMounted(() => {
  setupSocketListeners()
  document.addEventListener('keydown', handleKeyPress)
})

onUnmounted(() => {
  resetGameState()
  cleanupSocketListeners()
  document.removeEventListener('keydown', handleKeyPress)
})
</script>

<style>
@import './GameScreen.css';
</style>