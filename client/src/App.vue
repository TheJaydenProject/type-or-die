<template>
  <div class="app" v-if="view === 'MENU'">
    <div class="container">
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
          v-model="nickname"
          @input="nickname = nickname.toUpperCase()"
          :maxlength="20"
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
          v-model="roomCode"
          @input="roomCode = roomCode.toUpperCase()"
          :maxlength="6"
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
  </div>

  <div class="app" v-else-if="view === 'LOBBY' && currentRoom">
    <div class="container">
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
            @input="handleChangeSentences(parseInt($event.target.value))"
            :disabled="!isHost"
            class="slider"
          />
          <div class="slider-labels">
            <span>5</span>
            <span>100</span>
          </div>
          <p v-if="!isHost" class="note">[HOST ONLY]</p>
        </div>
      </div>

      <div class="players-section">
        <h2>OPERATORS ({{ players.length }})</h2>
        <div class="player-list">
          <div 
            v-for="player in players" 
            :key="player.id" 
            class="player-item"
          >
            {{ player.id === currentRoom.hostId ? '[HOST] ' : '' }}
            {{ player.nickname }}
            {{ player.status === 'DEAD' ? ' [DEAD - BUG]' : '' }}
          </div>
        </div>
      </div>

      <button 
        v-if="isHost"
        @click="handleStartGame"
        :disabled="loading"
        class="btn-primary" 
        style="margin-top: 20px"
      >
        {{ loading ? 'INITIALIZING...' : 'BEGIN PROTOCOL' }}
      </button>

      <p v-else class="note">AWAITING HOST AUTHORIZATION...</p>
    </div>
  </div>

  <div class="app" v-else-if="view === 'COUNTDOWN'">
    <div class="container countdown-container">
      <div class="countdown-number">
        {{ countdown > 0 ? countdown : 'GO!' }}
      </div>
      <p class="countdown-text">
        {{ countdown > 0 ? 'GET READY TO TYPE...' : 'START TYPING NOW!' }}
      </p>
    </div>
  </div>

  <GameScreen
    v-else-if="view === 'GAME' && currentRoom"
    :key="`game-${currentRoom.roomCode}-${currentRoom.gameStartedAt || 'lobby'}`"
    :socket="socket"
    :room="currentRoom"
    :player-id="playerId"
    :sentences="sentences"
    :is-spectator="userRole === 'SPECTATOR'"
    @leave="handleLeaveRoom"
  />

  <GameEndScreen
    v-else-if="view === 'FINISHED' && gameEndData"
    :game-end-data="gameEndData"
    :room="currentRoom"
    :player-id="playerId"
    :sentences="sentences"
    @main-menu="handleMainMenu"
    @replay="handleReplay"
  />

  <div v-else class="app">LOADING...</div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { io } from 'socket.io-client'
import GameScreen from './components/GameScreen.vue'
import GameEndScreen from './components/GameEndScreen.vue'

const socket = io()

// State
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

// Computed
const isHost = computed(() => 
  currentRoom.value && currentRoom.value.hostId === playerId.value
)

const players = computed(() => 
  currentRoom.value ? Object.values(currentRoom.value.players) : []
)

// Socket event handlers
function setupSocketListeners() {
  socket.on('connect', () => {
    console.log('CONNECTION ESTABLISHED')
    connected.value = true
  })

  socket.on('disconnect', () => {
    console.log('CONNECTION TERMINATED')
    connected.value = false
  })

  socket.on('settings_updated', (data) => {
    console.log('SETTINGS_UPDATED:', data)
    if (currentRoom.value) {
      currentRoom.value = {
        ...currentRoom.value,
        settings: {
          ...currentRoom.value.settings,
          sentenceCount: data.sentenceCount
        }
      }
    }
  })

  socket.on('player_joined', (data) => {
    console.log('PLAYER_JOINED:', data)
    if (currentRoom.value && data.updatedPlayers) {
      currentRoom.value = {
        ...currentRoom.value,
        players: data.updatedPlayers.reduce((acc, player) => {
          acc[player.id] = player
          return acc
        }, {})
      }
    }
  })

  socket.on('player_left', (data) => {
    console.log('PLAYER_LEFT:', data)
    if (currentRoom.value && data.updatedPlayers) {
      currentRoom.value = {
        ...currentRoom.value,
        players: data.updatedPlayers.reduce((acc, player) => {
          acc[player.id] = player
          return acc
        }, {}),
        hostId: data.newHostId || currentRoom.value.hostId
      }
    }
  })

  socket.on('host_migrated', (data) => {
    console.log('HOST_MIGRATED:', data)
    error.value = `HOST TRANSFER: ${data.newHostNickname}`
    setTimeout(() => { error.value = '' }, 3000)
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
    console.log('REPLAY INITIATED - Resetting all client state')
    console.log('  → Updated room with reset players:', data.room.players)
    
    currentRoom.value = data.room
    gameEndData.value = null
    userRole.value = 'PLAYER'
    sentences.value = []
    countdown.value = null
    view.value = 'LOBBY'
  })

  socket.on('sync_sentences', (data) => {
    console.log(`Syncing ${data.sentences.length} sentences for spectator`)
    sentences.value = data.sentences
  })

  socket.on('game_force_reset', (data) => {
    console.log('GAME FORCE RESET BY HOST - Resetting all client state')
    console.log('  → Updated room with reset players:', data.room.players)
    
    currentRoom.value = data.room
    gameEndData.value = null
    userRole.value = 'PLAYER'
    sentences.value = []
    countdown.value = null
    view.value = 'LOBBY'
  })

  socket.on('game_ended', (data) => {
    console.log('App.vue received game_ended:', data)
    
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
  })

  socket.on('player_died', (data) => {
    if (data.playerId === playerId.value) {
      console.log('💀 YOU DIED - Transitioning to spectator mode')
      userRole.value = 'SPECTATOR'
    }
  })
}

