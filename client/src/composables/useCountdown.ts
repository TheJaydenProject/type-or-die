import { ref } from 'vue'
import type { Ref } from 'vue'
import type { Socket } from 'socket.io-client'
import type { ClientToServerEvents, ServerToClientEvents } from '@typeordie/shared'

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>

export function useCountdown(socket: AppSocket, view: Ref<string>, sentences: Ref<string[][]>) {
  const countdown = ref<number | null>(null)

  let activeInterval: ReturnType<typeof setInterval> | null = null

  function startCountdown(initialCount: number) {
    if (activeInterval !== null) {
      clearInterval(activeInterval)
    }
    countdown.value = initialCount
    let count = initialCount
    activeInterval = setInterval(() => {
      count--
      countdown.value = count
      if (count === 0) {
        clearInterval(activeInterval!)
        activeInterval = null
      }
    }, 1000)
  }

  function handleCountdownStart(data: { sentences: string[][]; startTime: number; duration: number }) {
    sentences.value = data.sentences
    view.value = 'COUNTDOWN'
    startCountdown(3)
  }

  socket.on('countdown_start', handleCountdownStart)

  function cleanup() {
    socket.off('countdown_start', handleCountdownStart)
    if (activeInterval !== null) {
      clearInterval(activeInterval)
      activeInterval = null
    }
  }

  return { countdown, cleanup }
}
