<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import GameController from './game/GameController.js'
import StatusHUD from './game/StatusHUD.vue'
import TypingField from './game/TypingField.vue'
import LeaderboardPanel from './game/LeaderboardPanel.vue'
import RouletteRevolver from './RouletteRevolver.vue'

const props = defineProps({
  socket: { type: Object, required: true },
  room: { type: Object, required: true },
  playerId: { type: String, required: true },
  sentences: { type: Array, required: true },
  isSpectator: { type: Boolean, default: false }
})

const emit = defineEmits(['leave'])

const players = ref({})
const currentSentenceIndex = ref(0)
const currentWordIndex = ref(0)
const currentCharInWord = ref(0)
const remainingTime = ref(20)
const mistypeFlash = ref(false)
const flashKey = ref(0)
const isProcessingError = ref(false)
const spectatingPlayerId = ref(null)
const showRoulette = ref(false)
const isRouletteActive = ref(false)
const rouletteResult = ref(null)
const showVictory = ref(false)
const showAbortConfirm = ref(false)


const isHost = computed(() => props.room.hostId === props.playerId)

let timerInterval = null
let spectatorInterval = null

const initializePlayers = () => {
  const initialPlayers = {}
  Object.keys(props.room.players).forEach(pId => {
    initialPlayers[pId] = {
      ...props.room.players[pId],
      currentSentenceIndex: 0,
      currentWordIndex: 0,
      currentCharInWord: 0,
      currentCharIndex: 0,
      completedSentences: 0,
      totalCorrectChars: 0,
      totalTypedChars: 0,
      totalMistypes: 0,
      averageWPM: 0,
      mistakeStrikes: 0,
      status: 'ALIVE',
      sentenceStartTime: Date.now(),
      calculatedTime: 20
    }
  })
  players.value = initialPlayers
  
  if (props.isSpectator) {
    const alivePlayers = Object.values(initialPlayers).filter(p => p.status === 'ALIVE')
    if (alivePlayers.length > 0) {
      spectatingPlayerId.value = alivePlayers[0].id
    }
  }
}

initializePlayers()

const currentPlayer = computed(() => players.value[props.playerId] || {})
const status = computed(() => currentPlayer.value.status || 'ALIVE')

const spectatorTarget = computed(() => {
  if (!props.isSpectator || !spectatingPlayerId.value) return null
  return players.value[spectatingPlayerId.value] || null
})

const spectatorDisplayTime = computed(() => {
  if (!spectatorTarget.value) return 20
  return spectatorTarget.value.calculatedTime ?? 20
})

const currentSentence = computed(() => props.sentences[currentSentenceIndex.value] || '')
const words = computed(() => currentSentence.value.split(' '))
const currentWord = computed(() => words.value[currentWordIndex.value] || '')

const handleResetGame = () => {
  showAbortConfirm.value = true
}

const confirmAbort = () => {
  props.socket.emit('reset_game', { roomCode: props.room.roomCode })
  showAbortConfirm.value = false
}

const cancelAbort = () => {
  showAbortConfirm.value = false
}

const startMainTimer = () => {
  if (timerInterval) clearInterval(timerInterval)
  timerInterval = setInterval(() => {
    const prev = remainingTime.value
    const newTime = Math.max(0, prev - 0.1)
    remainingTime.value = newTime
    
    if (newTime <= 0 && prev > 0) {
      props.socket.emit('sentence_timeout', {
        roomCode: props.room.roomCode,
        sentenceIndex: currentSentenceIndex.value
      })
    }
  }, 100)
}

const startSpectatorTimer = () => {
  if (spectatorInterval) clearInterval(spectatorInterval)
  spectatorInterval = setInterval(() => {
    if (!spectatorTarget.value || !spectatorTarget.value.sentenceStartTime) return
    
    const elapsed = (Date.now() - spectatorTarget.value.sentenceStartTime) / 1000
    const calculated = Math.max(0, 20 - elapsed)
    
    if (players.value[spectatingPlayerId.value]) {
      players.value[spectatingPlayerId.value].calculatedTime = calculated
    }
  }, 100)
}

watch([status, currentSentenceIndex, () => props.isSpectator], () => {
  if (props.isSpectator) {
    if (timerInterval) clearInterval(timerInterval)
    return
  }
  
  if (status.value === 'ALIVE') {
    startMainTimer()
  } else {
    if (timerInterval) clearInterval(timerInterval)
  }
}, { immediate: true })

watch([() => props.isSpectator, spectatingPlayerId], () => {
  if (props.isSpectator && spectatingPlayerId.value) {
    startSpectatorTimer()
  } else {
    if (spectatorInterval) clearInterval(spectatorInterval)
  }
})

