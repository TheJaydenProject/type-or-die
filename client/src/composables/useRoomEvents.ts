import type { Ref } from 'vue'
import type { Socket } from 'socket.io-client'
import type { RoomState, PlayerState } from '@typeordie/shared'
import type { ClientToServerEvents, ServerToClientEvents } from '@typeordie/shared'

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>

interface RoomEventState {
  currentRoom: Ref<RoomState | null>
  error: Ref<string>
}

function playersArrayToMap(players: PlayerState[]): Record<string, PlayerState> {
  return players.reduce<Record<string, PlayerState>>((acc, player) => {
    acc[player.id] = player
    return acc
  }, {})
}

export function useRoomEvents(socket: AppSocket, state: RoomEventState) {
  const { currentRoom, error } = state

  function handlePlayerJoined(data: { playerId: string; nickname: string; role: 'PLAYER' | 'SPECTATOR'; updatedPlayers: PlayerState[] }) {
    if (!currentRoom.value || !data.updatedPlayers) return
    currentRoom.value.players = playersArrayToMap(data.updatedPlayers)
  }

  function handlePlayerLeft(data: { playerId: string; updatedPlayers: PlayerState[]; newHostId?: string }) {
    if (!currentRoom.value || !data.updatedPlayers) return
    currentRoom.value.players = playersArrayToMap(data.updatedPlayers)
    if (data.newHostId) {
      currentRoom.value.hostId = data.newHostId
    }
  }

  function handleHostMigrated(data: { newHostNickname: string }) {
    error.value = `HOST TRANSFER: ${data.newHostNickname}`
    setTimeout(() => { error.value = '' }, 3000)
  }

  function handleSettingsUpdated(data: { sentenceCount: number }) {
    if (!currentRoom.value) return
    currentRoom.value.settings.sentenceCount = data.sentenceCount
  }

  socket.on('player_joined', handlePlayerJoined)
  socket.on('player_left', handlePlayerLeft)
  socket.on('host_migrated', handleHostMigrated)
  socket.on('settings_updated', handleSettingsUpdated)

  function cleanup() {
    socket.off('player_joined', handlePlayerJoined)
    socket.off('player_left', handlePlayerLeft)
    socket.off('host_migrated', handleHostMigrated)
    socket.off('settings_updated', handleSettingsUpdated)
  }

  return { cleanup }
}
