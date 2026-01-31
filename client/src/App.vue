<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { io } from 'socket.io-client'
import GameScreen from './components/GameScreen.vue'
import GameEndScreen from './components/GameEndScreen.vue'

// --- 1. STATE MANAGEMENT ---
// Initialize socket outside to keep it singleton
const socket = io('http://localhost:3001')

const connected = ref(false)
const view = ref('MENU')
const nickname = ref('')
const roomCode = ref('')
const currentRoom = ref(null)
const playerId = ref(null)
const sentenceCount = ref(15)
const error = ref('')
const loading = ref(false)
const countdown = ref(null)
const sentences = ref([])
const gameEndData = ref(null)
const userRole = ref(null)

// --- 2. SOCKET EVENT HANDLERS ---

// Helper: Handle game ended logic
const handleGameEnded = (data) => {
  console.log('App received game_ended:', data)
  
  if (currentRoom.value) {
    currentRoom.value = {
      ...currentRoom.value,
      players: data.finalStats,
      status: 'FINISHED'
    }
  }
  
  gameEndData.value = data
  
  setTimeout(() => {
    view.value = 'FINISHED'
  }, 6200)
}

// Helper: Handle player death
const handlePlayerDied = (data) => {
  if (data.playerId === playerId.value) {
    console.log('💀 YOU DIED - Initiating Local Spectator Protocol')
  }
}

// --- 3. LIFECYCLE HOOKS ---

onMounted(() => {
  // Connection Listeners
  socket.on('connect', () => {
    console.log('CONNECTION ESTABLISHED')
    connected.value = true
  })

  socket.on('disconnect', () => {
    console.log('CONNECTION TERMINATED')
    connected.value = false
  })

  // Game Logic Listeners
  socket.on('game_ended', handleGameEnded)
  socket.on('player_died', handlePlayerDied)

  socket.on('settings_updated', (data) => {
    console.log('SETTINGS_UPDATED:', data)
    if (currentRoom.value) {
      currentRoom.value.settings.sentenceCount = data.sentenceCount
    }
  })

  socket.on('player_joined', (data) => {
    console.log('PLAYER_JOINED:', data)
    if (currentRoom.value && data.updatedPlayers) {
      const playerMap = data.updatedPlayers.reduce((acc, player) => {
        acc[player.id] = player
        return acc
      }, {})
      currentRoom.value.players = playerMap
    }
  })

  socket.on('player_left', (data) => {
    console.log('PLAYER_LEFT:', data)
    if (currentRoom.value && data.updatedPlayers) {
      const playerMap = data.updatedPlayers.reduce((acc, player) => {
        acc[player.id] = player
        return acc
      }, {})
      
      currentRoom.value.players = playerMap
      
      if (data.newHostId) {
        console.log(`👑 Host transferred to: ${data.newHostId}`)
        currentRoom.value.hostId = data.newHostId
      }
    }
  })

  socket.on('host_migrated', (data) => {
    console.log('HOST_MIGRATED:', data)
    error.value = `HOST TRANSFER: ${data.newHostNickname}`
    setTimeout(() => error.value = '', 3000)
  })

  socket.on('countdown_start', (data) => {
    console.log('COUNTDOWN_START:', data)
    sentences.value = data.sentences
    countdown.value = 3
    view.value = 'COUNTDOWN'
    
    let count = 3
    const interval = setInterval(() => {
      count--
      countdown.value = count
      if (count === 0) {
        clearInterval(interval)
      }
    }, 1000)
  })

  socket.on('game_start', (data) => {
    console.log('GAME_START:', data)
    view.value = 'GAME'
    countdown.value = null
  })

  socket.on('replay_started', (data) => {
    console.log('REPLAY INITIATED')
    currentRoom.value = data.room
    gameEndData.value = null
    userRole.value = 'PLAYER'
    sentences.value = []
    countdown.value = null
    view.value = 'LOBBY'
  })

  socket.on('sync_sentences', (data) => {
    console.log(`Syncing ${data.sentences.length} word-arrays for spectator`)
    sentences.value = data.sentences
  })

  socket.on('game_force_reset', (data) => {
    console.log('GAME FORCE RESET BY HOST')
    currentRoom.value = data.room
    gameEndData.value = null
    userRole.value = 'PLAYER'
    sentences.value = []
    countdown.value = null
    view.value = 'LOBBY'
  })
})

onUnmounted(() => {
  // Clean up all listeners
  socket.off()
})

