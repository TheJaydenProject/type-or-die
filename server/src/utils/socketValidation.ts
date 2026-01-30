export const CONSTANTS = {
  COUNTDOWN_DURATION: 3000,
  DISCONNECT_GRACE_PERIOD: 30000,
  GAME_DURATION_TIMEOUT: 20000,
  MAX_NICKNAME_LENGTH: 20
} as const;

type ValidationType = 'roomCode' | 'playerId' | 'nickname' | 'sentenceIndex' | 'charIndex';

export function validateInput(type: ValidationType, data: any): void {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid data format');
  }

  switch (type) {
    case 'roomCode':
      if (!data.roomCode || typeof data.roomCode !== 'string' || data.roomCode.length !== 6) {
        throw new Error('Invalid room code');
      }
      break;
    case 'playerId':
      if (!data.playerId || typeof data.playerId !== 'string' || !/^[a-f0-9-]{36}$/.test(data.playerId)) {
        throw new Error('Invalid player ID');
      }
      break;
    case 'nickname':
      if (!data.nickname || typeof data.nickname !== 'string' || !data.nickname.trim()) {
        throw new Error('Invalid nickname');
      }
      break;
    case 'sentenceIndex':
      if (typeof data.sentenceIndex !== 'number' || data.sentenceIndex < 0) {
        throw new Error('Invalid sentence index');
      }
      break;
    case 'charIndex':
      if (typeof data.charIndex !== 'number' || data.charIndex < 0) {
        throw new Error('Invalid character index');
      }
      break;
  }
}