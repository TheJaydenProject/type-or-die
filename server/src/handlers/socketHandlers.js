import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import roomManager from '../services/roomManager.js';
import sentenceService from '../services/sentenceService.js';

// ==========================================
// CONSTANTS & STATE MANAGEMENT
// ==========================================

const CONSTANTS = {
  COUNTDOWN_DURATION: 3000,
  DISCONNECT_GRACE_PERIOD: 30000,
  GAME_DURATION_TIMEOUT: 20000, // 20 seconds to type a sentence before death
  MAX_NICKNAME_LENGTH: 20
};

// Maps to track active timers and queues
const disconnectTimers = new Map();
const roomCountdownTimers = new Map();
const playerEventQueues = new Map();

// ==========================================
// HELPER FUNCTIONS
// ==========================================


// Clears the disconnect timer for a player (used on reconnect).
function cleanupDisconnectTimer(playerId) {
  if (disconnectTimers.has(playerId)) {
    clearTimeout(disconnectTimers.get(playerId));
    disconnectTimers.delete(playerId);
  }
}


// Clears the game start countdown (used on force reset or game start).
function cleanupRoomTimer(roomCode) {
  if (roomCountdownTimers.has(roomCode)) {
    clearTimeout(roomCountdownTimers.get(roomCode));
    roomCountdownTimers.delete(roomCode);
  }
}


