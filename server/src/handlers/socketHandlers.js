const roomManager = require('../services/roomManager');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const disconnectTimers = new Map();

function setupSocketHandlers(io) {
  io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);

    socket.on('create_room', async (data, callback) => {
      try {
        const { nickname, settings } = data;
        const ipAddress = socket.handshake.address;
        const playerId = uuidv4();

        if (!nickname || nickname.trim().length === 0) {
          return callback({ success: false, error: 'Nickname is required' });
        }

        if (!settings || !settings.sentenceCount) {
          return callback({ success: false, error: 'Invalid settings' });
        }

        const room = await roomManager.createRoom(
          playerId,
          nickname.trim().substring(0, 20),
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
          room: room
        });

      } catch (error) {
        console.error('Create room error:', error.message);
        callback({ success: false, error: error.message });
      }
    });

    socket.on('join_room', async (data, callback) => {
      try {
        const { roomCode, nickname } = data;
        const ipAddress = socket.handshake.address;
        const playerId = uuidv4();

        if (!roomCode || roomCode.length !== 6) {
          return callback({ success: false, error: 'Invalid room code' });
        }

        if (!nickname || nickname.trim().length === 0) {
          return callback({ success: false, error: 'Nickname is required' });
        }

        const roomExists = await roomManager.roomExists(roomCode.toUpperCase());
        if (!roomExists) {
          return callback({ success: false, error: 'Room not found' });
        }

        const { room, role } = await roomManager.addPlayer(
          roomCode.toUpperCase(),
          playerId,
          nickname.trim().substring(0, 20),
          ipAddress
        );

        socket.join(room.roomCode);
        socket.playerId = playerId;
        socket.roomCode = room.roomCode;

        if (role === 'PLAYER') {
          room.players[playerId].socketId = socket.id;
          await roomManager.updateRoom(room.roomCode, room);
        }

        socket.to(room.roomCode).emit('player_joined', {
          playerId: playerId,
          nickname: nickname.trim().substring(0, 20),
          role: role,
          updatedPlayers: Object.values(room.players)
        });

        console.log(`Player joined: ${nickname} -> ${room.roomCode} (${role})`);

        callback({ 
          success: true, 
          playerId: playerId,
          room: room,
          role: role
        });

      } catch (error) {
        console.error('Join room error:', error.message);
        callback({ success: false, error: error.message });
      }
    });

    socket.on('leave_room', async (data) => {
      const { roomCode } = data;
      const playerId = socket.playerId;
      if (!roomCode || !playerId) return;

      if (disconnectTimers.has(playerId)) {
        clearTimeout(disconnectTimers.get(playerId));
        disconnectTimers.delete(playerId);
      }

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
    });

    socket.on('change_settings', async (data, callback) => {
      try {
        const { roomCode, sentenceCount } = data;
        const playerId = socket.playerId;

        const room = await roomManager.getRoom(roomCode);
        if (!room) {
          return callback({ success: false, error: 'Room not found' });
        }

        if (room.hostId !== playerId) {
          return callback({ success: false, error: 'Only host can change settings' });
        }

        if (sentenceCount < 10 || sentenceCount > 100 || sentenceCount % 10 !== 0) {
          return callback({ success: false, error: 'Invalid sentence count' });
        }

        room.settings.sentenceCount = sentenceCount;
        await roomManager.updateRoom(roomCode, room);

        io.to(roomCode).emit('settings_updated', {
          settings: room.settings
        });

        console.log(`Settings updated: ${roomCode} -> ${sentenceCount} sentences`);
        callback({ success: true });

      } catch (error) {
        console.error('Change settings error:', error.message);
        callback({ success: false, error: error.message });
      }
    });

    socket.on('start_game', async (data, callback) => {
      try {
        const { roomCode } = data;
        const playerId = socket.playerId;

        const room = await roomManager.getRoom(roomCode);
        if (!room) {
          return callback({ success: false, error: 'Room not found' });
        }

        if (room.hostId !== playerId) {
          return callback({ success: false, error: 'Only host can start game' });
        }

        const playerCount = Object.keys(room.players).length;
        if (playerCount < 1) {
          return callback({ success: false, error: 'Need at least 1 player' });
        }

        room.status = 'COUNTDOWN';
        await roomManager.updateRoom(roomCode, room);

        const sentenceService = require('../services/sentenceService');
        const sentences = await sentenceService.selectSentences(
          room.settings.sentenceCount
        );
        room.sentences = sentences;

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
          player.sentenceStartTime = null;
          player.remainingTime = 20;
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
          duration: 3000
        });

        console.log(`Game starting: ${roomCode} (${playerCount} players, ${sentences.length} sentences)`);

        setTimeout(async () => {
          const updatedRoom = await roomManager.getRoom(roomCode);
          if (updatedRoom && updatedRoom.status === 'COUNTDOWN') {
            updatedRoom.status = 'PLAYING';
            updatedRoom.gameStartedAt = Date.now();
            
            Object.keys(updatedRoom.players).forEach(pId => {
              updatedRoom.players[pId].sentenceStartTime = Date.now();
            });
            
            await roomManager.updateRoom(roomCode, updatedRoom);

            io.to(roomCode).emit('game_start', {
              firstSentence: sentences[0],
              gameStartTime: Date.now()
            });

            console.log(`Game started: ${roomCode}`);
          }
        }, 3000);

        callback({ success: true });

      } catch (error) {
        console.error('Start game error:', error.message);
        callback({ success: false, error: error.message });
      }
    });

    socket.on('char_typed', async (data) => {
      try {
        const { roomCode, char, charIndex } = data;
        const playerId = socket.playerId;

        const room = await roomManager.getRoom(roomCode);
        if (!room || room.status !== 'PLAYING') return;

        const player = room.players[playerId];
        if (!player || player.status !== 'ALIVE') return;

        const currentSentence = room.sentences[player.currentSentenceIndex];
        const expectedChar = currentSentence[charIndex];

        player.totalTypedChars++;

        if (char === expectedChar) {
          player.currentCharIndex++;
          player.totalCorrectChars++;

          const timeElapsed = (Date.now() - player.sentenceStartTime) / 1000 / 60;
          const charsTyped = player.currentCharIndex;
          player.currentSessionWPM = Math.round((charsTyped / 5) / timeElapsed);
          player.averageWPM = Math.round((player.totalCorrectChars / 5) / ((Date.now() - room.gameStartedAt) / 1000 / 60));

          if (player.currentCharIndex === currentSentence.length) {
            const timeUsed = (Date.now() - player.sentenceStartTime) / 1000;
            player.completedSentences++;
            player.currentSentenceIndex++;
            player.currentCharIndex = 0;

            player.sentenceHistory.push({
              sentenceIndex: player.currentSentenceIndex - 1,
              completed: true,
              timeUsed: timeUsed,
              accuracy: 100,
              wpm: player.currentSessionWPM
            });

            io.to(roomCode).emit('sentence_completed', {
              playerId: playerId,
              sentenceIndex: player.currentSentenceIndex - 1,
              time: timeUsed,
              wpm: player.currentSessionWPM
            });

            if (player.completedSentences === room.settings.sentenceCount) {
              io.to(roomCode).emit('game_ended', {
                winnerId: playerId,
                winnerNickname: player.nickname,
                finalStats: room.players
              });
              room.status = 'FINISHED';
            } else {
              player.sentenceStartTime = Date.now();
              player.remainingTime = 20;
            }
          }

          await roomManager.updateRoom(roomCode, room);

          io.to(roomCode).emit('player_progress', {
            playerId: playerId,
            charIndex: player.currentCharIndex,
            sentenceIndex: player.currentSentenceIndex,
            completedSentences: player.completedSentences,
            totalCorrectChars: player.totalCorrectChars,
            wpm: player.currentSessionWPM,
            status: player.status
          });
        } else {
          player.totalMistypes++;
          await roomManager.updateRoom(roomCode, room);
        }

      } catch (error) {
        console.error('Char typed error:', error.message);
      }
    });

    socket.on('mistype', async (data) => {
      try {
        const { roomCode, sentenceIndex } = data;
        const playerId = socket.playerId;

        const room = await roomManager.getRoom(roomCode);
        if (!room || room.status !== 'PLAYING') return;

        const player = room.players[playerId];
        if (!player || player.status !== 'ALIVE') return;

        player.mistakeStrikes = (player.mistakeStrikes || 0) + 1;
        player.totalMistypes++;

        console.log(`Strike: ${player.nickname} has ${player.mistakeStrikes}/3 strikes`);

        player.currentCharIndex = 0;
        player.sentenceStartTime = Date.now();
        player.remainingTime = 20;

        io.to(roomCode).emit('player_strike', {
          playerId: playerId,
          strikes: player.mistakeStrikes,
          maxStrikes: 3
        });

        // If 3 strikes, trigger roulette IMMEDIATELY (no delay)
        if (player.mistakeStrikes >= 3) {
          player.mistakeStrikes = 0;
          const odds = player.rouletteOdds;
          const roll = crypto.randomInt(1, odds + 1);
          const survived = roll > 1;

          console.log(`Roulette result: ${player.nickname} rolled ${roll}/${odds} - ${survived ? 'SURVIVED' : 'DIED'}`);

          player.rouletteHistory.push({
            sentenceIndex: sentenceIndex,
            odds: `1/${odds}`,
            survived: survived,
            roll: roll,
            timestamp: Date.now()
          });

          if (survived) {
            player.rouletteOdds = Math.max(2, odds - 1);
            player.currentCharIndex = 0;
            player.sentenceStartTime = Date.now();
            player.remainingTime = 20;

            io.to(roomCode).emit('roulette_result', {
              playerId: playerId,
              survived: true,
              newOdds: player.rouletteOdds,
              roll: roll,
              previousOdds: odds
            });
          } else {
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

            const alivePlayers = Object.values(room.players).filter(p => p.status === 'ALIVE');
            if (alivePlayers.length === 0) {
              const sortedPlayers = Object.values(room.players).sort((a, b) => {
                if (b.completedSentences !== a.completedSentences) {
                  return b.completedSentences - a.completedSentences;
                }
                return b.totalCorrectChars - a.totalCorrectChars;
              });

              io.to(roomCode).emit('game_ended', {
                winnerId: sortedPlayers[0].id,
                winnerNickname: sortedPlayers[0].nickname,
                finalStats: room.players,
                reason: 'ALL_DEAD'
              });
              room.status = 'FINISHED';
            }
          }
        }

        await roomManager.updateRoom(roomCode, room);

      } catch (error) {
        console.error('Mistype error:', error.message);
      }
    });

    socket.on('sentence_timeout', async (data) => {
      try {
        const { roomCode, sentenceIndex } = data;
        const playerId = socket.playerId;

        const room = await roomManager.getRoom(roomCode);
        if (!room || room.status !== 'PLAYING') return;

        const player = room.players[playerId];
        if (!player || player.status !== 'ALIVE') return;

        const odds = player.rouletteOdds;
        const roll = crypto.randomInt(1, odds + 1);
        const survived = roll > 1;
        
        console.log(`Timeout roulette: ${player.nickname} rolled ${roll}/${odds} - ${survived ? 'SURVIVED' : 'DIED'}`);

        player.rouletteHistory.push({
          sentenceIndex: sentenceIndex,
          odds: `1/${odds}`,
          survived: survived,
          roll: roll,
          timestamp: Date.now()
        });

        if (survived) {
          player.rouletteOdds = Math.max(2, odds - 1);
          player.currentCharIndex = 0;
          player.sentenceStartTime = Date.now();
          player.remainingTime = 20;

          io.to(roomCode).emit('roulette_result', {
            playerId: playerId,
            survived: true,
            newOdds: player.rouletteOdds,
            roll: roll,
            previousOdds: odds
          });
        } else {
          player.status = 'DEAD';
          
          player.sentenceHistory.push({
            sentenceIndex: sentenceIndex,
            completed: false,
            deathReason: 'TIMEOUT',
            timeUsed: 20
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

          const alivePlayers = Object.values(room.players).filter(p => p.status === 'ALIVE');
          if (alivePlayers.length === 0) {
            const sortedPlayers = Object.values(room.players).sort((a, b) => {
              if (b.completedSentences !== a.completedSentences) {
                return b.completedSentences - a.completedSentences;
              }
              return b.totalCorrectChars - a.totalCorrectChars;
            });

            io.to(roomCode).emit('game_ended', {
              winnerId: sortedPlayers[0].id,
              winnerNickname: sortedPlayers[0].nickname,
              finalStats: room.players,
              reason: 'ALL_DEAD'
            });
            room.status = 'FINISHED';
          }
        }

        await roomManager.updateRoom(roomCode, room);

      } catch (error) {
        console.error('Timeout error:', error.message);
      }
    });

    socket.on('reconnect_attempt', async (data, callback) => {
      try {
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
        if (timeSinceDisconnect > 30000) {
          await roomManager.removePlayer(roomCode, playerId);
          return callback({ success: false, error: 'Grace period expired' });
        }

        socket.playerId = playerId;
        socket.roomCode = roomCode;
        socket.join(roomCode);

        const updatedRoom = await roomManager.reconnectPlayer(roomCode, playerId, socket.id);

        socket.to(roomCode).emit('player_reconnected', {
          playerId: playerId,
          resumedState: updatedRoom.players[playerId]
        });

        console.log(`Player reconnected: ${playerId}`);

        callback({ 
          success: true, 
          room: updatedRoom,
          playerId: playerId
        });

      } catch (error) {
        console.error('Reconnect error:', error.message);
        callback({ success: false, error: error.message });
      }
    });

    socket.on('disconnect', async () => {
      if (socket.roomCode && socket.playerId) {
        const room = await roomManager.getRoom(socket.roomCode);
        
        if (!room || !room.players[socket.playerId]) {
          console.log(`Player ${socket.playerId} disconnected but not in room anymore`);
          return;
        }

        if (room.players[socket.playerId].status === 'ALIVE') {
          room.players[socket.playerId].status = 'DISCONNECTED';
          room.players[socket.playerId].disconnectedAt = Date.now();
          room.players[socket.playerId].pausedTime = room.players[socket.playerId].remainingTime; 
          
          await roomManager.updateRoom(socket.roomCode, room);

          socket.to(socket.roomCode).emit('player_disconnected', {
            playerId: socket.playerId,
            gracePeriodEnd: Date.now() + 30000,
            updatedPlayers: Object.values(room.players)
          });

          const timeoutId = setTimeout(async () => {
            const freshRoom = await roomManager.getRoom(socket.roomCode);
            if (freshRoom && freshRoom.players[socket.playerId]?.status === 'DISCONNECTED') {
              console.log(`Grace period expired for ${socket.playerId}`);
              const result = await roomManager.removePlayer(socket.roomCode, socket.playerId);
              if (result && !result.deleted && result.room) {
                io.to(socket.roomCode).emit('player_left', { 
                  playerId: socket.playerId,
                  updatedPlayers: Object.values(result.room.players),
                  newHostId: result.room.hostId
                });
              }
            }
            disconnectTimers.delete(socket.playerId);
          }, 30000);
          
          disconnectTimers.set(socket.playerId, timeoutId);
        }
      }
    });

    socket.on('heartbeat', () => {
      socket.emit('heartbeat_ack');
    });
  });
}

module.exports = setupSocketHandlers;