const handleKeyPress = (e) => {
  if (status.value !== 'ALIVE' || isProcessingError.value || props.isSpectator || isRouletteActive.value) return

  const key = e.key
  if (GameController.isNavigationKey(key) && key !== ' ') return
  e.preventDefault()

  const _words = words.value
  const _currentWord = currentWord.value
  const charIndex = GameController.calculateGlobalCharIndex(_words, currentWordIndex.value, currentCharInWord.value)

  if (key === ' ') {
    if (GameController.shouldAdvanceWord(currentCharInWord.value, _currentWord)) {
      if (currentWordIndex.value < _words.length - 1) {
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
      triggerMistype(key, _currentWord[currentCharInWord.value], charIndex)
    }
    return
  }

  const expectedChar = _currentWord[currentCharInWord.value]
  if (GameController.validateChar(key, expectedChar)) {
    const newCharInWord = currentCharInWord.value + 1
    currentCharInWord.value = newCharInWord

    props.socket.emit('char_typed', {
      roomCode: props.room.roomCode,
      char: key,
      charIndex: charIndex,
      timestamp: Date.now()
    })

    if (GameController.shouldCompleteSentence(currentWordIndex.value, _words, newCharInWord, _currentWord)) {
      setTimeout(() => {
        const nextIndex = currentSentenceIndex.value + 1
        if (nextIndex < props.sentences.length) {
          currentSentenceIndex.value = nextIndex
          currentWordIndex.value = 0
          currentCharInWord.value = 0
        }
      }, 100)
    }
  } else {
    triggerMistype(key, expectedChar, charIndex)
  }
}

const triggerMistype = (typed, expected, charIndex) => {
  isProcessingError.value = true
  props.socket.emit('mistype', {
    roomCode: props.room.roomCode,
    expectedChar: expected,
    typedChar: typed,
    charIndex: charIndex,
    sentenceIndex: currentSentenceIndex.value
  })
  currentWordIndex.value = 0
  currentCharInWord.value = 0
}

const onPlayerProgress = (data) => {
  if (players.value[data.playerId]) {
    players.value[data.playerId] = {
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
}

const onPlayerStrike = (data) => {
  if (players.value[data.playerId]) {
    players.value[data.playerId] = {
      ...players.value[data.playerId],
      mistakeStrikes: data.strikes,
      sentenceStartTime: data.sentenceStartTime,
      currentWordIndex: data.currentWordIndex,
      currentCharInWord: data.currentCharInWord,
      currentCharIndex: data.currentCharIndex
    }
    
    // Logic specific to the current user (Visuals & Timer Reset)
    if (data.playerId === props.playerId) {
      remainingTime.value = 20
      mistypeFlash.value = true
      flashKey.value += 1
      
      setTimeout(() => {
        mistypeFlash.value = false
        isProcessingError.value = false
      }, 300)
    }
  }
}

const onRouletteResult = (data) => {
  if (data.playerId === props.playerId) {
    rouletteResult.value = data
    showRoulette.value = true
    isRouletteActive.value = true
    
    remainingTime.value = 20
    if (players.value[props.playerId]) {
      players.value[props.playerId].mistakeStrikes = 0
    }
    
    if (timerInterval) clearInterval(timerInterval)
    
    setTimeout(() => {
      showRoulette.value = false
      rouletteResult.value = null
      isRouletteActive.value = false
      
      if (players.value[props.playerId]?.status === 'ALIVE') {
        startMainTimer()
      }
    }, 5000)
  }
}

const onPlayerDied = (data) => {
  if (players.value[data.playerId]) {
    players.value[data.playerId] = {
      ...players.value[data.playerId],
      status: 'DEAD'
    }
  }
}

const onSentenceCompleted = (data) => {
  if (players.value[data.playerId]) {
    const p = players.value[data.playerId]
    p.completedSentences = (p.completedSentences || 0) + 1
    p.currentSentenceIndex = data.newSentenceIndex
    p.sentenceStartTime = data.sentenceStartTime
    p.currentWordIndex = 0
    p.currentCharInWord = 0
    p.currentCharIndex = 0
    
    players.value[data.playerId] = { ...p }
    
    if (data.playerId === props.playerId) {
      remainingTime.value = 20
    }
  }
}

const onGameEnded = (data) => {
  console.log('🏁 Game ended event received:', data)
  Object.keys(data.finalStats).forEach(pId => {
     if (players.value[pId]) {
       players.value[pId] = { ...players.value[pId], ...data.finalStats[pId] }
     }
  })

  if (data.winnerId === props.playerId && data.reason === 'COMPLETION') {
    showVictory.value = true
  }
}

// --- 2. MOUNT & UNMOUNT ---

onMounted(() => {
  document.addEventListener('keydown', handleKeyPress)

  // Attach the named functions
  props.socket.on('player_progress', onPlayerProgress)
  props.socket.on('player_strike', onPlayerStrike)
  props.socket.on('roulette_result', onRouletteResult)
  props.socket.on('player_died', onPlayerDied)
  props.socket.on('sentence_completed', onSentenceCompleted)
  props.socket.on('game_ended', onGameEnded)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeyPress)
  if (timerInterval) clearInterval(timerInterval)
  if (spectatorInterval) clearInterval(spectatorInterval)
  
  // Detach ONLY these specific functions
  // This prevents wiping the global game_ended listener in App.vue
  props.socket.off('player_progress', onPlayerProgress)
  props.socket.off('player_strike', onPlayerStrike)
  props.socket.off('roulette_result', onRouletteResult)
  props.socket.off('player_died', onPlayerDied)
  props.socket.off('sentence_completed', onSentenceCompleted)
  props.socket.off('game_ended', onGameEnded)
})

const onLeaveClick = () => {
  emit('leave')
}
</script>

<template>
  <div :key="flashKey" class="terminal" :class="{ 'flash': mistypeFlash }">
    
    <div v-if="showAbortConfirm" class="confirm-overlay">
      <div class="confirm-dialog">
        <div class="confirm-title">ABORT MISSION?</div>
        <div class="confirm-message">
          This will stop the game for everyone and return to lobby.
          
          Continue?
        </div>
        <div class="confirm-actions">
          <button @click="confirmAbort" class="confirm-btn confirm-btn-ok">OK</button>
          <button @click="cancelAbort" class="confirm-btn confirm-btn-cancel">CANCEL</button>
        </div>
      </div>
    </div>

    <RouletteRevolver
      v-if="showRoulette && rouletteResult"
      :survived="rouletteResult.survived"
      :previousOdds="rouletteResult.previousOdds"
      :newOdds="rouletteResult.newOdds"
      :roll="rouletteResult.roll"
    />

    <div class="terminal-header">
      <div v-if="isSpectator && spectatorTarget" class="spectator-header-badge">
        SPECTATING: {{ spectatorTarget.nickname }}
      </div>
      <div v-else></div>

      <div class="header-right">
        <button v-if="isHost" @click="handleResetGame" class="term-btn-reset">ABORT</button>
        <button @click="onLeaveClick" class="term-btn">EXIT</button>
      </div>
    </div>

    <div class="terminal-body">
      <div class="typing-zone">
        
        <div v-if="status === 'DEAD' && !showRoulette" class="death-screen">
          <div class="death-text">
            <p>YOU ARE DEAD</p>
            <p>FINAL: {{ currentPlayer.completedSentences }}/{{ sentences.length }}</p>
            <p class="death-sub">[SPECTATING]</p>
          </div>
        </div>

        <div v-if="showVictory" class="victory-screen">
          <div class="victory-text">
            <p>MISSION COMPLETE</p>
            <p>SURVIVED: {{ currentPlayer.completedSentences }}/{{ sentences.length }}</p>
            <p class="victory-sub">[ANALYZING RESULTS]<span class="loading-dots"></span></p>
          </div>
        </div>

        <StatusHUD
          :remainingTime="isSpectator && spectatorTarget ? spectatorDisplayTime : remainingTime"
          :mistakeStrikes="isSpectator && spectatorTarget ? (spectatorTarget.mistakeStrikes || 0) : (currentPlayer.mistakeStrikes || 0)"
          :currentSentenceIndex="isSpectator && spectatorTarget ? (spectatorTarget.currentSentenceIndex || 0) : currentSentenceIndex"
          :totalSentences="sentences.length"
          :mistypeFlash="mistypeFlash"
        />

        <TypingField
          :key="`typing-${isSpectator && spectatorTarget ? spectatingPlayerId : playerId}-${isSpectator && spectatorTarget ? (spectatorTarget.currentSentenceIndex || 0) : currentSentenceIndex}`"
          :sentences="sentences"
          :currentSentenceIndex="isSpectator && spectatorTarget ? (spectatorTarget.currentSentenceIndex || 0) : currentSentenceIndex"
          :currentWordIndex="isSpectator && spectatorTarget ? (spectatorTarget.currentWordIndex || 0) : currentWordIndex"
          :currentCharInWord="isSpectator && spectatorTarget ? (spectatorTarget.currentCharInWord || 0) : currentCharInWord"
        />
      </div>

      <LeaderboardPanel
        :players="players"
        :playerId="playerId"
        :totalSentences="sentences.length"
        :onPlayerClick="isSpectator ? (id) => spectatingPlayerId = id : undefined"
        :highlightedPlayerId="isSpectator ? spectatingPlayerId : playerId"
      />
    </div>
  </div>
</template>

<style src="./GameScreen.css"></style>