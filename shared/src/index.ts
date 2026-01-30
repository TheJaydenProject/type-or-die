// --- CORE ENUMS ---

export type PlayerStatus = 'ALIVE' | 'DEAD' | 'SPECTATOR' | 'DISCONNECTED';
export type RoomStatus = 'LOBBY' | 'COUNTDOWN' | 'PLAYING' | 'FINISHED';
export type GameEndReason = 'ALL_DEAD' | 'COMPLETION';

// --- ENTITIES ---

export interface PlayerState {
  id: string;
  nickname: string;
  isGuest: boolean;
  status: PlayerStatus;
  
  // Gameplay Stats
  currentSentenceIndex: number;
  currentWordIndex: number;
  currentCharInWord: number;
  currentCharIndex: number;
  
  // Performance Stats
  completedSentences: number;
  totalCorrectChars: number;
  totalTypedChars: number;
  totalMistypes: number;
  averageWPM: number;
  peakWPM: number;
  currentSessionWPM: number;
  
  // Survival Mechanics
  rouletteOdds: number;
  mistakeStrikes: number;
  rouletteHistory: RouletteEvent[];
  sentenceHistory: SentenceResult[];
  
  // System
  socketId: string | null;
  ipAddress: string;
  sentenceStartTime: number | null;
  disconnectedAt?: number | null;

  sentenceCharCount: number;
  gracePeriodActive: boolean;
}

export interface RoomState {
  roomCode: string;
  hostId: string;
  status: RoomStatus;
  creatorIP: string;
  
  settings: {
    sentenceCount: number;
    timePerSentence: number;
  };
  
  players: Record<string, PlayerState>;
  spectators: string[];
  sentences: string[];
  
  createdAt: number;
  gameStartedAt: number | null;
  lastActivity: number;
  
  // End Game Data (Optional)
  winnerId?: string;
  winnerNickname?: string;
  finalStats?: Record<string, PlayerState>;
}

// --- SUB-TYPES ---

export interface RouletteEvent {
  sentenceIndex: number;
  odds: string;
  survived: boolean;
  roll: number;
  timestamp: number;
}

export interface SentenceResult {
  sentenceIndex: number;
  completed: boolean;
  deathReason?: 'MISTYPE' | 'TIMEOUT';
  timeUsed: number;
  wpm?: number;
  newSentenceStartTime?: number;
}

// --- SOCKET DATA INTERFACE ---
export interface SocketData {
  playerId?: string;
  roomCode?: string;
  nickname?: string;
}

// --- SOCKET PROTOCOL ---

export interface ServerToClientEvents {
  // Game Flow
  sync_game_state: (data: RoomState) => void;
  countdown_start: (data: { 
    sentences: string[][];
    startTime: number; 
    duration: number; 
  }) => void;
  game_start: (data: { 
    firstSentence: string[];
    gameStartTime: number; 
  }) => void;
  sync_sentences: (data: { sentences: string[][] }) => void;
  game_ended: (data: { reason: GameEndReason; winnerId: string | null; finalStats: Record<string, PlayerState> }) => void;
  
  // Game Flow Control
  game_force_reset: (data: { room: RoomState }) => void;
  replay_started: (data: { room: RoomState }) => void;

  // Player Updates
  player_joined: (data: { playerId: string; nickname: string; role: 'PLAYER' | 'SPECTATOR'; updatedPlayers: PlayerState[] }) => void;
  player_progress: (data: Partial<PlayerState> & { playerId: string }) => void;
  player_died: (data: { playerId: string; deathReason: string }) => void;
  player_left: (data: { playerId: string; updatedPlayers: PlayerState[]; newHostId?: string }) => void;
  
  // Connection Events
  player_reconnected: (data: { playerId: string; resumedState: PlayerState }) => void;
  player_disconnected: (data: { playerId: string; gracePeriodEnd: number; updatedPlayers: PlayerState[] }) => void;
  event_error: (data: { event: string; error: string }) => void;

  // Mechanics
  player_strike: (data: { 
    playerId: string; 
    strikes: number; 
    maxStrikes: number; 
    sentenceStartTime?: number; 
  }) => void;

  roulette_result: (data: { 
    playerId: string; 
    survived: boolean; 
    newOdds: number; 
    roll: number; 
    previousOdds?: number; 
    sentenceStartTime?: number; 
  }) => void;
  
  sentence_completed: (data: {
    playerId: string;
    completedSentenceIndex: number;
    newSentenceIndex: number;
    time: number;
    wpm: number;
    sentenceStartTime: number;
    currentWordIndex: number;
    currentCharInWord: number;
    currentCharIndex: number;
  }) => void;

  // System
  settings_updated: (data: { sentenceCount: number }) => void;
  heartbeat_ack: () => void;
}

export interface ClientToServerEvents {
  // Room Management
  create_room: (data: { nickname: string; settings: { sentenceCount: number } }, callback: (res: any) => void) => void;
  join_room: (data: { roomCode: string; nickname: string }, callback: (res: any) => void) => void;
  leave_room: (data: { roomCode: string }, callback?: (res: any) => void) => void;
  change_settings: (data: { roomCode: string; sentenceCount: number }, callback: (res: any) => void) => void;

  // Game Flow Actions
  start_game: (data: { roomCode: string }, callback: (res: any) => void) => void;
  force_reset_game: (data: { roomCode: string }, callback: (res: any) => void) => void;
  request_replay: (data: { roomCode: string }, callback: (res: any) => void) => void;
  reconnect_attempt: (data: { roomCode: string; playerId: string }, callback: (res: any) => void) => void;

  // Gameplay Actions
  char_typed: (data: { roomCode: string; char: string; charIndex: number; timestamp?: number }) => void;
  mistype: (data: { roomCode: string; sentenceIndex: number; expectedChar?: string; typedChar?: string }) => void;
  sentence_timeout: (data: { roomCode: string; sentenceIndex: number }) => void;
  
  // Heartbeat
  heartbeat: () => void;
}