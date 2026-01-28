import crypto from 'crypto';
import roomManager from '../services/roomManager.js';
import { validateInput, CONSTANTS } from '../utils/socketValidation.js';
import { queuePlayerEvent, cleanupRoomTimer } from '../utils/playerStateHelpers.js';

async function checkGameOver(io, roomCode, room) {
  const alivePlayers = Object.values(room.players).filter(p => p.status === 'ALIVE');
  
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
    return true;
  }
  
  await roomManager.updateRoom(roomCode, room);
  return false;
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
      room.status = 'FINISHED';
      cleanupRoomTimer(roomCode);
      await roomManager.updateRoom(roomCode, room);

      io.to(roomCode).emit('game_ended', {
        reason: 'COMPLETION',
        winnerId: playerId,
        winnerNickname: player.nickname,
        finalStats: room.players
      });
    } else {
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

  if (player.mistakeStrikes >= 3) {
    player.mistakeStrikes = 0;
    const odds = player.rouletteOdds;
    const roll = crypto.randomInt(1, odds + 1);
    const survived = roll > 1;

    if (!Array.isArray(player.rouletteHistory)) player.rouletteHistory = [];

    player.rouletteHistory.push({
      sentenceIndex: sentenceIndex,
      odds: `1/${odds}`,
      survived: survived,
      roll: roll,
      timestamp: Date.now()
    });

    if (survived) {
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
      player.status = 'DEAD';
      if (!Array.isArray(player.sentenceHistory)) player.sentenceHistory = [];
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
  if (!Array.isArray(player.rouletteHistory)) player.rouletteHistory = [];
  
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
    
    await roomManager.updateRoom(roomCode, room);
  } else {
    player.status = 'DEAD';
    if (!Array.isArray(player.sentenceHistory)) player.sentenceHistory = [];
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

export function setupPlayerActionHandlers(io, socket) {
  
  socket.on('char_typed', async (data) => {
    try {
      const playerId = socket.playerId;
      if (!playerId) return;
      if (!roomManager.checkEventRateLimit(playerId)) return;
      
      roomManager.validateEventData('char_typed', data);
      validateInput('charIndex', data);
      validateInput('roomCode', data); 

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
      
      await queuePlayerEvent(playerId, () => processTimeoutEvent(io, socket, data));

    } catch (error) {
      console.error('Timeout error:', error.message);
      socket.emit('event_error', { event: 'sentence_timeout', error: error.message });
    }
  });
}
