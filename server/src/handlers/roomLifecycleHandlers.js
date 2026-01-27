import { v4 as uuidv4 } from 'uuid';
import roomManager from '../services/roomManager.js';
import { validateInput, CONSTANTS } from '../utils/socketValidation.js';

export function setupRoomLifecycleHandlers(io, socket) {
  
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

      // FIX: Set socket properties BEFORE callback to prevent race condition
      socket.playerId = playerId;
      socket.roomCode = room.roomCode;
      socket.join(room.roomCode);
      
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

      // FIX: Set socket properties BEFORE callback to prevent race condition
      socket.playerId = playerId;
      socket.roomCode = room.roomCode;
      socket.nickname = nickname.trim().substring(0, CONSTANTS.MAX_NICKNAME_LENGTH);
      socket.join(room.roomCode);

      if (role === 'PLAYER') {
        room.players[playerId].socketId = socket.id;
        await roomManager.updateRoom(room.roomCode, room);
      }

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

      const { cleanupDisconnectTimer, playerEventQueues } = await import('../utils/playerStateHelpers.js');
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
}