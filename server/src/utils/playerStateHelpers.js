import { CONSTANTS } from './socketValidation.js';

export function resetPlayerToLobbyState(player) {
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
  player.disconnectedAt = null;
  player.gracePeriodActive = false;
}

export const disconnectTimers = new Map();
export const roomCountdownTimers = new Map();
export const playerEventQueues = new Map();

export function cleanupDisconnectTimer(playerId) {
  if (disconnectTimers.has(playerId)) {
    clearTimeout(disconnectTimers.get(playerId));
    disconnectTimers.delete(playerId);
  }
}

export function cleanupRoomTimer(roomCode) {
  if (roomCountdownTimers.has(roomCode)) {
    clearTimeout(roomCountdownTimers.get(roomCode));
    roomCountdownTimers.delete(roomCode);
  }
}

export function queuePlayerEvent(playerId, eventProcessor) {
  if (!playerEventQueues.has(playerId)) {
    playerEventQueues.set(playerId, Promise.resolve());
  }

  const currentQueue = playerEventQueues.get(playerId);
  
  const newQueue = currentQueue
    .then(eventProcessor)
    .catch(err => {
      console.error(`Event queue error for player ${playerId}:`, err);
    });

  playerEventQueues.set(playerId, newQueue);
  return newQueue;
}