// Validates input data structures to fail fast before DB calls.
function validateInput(type, data) {
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


function queuePlayerEvent(playerId, eventProcessor) {
  if (!playerEventQueues.has(playerId)) {
    playerEventQueues.set(playerId, Promise.resolve());
  }

  const currentQueue = playerEventQueues.get(playerId);
  
  // Chain the new operation to the end of the existing promise chain
  const newQueue = currentQueue
    .then(eventProcessor)
    .catch(err => {
      console.error(`Event queue error for player ${playerId}:`, err);
    });

  playerEventQueues.set(playerId, newQueue);
  return newQueue;
}

// ==========================================
// CORE GAME LOGIC PROCESSORS
// These functions are called strictly sequentially via queuePlayerEvent
// ==========================================

async function checkGameOver(io, roomCode, room) {
  const alivePlayers = Object.values(room.players).filter(p => p.status === 'ALIVE');
  
  // If everyone is dead, end the game immediately
  if (alivePlayers.length === 0) {
    const sortedPlayers = Object.values(room.players).sort((a, b) => {
      if (b.completedSentences !== a.completedSentences) {
        return b.completedSentences - a.completedSentences;
      }
      return b.totalCorrectChars - a.totalCorrectChars;
    });

    room.status = 'FINISHED';
    cleanupRoomTimer(roomCode);
    await roomManager.updateRoom(roomCode, room);

    io.to(roomCode).emit('game_ended', {
      reason: 'ALL_DEAD',
      winnerId: sortedPlayers[0]?.id || null,
      winnerNickname: sortedPlayers[0]?.nickname || 'No One',
      finalStats: room.players
    });
    return true; // Game Ended
  }
  
  // Save state if game continues
  await roomManager.updateRoom(roomCode, room);
  return false; // Game Continues
}

async function processCharTypedEvent(io, socket, data) {
  const playerId = socket.playerId;
  const { roomCode, char, charIndex } = data;

  const updated = await roomManager.atomicCharUpdate(roomCode, playerId, char, charIndex);
  
  if (!updated) {
    return; 
  }

  const { room, player, result } = updated;

  if (result.type === 'CORRECT') {
    io.to(roomCode).emit('player_progress', {
      playerId,
      charIndex: player.currentCharIndex,
      sentenceIndex: player.currentSentenceIndex,
      currentWordIndex: result.wordIndex,
      currentCharInWord: result.charInWord,
      completedSentences: player.completedSentences,
      totalCorrectChars: player.totalCorrectChars,
      totalTypedChars: player.totalTypedChars,
      totalMistypes: player.totalMistypes,
      wpm: player.currentSessionWPM,
      status: player.status,
      sentenceStartTime: player.sentenceStartTime
    });
  } else if (result.type === 'SENTENCE_COMPLETE') {
    await roomManager.updateRoom(roomCode, room);
    
    if (player.completedSentences === room.settings.sentenceCount) {
      // WIN CONDITION
      room.status = 'FINISHED';
      cleanupRoomTimer(roomCode);
      // Room already saved above, update status change only
      await roomManager.updateRoom(roomCode, room);

      io.to(roomCode).emit('game_ended', {
        reason: 'COMPLETION',
        winnerId: playerId,
        winnerNickname: player.nickname,
        finalStats: room.players
      });
    } else {
      // NEXT SENTENCE
      io.to(roomCode).emit('sentence_completed', {
        playerId,
        completedSentenceIndex: player.currentSentenceIndex - 1,
        newSentenceIndex: player.currentSentenceIndex,
        time: result.timeUsed,
        wpm: player.currentSessionWPM,
        sentenceStartTime: result.newSentenceStartTime,
        currentWordIndex: 0,
        currentCharInWord: 0,
        currentCharIndex: 0
      });

      io.to(roomCode).emit('player_progress', {
        playerId,
        charIndex: 0,
        sentenceIndex: player.currentSentenceIndex,
        currentWordIndex: 0,
        currentCharInWord: 0,
        completedSentences: player.completedSentences,
        totalCorrectChars: player.totalCorrectChars,
        totalTypedChars: player.totalTypedChars,
        totalMistypes: player.totalMistypes,
        wpm: player.currentSessionWPM,
        status: player.status,
        sentenceStartTime: result.newSentenceStartTime
      });
    }
  } else if (result.type === 'MISTYPE') {
    io.to(roomCode).emit('player_progress', {
      playerId,
      charIndex: player.currentCharIndex,
      sentenceIndex: player.currentSentenceIndex,
      currentWordIndex: player.currentWordIndex || 0,
      currentCharInWord: player.currentCharInWord || 0,
      completedSentences: player.completedSentences,
      totalCorrectChars: player.totalCorrectChars,
      totalTypedChars: player.totalTypedChars,
      totalMistypes: player.totalMistypes,
      wpm: player.currentSessionWPM,
      status: player.status,
      sentenceStartTime: player.sentenceStartTime
    });
  }
}

async function processMistypeEvent(io, socket, data) {
  const playerId = socket.playerId;
  const { roomCode, sentenceIndex } = data;

  const room = await roomManager.getRoom(roomCode);
  if (!room || room.status !== 'PLAYING') return;

  const player = room.players[playerId];
  if (!player || player.status !== 'ALIVE') return;

  player.mistakeStrikes = (player.mistakeStrikes || 0) + 1;
  player.totalMistypes++;

  // Reset current sentence progress on strike
  player.currentCharIndex = 0;
  player.currentWordIndex = 0;
  player.currentCharInWord = 0;
  
  const resetStartTime = Date.now();
  player.sentenceStartTime = resetStartTime;

  io.to(roomCode).emit('player_strike', {
    playerId: playerId,
    strikes: player.mistakeStrikes,
    maxStrikes: 3,
    sentenceStartTime: resetStartTime
  });

  // Russian Roulette Logic if 3 strikes
  if (player.mistakeStrikes >= 3) {
    player.mistakeStrikes = 0;
    const odds = player.rouletteOdds;
    const roll = crypto.randomInt(1, odds + 1);
    const survived = roll > 1;

    player.rouletteHistory.push({
      sentenceIndex: sentenceIndex,
      odds: `1/${odds}`,
      survived: survived,
      roll: roll,
      timestamp: Date.now()
    });

    if (survived) {
      // Survive: Make game harder (decrease odds)
      player.rouletteOdds = Math.max(2, odds - 1);
      
      io.to(roomCode).emit('roulette_result', {
        playerId: playerId,
        survived: true,
        newOdds: player.rouletteOdds,
        roll: roll,
        previousOdds: odds,
        sentenceStartTime: resetStartTime
      });
    } else {
      // Die
      player.status = 'DEAD';
      player.sentenceHistory.push({
        sentenceIndex: sentenceIndex,
        completed: false,
        deathReason: 'MISTYPE',
        timeUsed: (Date.now() - player.sentenceStartTime) / 1000
      });

      io.to(roomCode).emit('roulette_result', {
        playerId: playerId,
        survived: false,
        newOdds: odds,
        roll: roll,
        previousOdds: odds
      });

      io.to(roomCode).emit('player_died', {
        playerId: playerId,
        deathReason: 'MISTYPE'
      });

      await checkGameOver(io, roomCode, room);
      return; 
    }
  }

  await roomManager.updateRoom(roomCode, room);
}

async function processTimeoutEvent(io, socket, data) {
  const playerId = socket.playerId;
  const { roomCode, sentenceIndex } = data;

  const room = await roomManager.getRoom(roomCode);
  if (!room || room.status !== 'PLAYING') return;

  const player = room.players[playerId];
  if (!player || player.status !== 'ALIVE') return;

  const odds = player.rouletteOdds;
  const roll = crypto.randomInt(1, odds + 1);
  const survived = roll > 1;
  
  player.rouletteHistory.push({
    sentenceIndex: sentenceIndex,
    odds: `1/${odds}`,
    survived: survived,
    roll: roll,
    timestamp: Date.now()
  });

  if (survived) {
    // Survive: Reset sentence
    player.rouletteOdds = Math.max(2, odds - 1);
    player.currentCharIndex = 0;
    const timeoutResetTime = Date.now();
    player.sentenceStartTime = timeoutResetTime;

    io.to(roomCode).emit('roulette_result', {
      playerId: playerId,
      survived: true,
      newOdds: player.rouletteOdds,
      roll: roll,
      previousOdds: odds,
      sentenceStartTime: timeoutResetTime
    });
    
    await roomManager.updateRoom(roomCode, room);
  } else {
    // Die
    player.status = 'DEAD';
    player.sentenceHistory.push({
      sentenceIndex: sentenceIndex,
      completed: false,
      deathReason: 'TIMEOUT',
      timeUsed: CONSTANTS.GAME_DURATION_TIMEOUT / 1000
    });

    io.to(roomCode).emit('roulette_result', {
      playerId: playerId,
      survived: false,
      newOdds: odds,
      roll: roll,
      previousOdds: odds
    });

    io.to(roomCode).emit('player_died', {
      playerId: playerId,
      deathReason: 'TIMEOUT'
    });

    await checkGameOver(io, roomCode, room);
  }
}

// ==========================================
// SOCKET HANDLER SETUP
// ==========================================

export default function setupSocketHandlers(io) {
  io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);

    // --- LOBBY EVENTS ---

    socket.on('create_room', async (data, callback) => {
      try {
        roomManager.validateEventData('create_room', data);
        validateInput('nickname', data);

        const { nickname, settings } = data;
        const ipAddress = socket.handshake.address;
        const playerId = uuidv4();

        if (!settings || !settings.sentenceCount) {
          return callback({ success: false, error: 'Invalid settings' });
        }

        const room = await roomManager.createRoom(
          playerId,
          nickname.trim().substring(0, CONSTANTS.MAX_NICKNAME_LENGTH),
          settings,
          ipAddress
        );

        socket.join(room.roomCode);
        socket.playerId = playerId;
        socket.roomCode = room.roomCode;
        
        room.players[playerId].socketId = socket.id;
        await roomManager.updateRoom(room.roomCode, room);

        console.log(`Room created: ${room.roomCode}`);

        callback({ 
          success: true, 
          roomCode: room.roomCode,
          playerId: playerId,
          role: 'PLAYER',
          room: room
        });

      } catch (error) {
        console.error('Create room error:', error.message);
        callback({ success: false, error: error.message });
      }
    });

    socket.on('join_room', async (data, callback) => {
      try {
        roomManager.validateEventData('join_room', data);
        validateInput('nickname', data);

        const { roomCode, nickname } = data;
        const ipAddress = socket.handshake.address;
        const playerId = uuidv4();

        if (!roomCode || roomCode.length !== 6) {
          return callback({ success: false, error: 'Invalid room code' });
        }

        const roomExists = await roomManager.roomExists(roomCode.toUpperCase());
        if (!roomExists) {
          return callback({ success: false, error: 'Room not found' });
        }

        const { room, role } = await roomManager.addPlayer(
          roomCode.toUpperCase(),
          playerId,
          nickname.trim().substring(0, CONSTANTS.MAX_NICKNAME_LENGTH),
          ipAddress
        );

        socket.join(room.roomCode);
        socket.playerId = playerId;
        socket.roomCode = room.roomCode;
        socket.nickname = nickname.trim().substring(0, CONSTANTS.MAX_NICKNAME_LENGTH);

        if (role === 'PLAYER') {
          room.players[playerId].socketId = socket.id;
          await roomManager.updateRoom(room.roomCode, room);
        }

        // Mid-game join (Spectator Sync)
        if (role === 'SPECTATOR' && (room.status === 'PLAYING' || room.status === 'COUNTDOWN')) {
          socket.emit('sync_game_state', {
            status: room.status,
            gameStartedAt: room.gameStartedAt,
            settings: room.settings,
            sentences: room.sentences || []
          });

          Object.keys(room.players).forEach(pId => {
            const p = room.players[pId];
            socket.emit('player_progress', {
              playerId: pId,
              charIndex: p.currentCharIndex || 0,
              sentenceIndex: p.currentSentenceIndex || 0,
              currentWordIndex: p.currentWordIndex || 0,
              currentCharInWord: p.currentCharInWord || 0,
              completedSentences: p.completedSentences || 0,
              totalCorrectChars: p.totalCorrectChars || 0,
              totalTypedChars: p.totalTypedChars || 0,
              totalMistypes: p.totalMistypes || 0,
              wpm: p.averageWPM || 0,
              status: p.status || 'ALIVE',
              sentenceStartTime: p.sentenceStartTime,
              mistakeStrikes: p.mistakeStrikes || 0,
              rouletteOdds: p.rouletteOdds || 6
            });
          });
        }

        socket.to(room.roomCode).emit('player_joined', {
          playerId: playerId,
          nickname: nickname.trim().substring(0, CONSTANTS.MAX_NICKNAME_LENGTH),
          role: role,
          updatedPlayers: Object.values(room.players)
        });

        console.log(`Player joined: ${nickname} -> ${room.roomCode} (${role})`);

        callback({ 
          success: true, 
          playerId: playerId,
          room: room,
          role: role,
          sentences: room.sentences || []
        });

      } catch (error) {
        console.error('Join room error:', error.message);
        callback({ success: false, error: error.message });
      }
    });

    socket.on('leave_room', async (data, callback) => {
      try {
        validateInput('roomCode', data);
        const { roomCode } = data;
        const playerId = socket.playerId;
        
        if (!playerId) {
          return callback?.({ success: false, error: 'Not in a room' });
        }

        cleanupDisconnectTimer(playerId);
        playerEventQueues.delete(playerId);

        const result = await roomManager.removePlayer(roomCode, playerId);

        if (result && !result.deleted && result.room) {
          socket.to(roomCode).emit('player_left', {
            playerId,
            updatedPlayers: Object.values(result.room.players),
            newHostId: result.room.hostId
          });
        }
        
        socket.leave(roomCode);
        delete socket.playerId;
        delete socket.roomCode;

        callback?.({ success: true });

      } catch (error) {
        console.error('Leave room error:', error.message);
        callback?.({ success: false, error: error.message });
      }
    });

    socket.on('change_settings', async (data, callback) => {
      try {
        validateInput('roomCode', data);
        const { roomCode, sentenceCount } = data;
        const playerId = socket.playerId;

        const room = await roomManager.getRoom(roomCode);
        if (!room) return callback({ success: false, error: 'Room not found' });
        if (room.hostId !== playerId) return callback({ success: false, error: 'Only host can change settings' });

        if (sentenceCount < 5 || sentenceCount > 100 || sentenceCount % 5 !== 0) {
          return callback({ success: false, error: 'Invalid sentence count' });
        }

        room.settings.sentenceCount = sentenceCount;
        await roomManager.updateRoom(roomCode, room);

        io.to(roomCode).emit('settings_updated', { sentenceCount });
        callback({ success: true });

      } catch (error) {
        console.error('Change settings error:', error.message);
        callback({ success: false, error: error.message });
      }
    });

    // --- GAME CONTROL EVENTS ---

    socket.on('start_game', async (data, callback) => {
      try {
        validateInput('roomCode', data);
        const { roomCode } = data;
        const playerId = socket.playerId;

        const room = await roomManager.getRoom(roomCode);
        if (!room) return callback({ success: false, error: 'Room not found' });
        if (room.hostId !== playerId) return callback({ success: false, error: 'Only host can start game' });

        const playerCount = Object.keys(room.players).length;
        if (playerCount < 1) return callback({ success: false, error: 'Need at least 1 player' });

        // Ensure no previous countdowns are running
        cleanupRoomTimer(roomCode);

        room.status = 'COUNTDOWN';
        
        const sentences = await sentenceService.selectSentences(room.settings.sentenceCount);
        room.sentences = sentences;

        // Reset all player stats for fresh game
        Object.keys(room.players).forEach(pId => {
          const player = room.players[pId];
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
        });

        await roomManager.updateRoom(roomCode, room);

        const countdownStartTime = Date.now();
        io.to(roomCode).emit('countdown_start', {
          sentences: sentences,
          startTime: countdownStartTime,
          duration: CONSTANTS.COUNTDOWN_DURATION
        });

        console.log(`Game starting: ${roomCode} (${playerCount} players)`);

        // Start game after delay
        const timerId = setTimeout(async () => {
          try {
            const updatedRoom = await roomManager.getRoom(roomCode);
            // Verify room is still in countdown (hasn't been reset/deleted)
            if (updatedRoom && updatedRoom.status === 'COUNTDOWN') {
              updatedRoom.status = 'PLAYING';
              updatedRoom.gameStartedAt = Date.now();
              
              const gameStartTime = Date.now();
              Object.keys(updatedRoom.players).forEach(pId => {
                updatedRoom.players[pId].sentenceStartTime = gameStartTime;
              });
              
              await roomManager.updateRoom(roomCode, updatedRoom);

              io.to(roomCode).emit('game_start', {
                firstSentence: sentences[0],
                gameStartTime: gameStartTime
              });

              console.log(`Game started: ${roomCode}`);
            }
          } catch (err) {
            console.error(`Error starting game for room ${roomCode}:`, err);
          } finally {
            roomCountdownTimers.delete(roomCode);
          }
        }, CONSTANTS.COUNTDOWN_DURATION);

        roomCountdownTimers.set(roomCode, timerId);

        callback({ success: true });

      } catch (error) {
        console.error('Start game error:', error.message);
        callback({ success: false, error: error.message });
      }
    });

    socket.on('force_reset_game', async (data, callback) => {
      try {
        validateInput('roomCode', data);
        const { roomCode } = data;
        const playerId = socket.playerId;

        const room = await roomManager.getRoom(roomCode);
        if (!room) return callback({ success: false, error: 'Room not found' });
        if (room.hostId !== playerId) return callback({ success: false, error: 'Only host can reset game' });

        console.log(`FORCE RESET: Host ${playerId} resetting room ${roomCode}`);
        
        cleanupRoomTimer(roomCode);

        // Recover spectators to player list
        const spectatorSocketMap = new Map();
        const roomSockets = await io.in(roomCode).fetchSockets();
        
        for (const sock of roomSockets) {
          const sockPlayerId = sock.playerId || sock.data?.playerId;
          if (sockPlayerId && room.spectators?.includes(sockPlayerId)) {
            spectatorSocketMap.set(sockPlayerId, sock);
          }
        }

        if (room.spectators && room.spectators.length > 0) {
          for (const spectatorId of room.spectators) {
            if (!room.players[spectatorId]) {
              const spectatorSocket = spectatorSocketMap.get(spectatorId);
              if (spectatorSocket) {
                const nickname = spectatorSocket.nickname || spectatorSocket.data?.nickname || 'SPECTATOR';
                room.players[spectatorId] = {
                  id: spectatorId,
                  nickname: nickname,
                  isGuest: true,
                  socketId: spectatorSocket.id,
                  ipAddress: spectatorSocket.handshake.address,
                  status: 'ALIVE',
                  currentSentenceIndex: 0,
                  rouletteOdds: 6,
                  mistakeStrikes: 0,
                  completedSentences: 0,
                  totalCorrectChars: 0,
                  totalTypedChars: 0,
                  totalMistypes: 0,
                  currentCharIndex: 0,
                  currentWordIndex: 0,
                  currentCharInWord: 0,
                  sentenceStartTime: null,
                  remainingTime: CONSTANTS.GAME_DURATION_TIMEOUT,
                  rouletteHistory: [],
                  sentenceHistory: [],
                  averageWPM: 0,
                  peakWPM: 0,
                  currentSessionWPM: 0
                };
              }
            }
          }
        }

        room.status = 'LOBBY';
        room.sentences = [];
        room.gameStartedAt = null;
        room.spectators = [];

        Object.keys(room.players).forEach(pId => {
          const p = room.players[pId];
          p.status = 'ALIVE';
          p.currentSentenceIndex = 0;
          p.rouletteOdds = 6;
          p.mistakeStrikes = 0;
          p.completedSentences = 0;
          p.totalCorrectChars = 0;
          p.totalTypedChars = 0;
          p.totalMistypes = 0;
          p.currentCharIndex = 0;
          p.currentWordIndex = 0;
          p.currentCharInWord = 0;
          p.sentenceStartTime = null;
          p.rouletteHistory = [];
          p.sentenceHistory = [];
          p.averageWPM = 0;
          p.peakWPM = 0;
          p.currentSessionWPM = 0;
        });

        await roomManager.updateRoom(roomCode, room);

        io.to(roomCode).emit('game_force_reset', { room: room });
        console.log(`Room ${roomCode} reset to lobby`);
        callback({ success: true });

      } catch (error) {
        console.error('Force reset error:', error.message);
        callback({ success: false, error: error.message });
      }
    });

    // --- GAMEPLAY EVENTS (QUEUED) ---

    socket.on('char_typed', async (data) => {
      try {
        const playerId = socket.playerId;
        if (!playerId) return;
        if (!roomManager.checkEventRateLimit(playerId)) return;
        
        roomManager.validateEventData('char_typed', data);
        validateInput('charIndex', data);
        validateInput('roomCode', data); 

        // Add to queue to ensure serial processing against mistypes
        await queuePlayerEvent(playerId, () => processCharTypedEvent(io, socket, data));

      } catch (error) {
        console.error('Char typed error:', error.message);
        socket.emit('event_error', { event: 'char_typed', error: error.message });
      }
    });

    socket.on('mistype', async (data) => {
      try {
        const playerId = socket.playerId;
        if (!playerId) return;
        if (!roomManager.checkEventRateLimit(playerId)) return;
        
        roomManager.validateEventData('mistype', data);
        validateInput('roomCode', data);
        validateInput('sentenceIndex', data);
        
        // Add to queue
        await queuePlayerEvent(playerId, () => processMistypeEvent(io, socket, data));

      } catch (error) {
        console.error('Mistype error:', error.message);
        socket.emit('event_error', { event: 'mistype', error: error.message });
      }
    });

    socket.on('sentence_timeout', async (data) => {
      try {
        const playerId = socket.playerId;
        if (!playerId) return;
        if (!roomManager.checkEventRateLimit(playerId)) return;
        
        roomManager.validateEventData('sentence_timeout', data);
        validateInput('roomCode', data);
        validateInput('sentenceIndex', data);
        
        // Add to queue
        await queuePlayerEvent(playerId, () => processTimeoutEvent(io, socket, data));

      } catch (error) {
        console.error('Timeout error:', error.message);
        socket.emit('event_error', { event: 'sentence_timeout', error: error.message });
      }
    });

    // --- REPLAY & RECONNECT EVENTS ---

    socket.on('request_replay', async (data, callback) => {
      try {
        validateInput('roomCode', data);
        const { roomCode } = data;
        const playerId = socket.playerId;

        if (!playerId) return callback?.({ success: false, error: 'Not authenticated' });

        const room = await roomManager.getRoom(roomCode);
        if (!room) return callback?.({ success: false, error: 'Room not found' });
        if (room.hostId !== playerId) return callback?.({ success: false, error: 'Only host can request replay' });

        console.log(`REPLAY: Resetting room ${roomCode}`);
        
        cleanupRoomTimer(roomCode);

        // Clear queues/timers for all players
        Object.keys(room.players).forEach(pId => {
          cleanupDisconnectTimer(pId);
          playerEventQueues.delete(pId);
        });

        room.status = 'LOBBY';
        room.sentences = [];
        room.gameStartedAt = null;

        // Reset player states
        Object.keys(room.players).forEach(pId => {
          const p = room.players[pId];
          p.status = 'ALIVE';
          p.currentSentenceIndex = 0;
          p.rouletteOdds = 6;
          p.mistakeStrikes = 0;
          p.completedSentences = 0;
          p.totalCorrectChars = 0;
          p.totalTypedChars = 0;
          p.totalMistypes = 0;
          p.currentCharIndex = 0;
          p.currentWordIndex = 0;
          p.currentCharInWord = 0;
          p.sentenceStartTime = null;
          p.rouletteHistory = [];
          p.sentenceHistory = [];
          p.averageWPM = 0;
          p.peakWPM = 0;
          p.currentSessionWPM = 0;
        });

        await roomManager.updateRoom(roomCode, room);
        
        io.to(roomCode).emit('replay_started', { room });
        console.log(`Replay complete for room: ${roomCode}`);

        callback?.({ success: true });

      } catch (error) {
        console.error('Replay error:', error.message);
        callback?.({ success: false, error: error.message });
      }
    });

    socket.on('reconnect_attempt', async (data, callback) => {
      try {
        validateInput('roomCode', data);
        validateInput('playerId', data);
        
        const { roomCode, playerId } = data;

        const room = await roomManager.getRoom(roomCode);
        if (!room || !room.players[playerId]) {
          return callback({ success: false, error: 'Session expired or invalid' });
        }

        const player = room.players[playerId];
        
        if (player.status !== 'DISCONNECTED') {
          return callback({ success: false, error: 'Player is already active or dead' });
        }

        const timeSinceDisconnect = Date.now() - player.disconnectedAt;
        if (timeSinceDisconnect > CONSTANTS.DISCONNECT_GRACE_PERIOD) {
          await roomManager.removePlayer(roomCode, playerId);
          return callback({ success: false, error: 'Grace period expired' });
        }

        socket.playerId = playerId;
        socket.roomCode = roomCode;
        socket.join(roomCode);

        const updatedRoom = await roomManager.reconnectPlayer(roomCode, playerId, socket.id);
        cleanupDisconnectTimer(playerId);

        socket.to(roomCode).emit('player_reconnected', {
          playerId: playerId,
          resumedState: updatedRoom.players[playerId]
        });

        console.log(`Player reconnected: ${playerId} to room ${roomCode}`);

        const reconnectedPlayer = updatedRoom.players[playerId];
        const isSpectator = updatedRoom.spectators?.includes(playerId) || 
                            reconnectedPlayer?.status === 'DEAD';

        if (updatedRoom.status === 'PLAYING' || updatedRoom.status === 'COUNTDOWN') {
          socket.emit('sync_game_state', {
            status: updatedRoom.status,
            gameStartedAt: updatedRoom.gameStartedAt,
            settings: updatedRoom.settings,
            sentences: updatedRoom.sentences || []
          });

          // Send current progress of all players to the reconnected user
          Object.keys(updatedRoom.players).forEach(pId => {
            const p = updatedRoom.players[pId];
            socket.emit('player_progress', {
              playerId: pId,
              charIndex: p.currentCharIndex || 0,
              sentenceIndex: p.currentSentenceIndex || 0,
              currentWordIndex: p.currentWordIndex || 0,
              currentCharInWord: p.currentCharInWord || 0,
              completedSentences: p.completedSentences || 0,
              totalCorrectChars: p.totalCorrectChars || 0,
              totalTypedChars: p.totalTypedChars || 0,
              totalMistypes: p.totalMistypes || 0,
              wpm: p.averageWPM || 0,
              status: p.status || 'ALIVE',
              sentenceStartTime: p.sentenceStartTime,
              mistakeStrikes: p.mistakeStrikes || 0,
              rouletteOdds: p.rouletteOdds || 6
            });
          });
        }

        callback({ 
          success: true, 
          room: updatedRoom,
          playerId: playerId,
          role: isSpectator ? 'SPECTATOR' : 'PLAYER'
        });

      } catch (error) {
        console.error('Reconnect error:', error.message);
        callback({ success: false, error: error.message });
      }
    });

    socket.on('disconnect', async () => {
      if (socket.roomCode && socket.playerId) {
        try {
          const room = await roomManager.getRoom(socket.roomCode);
          
          if (!room || !room.players[socket.playerId]) {
            console.log(`Player ${socket.playerId} disconnected but not in room anymore`);
            return;
          }

          if (room.players[socket.playerId].status === 'ALIVE') {
            // Mark as disconnected to allow grace period
            room.players[socket.playerId].status = 'DISCONNECTED';
            room.players[socket.playerId].disconnectedAt = Date.now();
            
            await roomManager.updateRoom(socket.roomCode, room);

            socket.to(socket.roomCode).emit('player_disconnected', {
              playerId: socket.playerId,
              gracePeriodEnd: Date.now() + CONSTANTS.DISCONNECT_GRACE_PERIOD,
              updatedPlayers: Object.values(room.players)
            });

            const timeoutId = setTimeout(async () => {
              try {
                const freshRoom = await roomManager.getRoom(socket.roomCode);
                if (freshRoom && freshRoom.players[socket.playerId]?.status === 'DISCONNECTED') {
                  console.log(`Grace period expired for ${socket.playerId}`);
                  
                  // Clean up queues
                  playerEventQueues.delete(socket.playerId);
                  
                  // Remove player permanently
                  const result = await roomManager.removePlayer(socket.roomCode, socket.playerId);
                  if (result && !result.deleted && result.room) {
                    io.to(socket.roomCode).emit('player_left', { 
                      playerId: socket.playerId,
                      updatedPlayers: Object.values(result.room.players),
                      newHostId: result.room.hostId
                    });
                  }
                }
              } catch (err) {
                console.error(`Error handling disconnect timeout for ${socket.playerId}:`, err);
              } finally {
                disconnectTimers.delete(socket.playerId);
              }
            }, CONSTANTS.DISCONNECT_GRACE_PERIOD);
            
            disconnectTimers.set(socket.playerId, timeoutId);
          } else {
            // If spectator or already dead, clean up immediately
            cleanupDisconnectTimer(socket.playerId);
            playerEventQueues.delete(socket.playerId);
          }
        } catch (err) {
          console.error(`Error in disconnect handler for ${socket.playerId}:`, err);
        }
      }
    });

    socket.on('heartbeat', () => {
      socket.emit('heartbeat_ack');
    });
  });

  return io;
}