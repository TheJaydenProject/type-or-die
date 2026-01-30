import { PlayerState } from '@typeordie/shared';

// Use NodeJS.Timeout for server-side timers
export const disconnectTimers = new Map<string, NodeJS.Timeout>();
export const roomCountdownTimers = new Map<string, NodeJS.Timeout>();
// Stores promises to ensure events process in order
export const playerEventQueues = new Map<string, Promise<void>>();

export function resetPlayerToLobbyState(player: PlayerState): void {
  player.status = 'ALIVE';
  player.currentSentenceIndex = 0;
  player.rouletteOdds = 6;
  player.mistakeStrikes = 0;
  player.completedSentences = 0;
  player.totalCorrectChars = 0;
  player.totalTypedChars = 0;
  player.totalMistypes = 0;
  player.currentCharIndex = 0;
  player.currentWordIndex = 0;
  player.currentCharInWord = 0;
  player.sentenceStartTime = null;
  player.rouletteHistory = [];
  player.sentenceHistory = [];
  player.averageWPM = 0;
  player.peakWPM = 0;
  player.currentSessionWPM = 0;
  
  player.sentenceCharCount = 0;
  player.gracePeriodActive = false;
  
  player.disconnectedAt = null;
}

export function cleanupDisconnectTimer(playerId: string): void {
  if (disconnectTimers.has(playerId)) {
    clearTimeout(disconnectTimers.get(playerId));
    disconnectTimers.delete(playerId);
  }
}

export function cleanupRoomTimer(roomCode: string): void {
  if (roomCountdownTimers.has(roomCode)) {
    clearTimeout(roomCountdownTimers.get(roomCode));
    roomCountdownTimers.delete(roomCode);
  }
}

export function queuePlayerEvent(playerId: string, eventProcessor: () => Promise<void>): Promise<void> {
  if (!playerEventQueues.has(playerId)) {
    playerEventQueues.set(playerId, Promise.resolve());
  }

  // Non-null assertion (!) is safe here because we just set it if missing
  const currentQueue = playerEventQueues.get(playerId)!;
  
  const newQueue = currentQueue
    .then(eventProcessor)
    .catch((err) => {
      console.error(`Event queue error for player ${playerId}:`, err);
    });

  playerEventQueues.set(playerId, newQueue);
  return newQueue;
}