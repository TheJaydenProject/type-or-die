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

        if (role === 'SPECTATOR' && (room.status === 'PLAYING' || room.status === 'COUNTDOWN')) {
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
              sentenceStartTime: p.sentenceStartTime
            });
          });

          if (room.sentences && room.sentences.length > 0) {
            socket.emit('sync_sentences', {
              sentences: room.sentences
            });
          }
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
          role: role,
          sentences: room.sentences || []
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

        if (sentenceCount < 5 || sentenceCount > 100 || sentenceCount % 5 !== 0) {
          return callback({ success: false, error: 'Invalid sentence count' });
        }

        room.settings.sentenceCount = sentenceCount;
        await roomManager.updateRoom(roomCode, room);

        io.to(roomCode).emit('settings_updated', {
          sentenceCount: sentenceCount
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
          duration: 3000
        });

        console.log(`Game starting: ${roomCode} (${playerCount} players, ${sentences.length} sentences)`);

        setTimeout(async () => {
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

          const words = currentSentence.split(' ');
          let charCount = 0;
          let wordIndex = 0;
          let charInWord = 0;
          
          for (let i = 0; i < words.length; i++) {
            if (charCount + words[i].length >= player.currentCharIndex) {
              wordIndex = i;
              charInWord = player.currentCharIndex - charCount;
              break;
            }
            charCount += words[i].length + 1;
          }
          
          player.currentWordIndex = wordIndex;
          player.currentCharInWord = charInWord;

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

            if (player.completedSentences === room.settings.sentenceCount) {
              room.status = 'FINISHED';
              await roomManager.updateRoom(roomCode, room);

              const sortedPlayers = Object.values(room.players).sort((a, b) => {
                if (b.completedSentences !== a.completedSentences) {
                  return b.completedSentences - a.completedSentences;
                }
                return b.totalCorrectChars - a.totalCorrectChars;
              });

              io.to(roomCode).emit('game_ended', {
                reason: 'COMPLETION',
                winnerId: playerId,
                winnerNickname: player.nickname,
                finalStats: room.players
              });
            } else {
              const newSentenceStartTime = Date.now();
              player.sentenceStartTime = newSentenceStartTime;
              player.currentWordIndex = 0;
              player.currentCharInWord = 0;

              await roomManager.updateRoom(roomCode, room);

              io.to(roomCode).emit('sentence_completed', {
                playerId: playerId,
                completedSentenceIndex: player.currentSentenceIndex - 1,
                newSentenceIndex: player.currentSentenceIndex,
                time: timeUsed,
                wpm: player.currentSessionWPM,
                sentenceStartTime: newSentenceStartTime,
                currentWordIndex: 0,
                currentCharInWord: 0,
                currentCharIndex: 0
              });

              io.to(roomCode).emit('player_progress', {
                playerId: playerId,
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
                sentenceStartTime: newSentenceStartTime
              });
            }
          } else {
            // Normal character typed (not sentence completion)
            await roomManager.updateRoom(roomCode, room);

            io.to(roomCode).emit('player_progress', {
              playerId: playerId,
              charIndex: player.currentCharIndex,
              sentenceIndex: player.currentSentenceIndex,
              currentWordIndex: wordIndex,
              currentCharInWord: charInWord,
              completedSentences: player.completedSentences,
              totalCorrectChars: player.totalCorrectChars,
              totalTypedChars: player.totalTypedChars,
              totalMistypes: player.totalMistypes,
              wpm: player.currentSessionWPM,
              status: player.status,
              sentenceStartTime: player.sentenceStartTime
            });
          }
        } else {
          player.totalMistypes++;
          await roomManager.updateRoom(roomCode, room);

          io.to(roomCode).emit('player_progress', {
            playerId: playerId,
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
        const resetStartTime = Date.now();
        player.sentenceStartTime = resetStartTime;

        io.to(roomCode).emit('player_strike', {
          playerId: playerId,
          strikes: player.mistakeStrikes,
          maxStrikes: 3,
          sentenceStartTime: resetStartTime
        });

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
            const rouletteResetTime = Date.now();
            player.sentenceStartTime = rouletteResetTime;

            io.to(roomCode).emit('roulette_result', {
              playerId: playerId,
              survived: true,
              newOdds: player.rouletteOdds,
              roll: roll,
              previousOdds: odds,
              sentenceStartTime: rouletteResetTime
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

              room.status = 'FINISHED';
              await roomManager.updateRoom(roomCode, room);

              io.to(roomCode).emit('game_ended', {
                reason: 'ALL_DEAD',
                winnerId: sortedPlayers[0].id,
                winnerNickname: sortedPlayers[0].nickname,
                finalStats: room.players
              });
              
              return;
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

            room.status = 'FINISHED';
            await roomManager.updateRoom(roomCode, room);

            io.to(roomCode).emit('game_ended', {
              winnerId: sortedPlayers[0].id,
              winnerNickname: sortedPlayers[0].nickname,
              finalStats: room.players,
              reason: 'ALL_DEAD'
            });
            
            return;
          }
        }

        await roomManager.updateRoom(roomCode, room);

      } catch (error) {
        console.error('Timeout error:', error.message);
      }
    });

    socket.on('request_replay', async (data) => {
      try {
        const { roomCode } = data;
        const playerId = socket.playerId;

        const room = await roomManager.getRoom(roomCode);
        if (!room) {
          console.error('Replay failed: Room not found');
          return;
        }

        if (room.hostId !== playerId) {
          console.error('Replay failed: Not host');
          return; 
        }

        console.log(`REPLAY: Resetting room ${roomCode}`);

        room.status = 'LOBBY';
        room.sentences = [];
        room.gameStartedAt = null;

        Object.keys(room.players).forEach(pId => {
          const p = room.players[pId];
          
          console.log(`  → Resetting ${p.nickname}: rouletteOdds ${p.rouletteOdds} → 6`);
          
          p.status = 'ALIVE';
          p.currentSentenceIndex = 0;
          p.rouletteOdds = 6;
          p.mistakeStrikes = 0;
          p.completedSentences = 0;
          p.totalCorrectChars = 0;
          p.totalTypedChars = 0;
          p.totalMistypes = 0;
          p.currentCharIndex = 0;
          p.sentenceStartTime = null;
          p.rouletteHistory = [];
          p.sentenceHistory = [];
          p.averageWPM = 0;
          p.peakWPM = 0;
          p.currentSessionWPM = 0;
        });

        await roomManager.updateRoom(roomCode, room);
        
        const verifyRoom = await roomManager.getRoom(roomCode);
        const verifyPlayer = Object.values(verifyRoom.players)[0];
        console.log(`  ✓ Verified: ${verifyPlayer.nickname} rouletteOdds = ${verifyPlayer.rouletteOdds}`);

        io.to(roomCode).emit('replay_started', {
          room: verifyRoom
        });

        console.log(`Replay complete for room: ${roomCode}`);

      } catch (error) {
        console.error('Replay error:', error.message);
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

        const reconnectedPlayer = updatedRoom.players[playerId];
        const isSpectator = updatedRoom.spectators?.includes(playerId) || 
                            reconnectedPlayer?.status === 'DEAD';

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
        const room = await roomManager.getRoom(socket.roomCode);
        
        if (!room || !room.players[socket.playerId]) {
          console.log(`Player ${socket.playerId} disconnected but not in room anymore`);
          return;
        }

        if (room.players[socket.playerId].status === 'ALIVE') {
          room.players[socket.playerId].status = 'DISCONNECTED';
          room.players[socket.playerId].disconnectedAt = Date.now();
          
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