// --- 4. RECONNECTION LOGIC ---
// Watch for connection status to attempt reconnect
watch(connected, (isConnected) => {
  const savedSession = localStorage.getItem('type_or_die_session')
  
  if (savedSession && isConnected && view.value === 'MENU') {
    const { playerId: savedId, roomCode: savedCode } = JSON.parse(savedSession)
    console.log('Attempting reconnection...', { savedId, savedCode })
    loading.value = true

    socket.emit('reconnect_attempt', { roomCode: savedCode, playerId: savedId }, (response) => {
      if (response.success) {
        console.log('RECONNECTION SUCCESSFUL')
        currentRoom.value = response.room
        playerId.value = response.playerId
        
        const player = response.room.players[response.playerId]
        const isSpectator = response.room.spectators?.includes(response.playerId) || 
                           player?.status === 'DEAD'
        
        userRole.value = isSpectator ? 'SPECTATOR' : 'PLAYER'

        if (response.room.sentences && response.room.sentences.length > 0) {
          sentences.value = response.room.sentences
        }
        
        if (response.room.status === 'PLAYING' || response.room.status === 'COUNTDOWN') {
          view.value = 'GAME'
        } else {
          view.value = 'LOBBY'
        }
        
        error.value = 'Reconnected successfully!'
        setTimeout(() => error.value = '', 2000)
      } else {
        console.log('RECONNECTION FAILED:', response.error)
        error.value = `RECONNECTION FAILED: ${response.error}`
        localStorage.removeItem('type_or_die_session')
        setTimeout(() => error.value = '', 3000)
      }
      loading.value = false
    })
  }
})

// --- 5. ACTION HANDLERS ---

const handleCreateRoom = () => {
  if (!nickname.value.trim()) {
    error.value = 'ERROR: NICKNAME REQUIRED'
    return
  }

  loading.value = true
  error.value = ''

  socket.emit('create_room', {
    nickname: nickname.value.trim(),
    settings: {
      sentenceCount: sentenceCount.value
    }
  }, (response) => {
    loading.value = false
    if (response.success) {
      console.log('ROOM_CREATED:', response.roomCode)
      currentRoom.value = response.room
      playerId.value = response.playerId
      userRole.value = 'PLAYER'
      view.value = 'LOBBY'
      localStorage.setItem('type_or_die_session', JSON.stringify({
        playerId: response.playerId,
        roomCode: response.room.roomCode
      }))
    } else {
      error.value = `ERROR: ${response.error.toUpperCase()}`
    }
  })
}

const handleJoinRoom = () => {
  if (!nickname.value.trim()) {
    error.value = 'ERROR: NICKNAME REQUIRED'
    return
  }
  if (!roomCode.value.trim() || roomCode.value.length !== 6) {
    error.value = 'ERROR: INVALID ROOM CODE'
    return
  }

  loading.value = true
  error.value = ''

  socket.emit('join_room', {
    roomCode: roomCode.value.toUpperCase(),
    nickname: nickname.value.trim()
  }, (response) => {
    loading.value = false
    if (response.success) {
      console.log('ROOM_JOINED:', response.room.roomCode)
      currentRoom.value = response.room
      playerId.value = response.playerId
      userRole.value = response.role

      if (response.sentences && response.sentences.length > 0) {
        sentences.value = response.sentences
      }

      view.value = response.role === 'SPECTATOR' ? 'GAME' : 'LOBBY'

      localStorage.setItem('type_or_die_session', JSON.stringify({
        playerId: response.playerId,
        roomCode: response.room.roomCode
      }))
    } else {
      error.value = `ERROR: ${response.error.toUpperCase()}`
    }
  })
}

const handleLeaveRoom = () => {
  if (currentRoom.value) {
    socket.emit('leave_room', { roomCode: currentRoom.value.roomCode })
    localStorage.removeItem('type_or_die_session')
    currentRoom.value = null
    playerId.value = null
    sentences.value = []
    gameEndData.value = null
    countdown.value = null
    userRole.value = null
    view.value = 'MENU'
    roomCode.value = ''
  }
}

const handleChangeSentences = (value) => {
  if (currentRoom.value && currentRoom.value.hostId === playerId.value) {
    // Optimistic update
    currentRoom.value.settings.sentenceCount = value

    socket.emit('change_settings', {
      roomCode: currentRoom.value.roomCode,
      sentenceCount: value
    }, (response) => {
      if (!response.success) {
        error.value = `ERROR: ${response.error.toUpperCase()}`
      }
    })
  }
}

const copyRoomCode = () => {
  if (currentRoom.value) {
    navigator.clipboard.writeText(currentRoom.value.roomCode)
    error.value = 'ROOM CODE COPIED TO CLIPBOARD'
    setTimeout(() => error.value = '', 2000)
  }
}

const handleStartGame = () => {
  if (currentRoom.value && currentRoom.value.hostId === playerId.value) {
    loading.value = true
    socket.emit('start_game', { roomCode: currentRoom.value.roomCode }, (response) => {
      loading.value = false
      if (!response.success) {
        error.value = `ERROR: ${response.error.toUpperCase()}`
      }
    })
  }
}

// Handlers for End Screen interaction
const onMainMenu = () => {
  localStorage.removeItem('type_or_die_session')
  sentences.value = []
  gameEndData.value = null
  countdown.value = null
  userRole.value = null
  view.value = 'MENU'
}

const onReplay = () => {
  if (currentRoom.value && currentRoom.value.hostId === playerId.value) {
    console.log('HOST REPLAY REQUESTED')
    socket.emit('request_replay', { roomCode: currentRoom.value.roomCode }, (response) => {
      if (response.success) {
        console.log('Replay request successful')
      } else {
        error.value = `ERROR: ${response.error.toUpperCase()}`
      }
    })
  } else {
    console.log('RETURNING TO LOBBY (LOCAL)')
    gameEndData.value = null
    sentences.value = []
    userRole.value = 'PLAYER'
    view.value = 'LOBBY'
  }
}
</script>

