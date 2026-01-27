import roomManager from '../services/roomManager.js';
import { validateInput, CONSTANTS } from '../utils/socketValidation.js';
import { 
  cleanupDisconnectTimer, 
  disconnectTimers, 
  playerEventQueues 
} from '../utils/playerStateHelpers.js';

export function setupConnectionHandlers(io, socket) {
  
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

        const player = room.players[socket.playerId];
        const shouldUseGracePeriod = player.status === 'ALIVE' && 
                                      (room.status === 'PLAYING' || room.status === 'COUNTDOWN');

        if (shouldUseGracePeriod) {
          // Active player in ongoing game - use grace period for reconnection
          player.status = 'DISCONNECTED';
          player.disconnectedAt = Date.now();
          
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
                
                playerEventQueues.delete(socket.playerId);
                
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
          console.log(`Immediately removing ${socket.playerId} (status: ${player.status}, room: ${room.status})`);
          
          cleanupDisconnectTimer(socket.playerId);
          playerEventQueues.delete(socket.playerId);
          
          const result = await roomManager.removePlayer(socket.roomCode, socket.playerId);
          
          if (result && !result.deleted && result.room) {
            socket.to(socket.roomCode).emit('player_left', { 
              playerId: socket.playerId,
              updatedPlayers: Object.values(result.room.players),
              newHostId: result.room.hostId
            });
          } else if (result && result.deleted) {
            console.log(`Room ${socket.roomCode} deleted after last player left`);
          }
        }
      } catch (err) {
        console.error(`Error in disconnect handler for ${socket.playerId}:`, err);
      }
    }
  });

  socket.on('heartbeat', () => {
    socket.emit('heartbeat_ack');
  });
}