function cleanupSocketListeners() {
  socket.off('connect')
  socket.off('disconnect')
  socket.off('settings_updated')
  socket.off('player_joined')
  socket.off('player_left')
  socket.off('host_migrated')
  socket.off('countdown_start')
  socket.off('game_start')
  socket.off('replay_started')
  socket.off('sync_sentences')
  socket.off('game_force_reset')
  socket.off('game_ended')
  socket.off('player_died')
}

// Reconnection logic
watch([connected, view], () => {
  const savedSession = localStorage.getItem('type_or_die_session')
  
  if (savedSession && connected.value && view.value === 'MENU') {
    const session = JSON.parse(savedSession)
    
    console.log('Attempting reconnection...', session)
    loading.value = true
    
    socket.emit('reconnect_attempt', { 
      roomCode: session.roomCode, 
      playerId: session.playerId 
    }, (response) => {
      if (response.success) {
        console.log('RECONNECTION SUCCESSFUL')
        currentRoom.value = response.room
        playerId.value = response.playerId
        
        const player = response.room.players[response.playerId]
        const isSpectator = response.room.spectators?.includes(response.playerId) || 
                            player?.status === 'DEAD'
        userRole.value = isSpectator ? 'SPECTATOR' : 'PLAYER'
        
        if (response.room.status === 'PLAYING' || response.room.status === 'COUNTDOWN') {
          view.value = 'GAME'
        } else {
          view.value = 'LOBBY'
        }
        
        error.value = 'Reconnected successfully!'
        setTimeout(() => { error.value = '' }, 2000)
      } else {
        console.log('RECONNECTION FAILED:', response.error)
        error.value = `RECONNECTION FAILED: ${response.error}`
        localStorage.removeItem('type_or_die_session')
        setTimeout(() => { error.value = '' }, 3000)
      }
      loading.value = false
    })
  }
})

// Action handlers
function handleCreateRoom() {
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

function handleJoinRoom() {
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
        console.log(`Loaded ${response.sentences.length} sentences for spectator`)
      }

      if (response.role === 'SPECTATOR') {
        view.value = 'GAME'
      } else {
        view.value = 'LOBBY'
      }

      localStorage.setItem('type_or_die_session', JSON.stringify({
        playerId: response.playerId,
        roomCode: response.room.roomCode
      }))
    } else {
      error.value = `ERROR: ${response.error.toUpperCase()}`
    }
  })
}

function handleLeaveRoom() {
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

function handleChangeSentences(value) {
  if (currentRoom.value && currentRoom.value.hostId === playerId.value) {
    currentRoom.value = {
      ...currentRoom.value,
      settings: {
        ...currentRoom.value.settings,
        sentenceCount: value
      }
    }

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

function copyRoomCode() {
  if (currentRoom.value) {
    navigator.clipboard.writeText(currentRoom.value.roomCode)
    error.value = 'ROOM CODE COPIED TO CLIPBOARD'
    setTimeout(() => { error.value = '' }, 2000)
  }
}

function handleStartGame() {
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

function handleMainMenu() {
  localStorage.removeItem('type_or_die_session')
  sentences.value = []
  gameEndData.value = null
  countdown.value = null
  userRole.value = null
  view.value = 'MENU'
}

function handleReplay() {
  console.log('REPLAY BUTTON CLICKED - Requesting replay from server')
  socket.emit('request_replay', { roomCode: currentRoom.value.roomCode }, (response) => {
    if (response.success) {
      console.log('Replay request successful')
    } else {
      console.error('Replay request failed:', response.error)
      error.value = `ERROR: ${response.error.toUpperCase()}`
    }
  })
}

// Lifecycle
onMounted(() => {
  setupSocketListeners()
})

onUnmounted(() => {
  cleanupSocketListeners()
})
</script>

<style>
@import './App.css';
</style>