<template>
  <div class="app">
    
    <div v-if="view === 'MENU'" class="container">
      <header>
        <h1>Type or Die</h1>
        <p class="tagline">TYPE OR DIE</p>
      </header>

      <div class="status">
        {{ connected ? '[ONLINE]' : '[CONNECTING...]' }}
      </div>

      <div v-if="error" class="error">{{ error }}</div>

      <div class="form-section">
        <label>OPERATOR NAME</label>
        <input
          type="text"
          placeholder="ENTER CALLSIGN"
          :value="nickname"
          @input="e => nickname = e.target.value.toUpperCase()"
          maxlength="20"
          class="input"
        />
      </div>

      <div class="form-section">
        <label>SENTENCE COUNT: {{ sentenceCount }}</label>
        <input
          type="range"
          min="5"
          max="100"
          step="5"
          v-model.number="sentenceCount"
          class="slider"
        />
        <div class="slider-labels">
          <span>5</span>
          <span>100</span>
        </div>
      </div>

      <button 
        @click="handleCreateRoom" 
        :disabled="!connected || loading"
        class="btn-primary"
      >
        {{ loading ? 'INITIALIZING...' : 'CREATE ROOM' }}
      </button>

      <div class="divider">OR</div>

      <div class="form-section">
        <label>ROOM ACCESS CODE</label>
        <input
          type="text"
          placeholder="XXXXXX"
          :value="roomCode"
          @input="e => roomCode = e.target.value.toUpperCase()"
          maxlength="6"
          class="input"
        />
      </div>

      <button 
        @click="handleJoinRoom" 
        :disabled="!connected || loading"
        class="btn-secondary"
      >
        {{ loading ? 'CONNECTING...' : 'JOIN ROOM' }}
      </button>
    </div>

    <div v-else-if="view === 'LOBBY' && currentRoom" class="container">
      <div class="lobby-header">
        <button @click="handleLeaveRoom" class="btn-back">
          EXIT
        </button>
        <div class="room-code-display">
          ROOM: <strong>{{ currentRoom.roomCode }}</strong>
          <button @click="copyRoomCode" class="btn-copy">
            COPY
          </button>
        </div>
      </div>

      <div v-if="error" class="error">{{ error }}</div>

      <div class="settings-section">
        <h2>PARAMETERS</h2>
        <div class="form-section">
          <label>SENTENCE COUNT: {{ currentRoom.settings?.sentenceCount ?? 50 }}</label>
          <input
            type="range"
            min="5"
            max="100"
            step="5"
            :value="currentRoom.settings?.sentenceCount ?? 50"
            @input="e => handleChangeSentences(parseInt(e.target.value))"
            :disabled="currentRoom.hostId !== playerId"
            class="slider"
          />
          <div class="slider-labels">
            <span>5</span>
            <span>100</span>
          </div>
          <p v-if="currentRoom.hostId !== playerId" class="note">[HOST ONLY]</p>
        </div>
      </div>

      <div class="players-section">
        <h2>OPERATORS ({{ Object.values(currentRoom.players).length }})</h2>
        <div class="player-list">
          <div 
            v-for="player in Object.values(currentRoom.players)" 
            :key="player.id" 
            class="player-item"
          >
            {{ player.id === currentRoom.hostId ? '[HOST] ' : '' }}
            {{ player.nickname }}
          </div>
        </div>
      </div>

      <button 
        v-if="currentRoom.hostId === playerId"
        @click="handleStartGame"
        :disabled="loading"
        class="btn-primary"
        style="margin-top: 20px"
      >
        {{ loading ? 'INITIALIZING...' : 'BEGIN PROTOCOL' }}
      </button>

      <p v-else class="note">AWAITING HOST AUTHORIZATION...</p>
    </div>

    <div v-else-if="view === 'COUNTDOWN'" class="container countdown-container">
      <div class="countdown-number">
        {{ countdown }}
      </div>
      <p class="countdown-text">
        {{ countdown > 0 ? 'GET READY TO TYPE...' : 'START TYPING NOW!' }}
      </p>
    </div>

    <GameScreen
      v-else-if="view === 'GAME' && currentRoom"
      :key="`game-${currentRoom.roomCode}-${currentRoom.gameStartedAt || 'lobby'}`"
      :socket="socket"
      :room="currentRoom"
      :playerId="playerId"
      :sentences="sentences"
      :isSpectator="userRole === 'SPECTATOR'"
      @leave="handleLeaveRoom"
    />

    <GameEndScreen
      v-else-if="view === 'FINISHED' && gameEndData"
      :gameEndData="gameEndData"
      :room="currentRoom"
      :playerId="playerId"
      :sentences="sentences"
      @mainMenu="onMainMenu"
      @replay="onReplay"
    />

    <div v-else class="app">LOADING...</div>

  </div>
</template>

<style src="./App.css"></style>