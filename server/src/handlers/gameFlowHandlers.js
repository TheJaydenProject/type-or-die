import roomManager from '../services/roomManager.js';
import sentenceService from '../services/sentenceService.js';
import { validateInput, CONSTANTS } from '../utils/socketValidation.js';
import { 
  resetPlayerToLobbyState, 
  cleanupRoomTimer,
  roomCountdownTimers 
} from '../utils/playerStateHelpers.js';

export function setupGameFlowHandlers(io, socket) {
  
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

      cleanupRoomTimer(roomCode);

      room.status = 'COUNTDOWN';
      
      const sentences = await sentenceService.selectSentences(room.settings.sentenceCount);
      room.sentences = sentences;

      Object.keys(room.players).forEach(pId => {
        resetPlayerToLobbyState(room.players[pId]);
      });

      await roomManager.updateRoom(roomCode, room);

      const countdownStartTime = Date.now();
      io.to(roomCode).emit('countdown_start', {
        sentences: sentences,
        startTime: countdownStartTime,
        duration: CONSTANTS.COUNTDOWN_DURATION
      });

      console.log(`Game starting: ${roomCode} (${playerCount} players)`);

      const timerId = setTimeout(async () => {
        try {
          const updatedRoom = await roomManager.getRoom(roomCode);
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
        resetPlayerToLobbyState(room.players[pId]);
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

      const { cleanupDisconnectTimer, playerEventQueues } = await import('../utils/playerStateHelpers.js');
      Object.keys(room.players).forEach(pId => {
        cleanupDisconnectTimer(pId);
        playerEventQueues.delete(pId);
      });

      room.status = 'LOBBY';
      room.sentences = [];
      room.gameStartedAt = null;

      Object.keys(room.players).forEach(pId => {
        resetPlayerToLobbyState(room.players[pId]);
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
}
