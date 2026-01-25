const crypto = require('crypto');
const redis = require('../config/redis');

class RoomManager {
  constructor() {
    this.ROOM_PREFIX = 'room:';
    this.IP_PREFIX = 'ip:';
    this.GLOBAL_ROOM_COUNT = 'global:room_count';
    this.MAX_ROOMS_PER_IP = 2;
    this.MAX_GLOBAL_ROOMS = 100;
    this.ROOM_TTL = 86400;
    
    this.MAX_PLAYERS_PER_ROOM = 16;
    this.EVENT_RATE_LIMIT = 100;
    this.playerEventCounts = new Map();
    
    setInterval(() => this.cleanupRateLimitData(), 60000);
  }

  generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }

  hashIP(ip) {
    return crypto.createHash('sha256').update(ip).digest('hex');
  }

  checkEventRateLimit(playerId) {
    if (!playerId) return false;
    
    const now = Date.now();
    const playerData = this.playerEventCounts.get(playerId);

    if (!playerData || now > playerData.resetTime) {
      this.playerEventCounts.set(playerId, {
        count: 1,
        resetTime: now + 1000
      });
      return true;
    }

    if (playerData.count >= this.EVENT_RATE_LIMIT) {
      console.warn(`Rate limit exceeded: ${playerId} (${playerData.count}/${this.EVENT_RATE_LIMIT})`);
      return false;
    }

    playerData.count++;
    return true;
  }

  cleanupRateLimitData() {
    const now = Date.now();
    for (const [playerId, data] of this.playerEventCounts.entries()) {
      if (now > data.resetTime + 60000) {
        this.playerEventCounts.delete(playerId);
      }
    }
  }

  sanitizeNickname(nickname) {
    if (!nickname || typeof nickname !== 'string') {
      return 'GUEST';
    }
    
    return nickname
      .trim()
      .replace(/[<>\"'&]/g, '')
      .replace(/\s+/g, ' ')
      .substring(0, 20);
  }

  validateEventData(eventName, data) {
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid event data');
    }

    const roomCodeRegex = /^[A-Z0-9]{6}$/;

    switch (eventName) {
      case 'char_typed':
        if (typeof data.char !== 'string' || data.char.length !== 1) {
          throw new Error('Invalid char');
        }
        if (typeof data.charIndex !== 'number' || data.charIndex < 0) {
          throw new Error('Invalid charIndex');
        }
        if (!roomCodeRegex.test(data.roomCode)) {
          throw new Error('Invalid roomCode');
        }
        break;

      case 'create_room':
        if (!data.nickname || typeof data.nickname !== 'string') {
          throw new Error('Invalid nickname');
        }
        if (!data.settings || typeof data.settings.sentenceCount !== 'number') {
          throw new Error('Invalid settings');
        }
        if (data.settings.sentenceCount < 5 || data.settings.sentenceCount > 100) {
          throw new Error('sentenceCount out of range');
        }
        break;

      case 'join_room':
        if (!roomCodeRegex.test(data.roomCode)) {
          throw new Error('Invalid roomCode format');
        }
        if (!data.nickname || typeof data.nickname !== 'string') {
          throw new Error('Invalid nickname');
        }
        break;

      case 'mistype':
      case 'sentence_timeout':
        if (!roomCodeRegex.test(data.roomCode)) {
          throw new Error('Invalid roomCode');
        }
        if (typeof data.sentenceIndex !== 'number' || data.sentenceIndex < 0) {
          throw new Error('Invalid sentenceIndex');
        }
        break;

      default:
        break;
    }

    return true;
  }

  async canCreateRoom(ipAddress) {
    const hashedIP = this.hashIP(ipAddress);
    
    const ipRoomsKey = `${this.IP_PREFIX}${hashedIP}:rooms`;
    const ipRooms = await redis.get(ipRoomsKey);
    const roomCount = ipRooms ? JSON.parse(ipRooms).length : 0;
    
    if (roomCount >= this.MAX_ROOMS_PER_IP) {
      return {
        allowed: false,
        reason: `You already have ${this.MAX_ROOMS_PER_IP} active rooms. Close one to create another.`
      };
    }
    
    const globalCount = await redis.get(this.GLOBAL_ROOM_COUNT);
    if (globalCount && parseInt(globalCount) >= this.MAX_GLOBAL_ROOMS) {
      return {
        allowed: false,
        reason: `Server at capacity (${this.MAX_GLOBAL_ROOMS}/${this.MAX_GLOBAL_ROOMS} rooms). Try again in a few minutes.`
      };
    }
    
    return { allowed: true };
  }

  async createRoom(hostId, nickname, settings, ipAddress) {
    const limitCheck = await this.canCreateRoom(ipAddress);
    if (!limitCheck.allowed) {
      throw new Error(limitCheck.reason);
    }

    let roomCode;
    let attempts = 0;
    do {
      roomCode = this.generateRoomCode();
      attempts++;
      if (attempts > 10) {
        throw new Error('Failed to generate unique room code');
      }
    } while (await this.roomExists(roomCode));

    const hashedIP = this.hashIP(ipAddress);
    const sanitizedNickname = this.sanitizeNickname(nickname);

    const room = {
      roomCode,
      hostId,
      creatorIP: hashedIP,
      status: 'LOBBY',
      settings: {
        sentenceCount: settings.sentenceCount || 50,
        timePerSentence: 20
      },
      players: {
        [hostId]: {
          id: hostId,
          nickname: sanitizedNickname,
          isGuest: true,
          socketId: null,
          ipAddress: hashedIP,
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
          remainingTime: 20,
          rouletteHistory: [],
          sentenceHistory: [],
          averageWPM: 0,
          peakWPM: 0,
          currentSessionWPM: 0
        }
      },
      spectators: [],
      sentences: [],
      createdAt: Date.now(),
      gameStartedAt: null,
      lastActivity: Date.now()
    };

    await redis.set(
      `${this.ROOM_PREFIX}${roomCode}`,
      JSON.stringify(room),
      'EX',
      this.ROOM_TTL
    );

    await this.registerRoomCreation(hashedIP, roomCode);

    console.log(`Room created: ${roomCode} by ${sanitizedNickname}`);
    
    return room;
  }

  async registerRoomCreation(hashedIP, roomCode) {
    const ipRoomsKey = `${this.IP_PREFIX}${hashedIP}:rooms`;
    
    const rooms = await redis.get(ipRoomsKey);
    const roomList = rooms ? JSON.parse(rooms) : [];
    roomList.push(roomCode);
    
    await redis.set(ipRoomsKey, JSON.stringify(roomList), 'EX', this.ROOM_TTL);
    await redis.incr(this.GLOBAL_ROOM_COUNT);
  }

  async roomExists(roomCode) {
    const room = await redis.get(`${this.ROOM_PREFIX}${roomCode}`);
    return room !== null;
  }

  async getRoom(roomCode) {
    const roomData = await redis.get(`${this.ROOM_PREFIX}${roomCode}`);
    if (!roomData) return null;
    return JSON.parse(roomData);
  }

  async updateRoom(roomCode, room) {
    room.lastActivity = Date.now();
    await redis.set(
      `${this.ROOM_PREFIX}${roomCode}`,
      JSON.stringify(room),
      'EX',
      this.ROOM_TTL
    );
  }

  async addPlayer(roomCode, playerId, nickname, ipAddress) {
    const room = await this.getRoom(roomCode);
    if (!room) {
      throw new Error('Room not found');
    }

    const playerCount = Object.keys(room.players).length;
    if (playerCount >= this.MAX_PLAYERS_PER_ROOM) {
      throw new Error(`Room full (${this.MAX_PLAYERS_PER_ROOM}/${this.MAX_PLAYERS_PER_ROOM} players)`);
    }

    const hashedIP = this.hashIP(ipAddress);
    const sanitizedNickname = this.sanitizeNickname(nickname);

    if (room.status === 'PLAYING' || room.status === 'COUNTDOWN') {
      room.spectators.push(playerId);
      await this.updateRoom(roomCode, room);
      return { room, role: 'SPECTATOR' };
    }

    room.players[playerId] = {
      id: playerId,
      nickname: sanitizedNickname,
      isGuest: true,
      socketId: null,
      ipAddress: hashedIP,
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
      remainingTime: 20,
      rouletteHistory: [],
      sentenceHistory: [],
      averageWPM: 0,
      peakWPM: 0,
      currentSessionWPM: 0
    };

    await this.updateRoom(roomCode, room);
    
    console.log(`Player joined: ${sanitizedNickname} → ${roomCode}`);
    
    return { room, role: 'PLAYER' };
  }

  async removePlayer(roomCode, playerId) {
    const room = await this.getRoom(roomCode);
    if (!room) return { deleted: true };

    console.log(`Removing player ${playerId} from room ${roomCode}`);

    this.playerEventCounts.delete(playerId);

    delete room.players[playerId];
    room.spectators = room.spectators.filter(id => id !== playerId);

    const remainingPlayers = Object.keys(room.players).length;
    const remainingSpectators = room.spectators.length;

    console.log(`  ↳ Players left: ${remainingPlayers}, Spectators: ${remainingSpectators}`);

    if (remainingPlayers === 0 && remainingSpectators === 0) {
      console.log(`  ↳ Room is empty, deleting...`);
      await this.deleteRoom(roomCode);
      return { deleted: true };
    }

    if (room.hostId === playerId) {
      const playerIds = Object.keys(room.players);
      if (playerIds.length > 0) {
        const oldHost = room.hostId;
        room.hostId = playerIds[0];
        console.log(`Host migrated: ${oldHost} → ${room.hostId} (${room.players[room.hostId].nickname})`);
      }
    }

    await this.updateRoom(roomCode, room);
    return { deleted: false, room };
  }

  async reconnectPlayer(roomCode, playerId, newSocketId) {
    const room = await this.getRoom(roomCode);
    if (!room) throw new Error('Room not found');

    const player = room.players[playerId];
    if (!player) throw new Error('Player not found in room');
    
    player.status = 'ALIVE';
    player.socketId = newSocketId;
    player.gracePeriodActive = false;
    player.disconnectedAt = null;

    await this.updateRoom(roomCode, room);
    return room;
  }

  async deleteRoom(roomCode) {
    const room = await this.getRoom(roomCode);
    if (!room) return;

    Object.keys(room.players).forEach(playerId => {
      this.playerEventCounts.delete(playerId);
    });

    const ipRoomsKey = `${this.IP_PREFIX}${room.creatorIP}:rooms`;
    const rooms = await redis.get(ipRoomsKey);
    if (rooms) {
      const roomList = JSON.parse(rooms).filter(r => r !== roomCode);
      if (roomList.length > 0) {
        await redis.set(ipRoomsKey, JSON.stringify(roomList), 'EX', this.ROOM_TTL);
      } else {
        await redis.del(ipRoomsKey);
      }
    }

    await redis.decr(this.GLOBAL_ROOM_COUNT);
    await redis.del(`${this.ROOM_PREFIX}${roomCode}`);
    
    console.log(`Room deleted: ${roomCode}`);
  }
}

module.exports = new RoomManager();