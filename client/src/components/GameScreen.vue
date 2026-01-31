<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
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
let gameLoopInterval = null

const mistypeFlash = ref(false)
const flashKey = ref(0)
const isProcessingError = ref(false)
const spectatingPlayerId = ref(null)
const showRoulette = ref(false)
const isRouletteActive = ref(false)
const rouletteResult = ref(null)
const showVictory = ref(false)
const showAbortConfirm = ref(false)
const winnerAnnouncement = ref(null)

const isHost = computed(() => props.room.hostId === props.playerId)

// --- INITIALIZATION ---
const initializePlayers = () => {
  const initialPlayers = {}
  Object.keys(props.room.players).forEach(pId => {
    const rawP = props.room.players[pId]
    
    initialPlayers[pId] = {
      ...rawP,
      currentSentenceIndex: rawP.currentSentenceIndex || 0,
      currentWordIndex: rawP.currentWordIndex || 0,
      currentCharInWord: rawP.currentCharInWord || 0,
      currentCharIndex: rawP.currentCharIndex || 0,
      completedSentences: rawP.completedSentences || 0,
      totalCorrectChars: rawP.totalCorrectChars || 0,
      totalTypedChars: rawP.totalTypedChars || 0,
      totalMistypes: rawP.totalMistypes || 0,
      averageWPM: rawP.averageWPM || 0,
      mistakeStrikes: rawP.mistakeStrikes || 0,
      status: rawP.status || 'ALIVE',
      sentenceStartTime: rawP.sentenceStartTime || Date.now(),
      calculatedTime: 20,
      activeRoulette: null
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

// --- COMPUTED HELPERS ---
const currentPlayer = computed(() => players.value[props.playerId] || {})
const status = computed(() => currentPlayer.value.status || 'ALIVE')

const spectatorTarget = computed(() => {
  if (spectatingPlayerId.value) {
    return players.value[spectatingPlayerId.value] || null
  }
  return null
})

const displayTarget = computed(() => {
  if (spectatingPlayerId.value) {
    return players.value[spectatingPlayerId.value] || null
  }
  if (props.isSpectator) {
    return spectatingPlayerId.value ? players.value[spectatingPlayerId.value] : null
  }
  return players.value[props.playerId]
})

const currentSentence = computed(() => {
  const raw = props.sentences[currentSentenceIndex.value] || []
  return Array.isArray(raw) ? raw.join(' ') : raw
})

const words = computed(() => {
  const raw = props.sentences[currentSentenceIndex.value] || []
  return Array.isArray(raw) ? raw : []
})

const currentWord = computed(() => {
  return words.value[currentWordIndex.value] || ''
})

// --- GAME ACTIONS ---
const handleResetGame = () => {
  showAbortConfirm.value = true
}

const confirmAbort = () => {
  props.socket.emit('force_reset_game', { roomCode: props.room.roomCode }, (response) => {
    if (!response?.success) {
      console.error('Failed to abort game:', response?.error);
    }
  });
  showAbortConfirm.value = false;
}

const cancelAbort = () => {
  showAbortConfirm.value = false
}

// --- UNIFIED GAME LOOP ---
const startGameLoop = () => {
  if (gameLoopInterval) clearInterval(gameLoopInterval)
  
  gameLoopInterval = setInterval(() => {
    const target = displayTarget.value

    if (!target || target.status === 'DEAD') {
      remainingTime.value = 0
      return
    }

    // Freeze visually during animation
    if (showRoulette.value) {
      return
    }

    const startTime = new Date(target.sentenceStartTime).getTime()
    if (!startTime || isNaN(startTime)) {
      remainingTime.value = 20
      return
    }

    const elapsed = (Date.now() - startTime) / 1000
    // Handle future timestamps from post-roulette buffer
    const calculatedTime = elapsed < 0 ? 20 : Math.min(20, Math.max(0, 20 - elapsed))

    remainingTime.value = calculatedTime

    if (!props.isSpectator && target.id === props.playerId) {
      if (calculatedTime <= 0) {
        props.socket.emit('sentence_timeout', {
          roomCode: props.room.roomCode,
          sentenceIndex: currentSentenceIndex.value
        })
      }
    }
  }, 100)
}

// --- WATCHERS ---
watch(
  [() => props.isSpectator, spectatingPlayerId], 
  () => {
    // When we switch targets, immediately check if the new target 
    // has an active roulette animation running
    syncRouletteUI()
  }
)

// --- INPUT HANDLING ---
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

// --- SOCKET HANDLERS ---
const onPlayerProgress = (data) => {
  if (players.value[data.playerId]) {
    const currentP = players.value[data.playerId]

    players.value[data.playerId] = {
      ...currentP,
      currentCharIndex: data.currentCharIndex ?? currentP.currentCharIndex,
      currentSentenceIndex: data.currentSentenceIndex ?? currentP.currentSentenceIndex,
      currentWordIndex: data.currentWordIndex ?? currentP.currentWordIndex,
      currentCharInWord: data.currentCharInWord ?? currentP.currentCharInWord,
      completedSentences: data.completedSentences ?? currentP.completedSentences,
      totalCorrectChars: data.totalCorrectChars ?? currentP.totalCorrectChars,
      totalTypedChars: data.totalTypedChars ?? currentP.totalTypedChars,
      totalMistypes: data.totalMistypes ?? currentP.totalMistypes,
      averageWPM: data.averageWPM ?? currentP.averageWPM,
      status: data.status ?? currentP.status,
      sentenceStartTime: data.sentenceStartTime ?? currentP.sentenceStartTime
    }
  }

  // 2. Force-Sync Local State (Anti-Softlock)
  if (data.playerId === props.playerId && !props.isSpectator) {
    
    // Safety check: Don't sync if server sent garbage
    if (typeof data.currentSentenceIndex === 'undefined') return;

    const isDesynced = 
      currentSentenceIndex.value !== data.currentSentenceIndex ||
      currentWordIndex.value !== (data.currentWordIndex || 0) ||
      currentCharInWord.value !== (data.currentCharInWord || 0);

    if (isDesynced) {
      currentSentenceIndex.value = data.currentSentenceIndex;
      currentWordIndex.value = data.currentWordIndex || 0;
      currentCharInWord.value = data.currentCharInWord || 0;
      isProcessingError.value = false; 
    }
  }
}

const onPlayerStrike = (data) => {
  if (players.value[data.playerId]) {
    players.value[data.playerId] = {
      ...players.value[data.playerId],
      mistakeStrikes: data.strikes,
      sentenceStartTime: data.sentenceStartTime,
      currentWordIndex: 0,
      currentCharInWord: 0,
      currentCharIndex: 0
    }
    
    if (data.playerId === props.playerId) {
      currentWordIndex.value = 0;
      currentCharInWord.value = 0;

      mistypeFlash.value = true
      flashKey.value += 1
      setTimeout(() => {
        mistypeFlash.value = false
        isProcessingError.value = false
      }, 300)
    }
  }
}

const syncRouletteUI = () => {
  const target = displayTarget.value
  
  if (target && target.activeRoulette && target.activeRoulette.expiresAt > Date.now()) {
    rouletteResult.value = target.activeRoulette
    showRoulette.value = true
    isRouletteActive.value = (target.id === props.playerId)
  } else {
    showRoulette.value = false
    rouletteResult.value = null
    isRouletteActive.value = false
  }
}

const onRouletteResult = (data) => {
  if (players.value[data.playerId]) {
    
    players.value[data.playerId] = {
      ...players.value[data.playerId],
      rouletteOdds: data.newOdds,
      mistakeStrikes: 0,
      currentWordIndex: 0,
      currentCharInWord: 0
    };

    if (data.playerId === props.playerId && data.survived) {
      currentWordIndex.value = 0;
      currentCharInWord.value = 0;
      isProcessingError.value = false;
    }

    const fallbackOdds = data.survived ? data.newOdds + 1 : data.newOdds;

    players.value[data.playerId].activeRoulette = {
      ...data,
      previousOdds: data.previousOdds || fallbackOdds,
      expiresAt: Date.now() + 5000
    }
    
    if (data.survived) {
      players.value[data.playerId].sentenceStartTime = Date.now() + 5000;
    }

    // Auto-clear the animation state after 5 seconds
    setTimeout(() => {
      if (players.value[data.playerId]) {
        players.value[data.playerId].activeRoulette = null
      }
      if (displayTarget.value?.id === data.playerId) {
        syncRouletteUI()
      }
    }, 5000)
  }

  if (displayTarget.value?.id === data.playerId) {
    syncRouletteUI()
  }
}

const onPlayerDied = (data) => {
  // 1. Update the local data for the dying player
  if (players.value[data.playerId]) {
    players.value[data.playerId] = {
      ...players.value[data.playerId],
      status: 'DEAD'
    }
  }

  // 2. AUTO-SWITCH LOGIC
  if (displayTarget.value && data.playerId === displayTarget.value.id) {
    
    console.log(`TARGET [${data.playerId}] TERMINATED - Initiating Switch Protocol...`);
    
    setTimeout(() => {
      // Find all ALIVE players to switch to
      const alivePlayers = Object.values(players.value).filter(
        p => p.status === 'ALIVE' && p.id !== props.playerId
      );
      
      if (alivePlayers.length > 0) {
        // Sort by progress so we watch the leader
        alivePlayers.sort((a, b) => b.completedSentences - a.completedSentences);
        
        console.log(`Switching camera to ${alivePlayers[0].nickname}`);
        spectatingPlayerId.value = alivePlayers[0].id;
      }
    }, 4000); // 4 Second Mourning Period
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
  }
}

const onGameEnded = (data) => {
  console.log('🏁 Game ended event received:', data)
  
  // Update stats first
  Object.keys(data.finalStats).forEach(pId => {
     if (players.value[pId]) {
       players.value[pId] = { ...players.value[pId], ...data.finalStats[pId] }
     }
  })

  // 1. Victory Case (I won)
  if (data.winnerId === props.playerId && data.reason === 'COMPLETION') {
    showVictory.value = true
  } 
  // 2. Announcement Case (Someone else won)
  else if (data.reason === 'COMPLETION') {
    const winner = players.value[data.winnerId]
    winnerAnnouncement.value = winner ? winner.nickname : 'UNKNOWN'
  }
}

// --- MOUNT & UNMOUNT ---
onMounted(() => {
  document.addEventListener('keydown', handleKeyPress)

  props.socket.on('player_progress', onPlayerProgress)
  props.socket.on('player_strike', onPlayerStrike)
  props.socket.on('roulette_result', onRouletteResult)
  props.socket.on('player_died', onPlayerDied)
  props.socket.on('sentence_completed', onSentenceCompleted)
  props.socket.on('game_ended', onGameEnded)

  startGameLoop()
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeyPress)
  
  if (gameLoopInterval) clearInterval(gameLoopInterval)
  
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
      <div v-if="spectatorTarget" class="spectator-header-badge">
        SPECTATING: {{ spectatorTarget.nickname }}
      </div>

      <div class="header-right">
        <button v-if="isHost" @click="handleResetGame" class="term-btn-reset">ABORT</button>
        <button @click="onLeaveClick" class="term-btn">EXIT</button>
      </div>
    </div>

    <div class="terminal-body">
      <div class="typing-zone">
        
        <div v-if="displayTarget?.status === 'DEAD' && !showRoulette" class="death-screen">
          <div class="death-text">
            <p>{{ (isSpectator || displayTarget?.id !== playerId) ? 'SUBJECT TERMINATED' : 'YOU ARE DEAD' }}</p>
            
            <p>FINAL: {{ displayTarget.completedSentences }}/{{ sentences.length }}</p>
            
            <p class="death-sub">
              {{ (isSpectator || displayTarget?.id !== playerId) ? `[OBSERVING: ${displayTarget.nickname}]` : '[MISSION FAILED]' }}
            </p>
          </div>
        </div>

        <div 
          v-if="showVictory || (displayTarget?.completedSentences >= sentences.length)" 
          class="victory-screen"
        >
          <div class="victory-text">
            <p>{{ isSpectator ? 'TARGET EXTRACTED' : 'MISSION COMPLETE' }}</p>
            <p>SURVIVED: {{ displayTarget.completedSentences }}/{{ sentences.length }}</p>
            <p class="victory-sub">
              {{ isSpectator ? `[WINNER: ${displayTarget.nickname}]` : '[ANALYZING RESULTS]' }}
              <span class="loading-dots"></span>
            </p>
          </div>
        </div>

        <div v-if="winnerAnnouncement && !showVictory" class="announcement-screen">
          <div class="announcement-text">
            <p>PROTOCOL ENDED</p>
            <p class="winner-name">WINNER: {{ winnerAnnouncement }}</p>
            <p class="announcement-sub">[RETURNING TO HQ]<span class="loading-dots"></span></p>
          </div>
        </div>

        <StatusHUD
          :remainingTime="remainingTime" 
          :mistakeStrikes="displayTarget?.mistakeStrikes || 0"
          :currentSentenceIndex="displayTarget?.currentSentenceIndex || 0"
          :totalSentences="sentences.length"
          :mistypeFlash="mistypeFlash"
        />

        <TypingField
          :key="`typing-${displayTarget?.id}-${displayTarget?.currentSentenceIndex}-${displayTarget?.mistakeStrikes}-${displayTarget?.status}`"
          :sentences="sentences.map(s => Array.isArray(s) ? s.join(' ') : s)"
          :currentSentenceIndex="displayTarget?.currentSentenceIndex || 0"
          :currentWordIndex="displayTarget?.currentWordIndex || 0"
          :currentCharInWord="displayTarget?.currentCharInWord || 0"
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