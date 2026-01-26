const crypto = require('crypto');
const redis = require('../config/redis');

class RoomManager {
  constructor() {
    this.ROOM_PREFIX = 'room:';
    this.IP_PREFIX = 'ip:';
    this.LOCK_PREFIX = 'lock:room:';
    this.GLOBAL_ROOM_COUNT = 'global:room_count';
    this.MAX_ROOMS_PER_IP = 4;
    this.MAX_GLOBAL_ROOMS = 200;
    this.ROOM_TTL = 86400;
    this.LOCK_TTL = 5;
    this.LOCK_RETRY_ATTEMPTS = 3;
    this.LOCK_RETRY_DELAY = 50;
    
    this.MAX_PLAYERS_PER_ROOM = 16;
    this.EVENT_RATE_LIMIT = 100;
    this.playerEventCounts = new Map();
    
    setInterval(() => this.cleanupRateLimitData(), 60000);
    setInterval(() => this.cleanupInactiveRooms(), 300000);
  }

  async acquireLock(roomCode) {
    const lockKey = `${this.LOCK_PREFIX}${roomCode}`;
    const lockValue = crypto.randomBytes(16).toString('hex');

    for (let attempt = 0; attempt < this.LOCK_RETRY_ATTEMPTS; attempt++) {
      const acquired = await redis.set(lockKey, lockValue, 'EX', this.LOCK_TTL, 'NX');
      if (acquired === 'OK') {
        return lockValue;
      }
      await new Promise(resolve => setTimeout(resolve, this.LOCK_RETRY_DELAY));
    }

    throw new Error('Failed to acquire room lock');
  }

  async releaseLock(roomCode, lockValue) {
    const lockKey = `${this.LOCK_PREFIX}${roomCode}`;
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    
    try {
      await redis.eval(script, 1, lockKey, lockValue);
    } catch (err) {
      console.error(`Lock release failed for ${roomCode}:`, err.message);
    }
  }

  async withLock(roomCode, operation) {
    const lockValue = await this.acquireLock(roomCode);
    try {
      return await operation();
    } finally {
      await this.releaseLock(roomCode, lockValue);
    }
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

  async cleanupInactiveRooms() {
    try {
      const pattern = `${this.ROOM_PREFIX}*`;
      const keys = await redis.keys(pattern);
      const now = Date.now();
      const INACTIVE_THRESHOLD = 3600000;
      let cleaned = 0;

      for (const key of keys) {
        const roomData = await redis.get(key);
        if (!roomData) continue;

        const room = JSON.parse(roomData);
        const inactiveDuration = now - (room.lastActivity || room.createdAt);

        if (inactiveDuration > INACTIVE_THRESHOLD) {
          const roomCode = key.replace(this.ROOM_PREFIX, '');
          await this.deleteRoom(roomCode);
          cleaned++;
        }
      }

      if (cleaned > 0) {
        console.log(`Cleaned ${cleaned} inactive rooms`);
      }
    } catch (error) {
      console.error('Cleanup error:', error.message);
    }
  }

  async getMetrics() {
    const roomCount = await redis.get(this.GLOBAL_ROOM_COUNT) || 0;
    const pattern = `${this.ROOM_PREFIX}*`;
    const keys = await redis.keys(pattern);
    
    let totalPlayers = 0;
    let activeGames = 0;
    
    for (const key of keys) {
      const roomData = await redis.get(key);
      if (!roomData) continue;
      
      const room = JSON.parse(roomData);
      totalPlayers += Object.keys(room.players).length;
      if (room.status === 'PLAYING') activeGames++;
    }

    return {
      totalRooms: parseInt(roomCount),
      activeRooms: keys.length,
      totalPlayers,
      activeGames,
      rateLimitedPlayers: this.playerEventCounts.size,
      timestamp: Date.now()
    };
  }

  sanitizeNickname(nickname) {
    if (!nickname || typeof nickname !== 'string') {
      return 'GUEST';
    }
    
    return nickname
      .trim()
      .replace(/[<>"'&]/g, '')
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
    
    try {
      return JSON.parse(roomData);
    } catch (err) {
      console.error(`Failed to parse room ${roomCode}:`, err.message);
      return null;
    }
  }

  async updateRoom(roomCode, room) {
    if (!room) {
      throw new Error('Cannot update null room');
    }
    
    room.lastActivity = Date.now();
    await redis.set(
      `${this.ROOM_PREFIX}${roomCode}`,
      JSON.stringify(room),
      'EX',
      this.ROOM_TTL
    );
  }

  async addPlayer(roomCode, playerId, nickname, ipAddress) {
    return this.withLock(roomCode, async () => {
      const room = await this.getRoom(roomCode);
      if (!room) {
        throw new Error('Room not found');
      }

      const hashedIP = this.hashIP(ipAddress);
      const sanitizedNickname = this.sanitizeNickname(nickname);

      if (room.status === 'PLAYING' || room.status === 'COUNTDOWN') {
        room.spectators.push(playerId);
        await this.updateRoom(roomCode, room);
        return { room, role: 'SPECTATOR' };
      }

      const currentPlayerCount = Object.keys(room.players).length;
      if (currentPlayerCount >= this.MAX_PLAYERS_PER_ROOM) {
        throw new Error(
          `Room full (${currentPlayerCount}/${this.MAX_PLAYERS_PER_ROOM} players)`
        );
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
    });
  }

  async removePlayer(roomCode, playerId) {
    return this.withLock(roomCode, async () => {
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
    });
  }

  async reconnectPlayer(roomCode, playerId, newSocketId) {
    return this.withLock(roomCode, async () => {
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
    });
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
      try {
        const roomList = JSON.parse(rooms).filter(r => r !== roomCode);
        if (roomList.length > 0) {
          await redis.set(ipRoomsKey, JSON.stringify(roomList), 'EX', this.ROOM_TTL);
        } else {
          await redis.del(ipRoomsKey);
        }
      } catch (err) {
        console.error(`Failed to update IP rooms for ${room.creatorIP}:`, err.message);
      }
    }

    await redis.decr(this.GLOBAL_ROOM_COUNT);
    await redis.del(`${this.ROOM_PREFIX}${roomCode}`);
    
    console.log(`Room deleted: ${roomCode}`);
  }
}

module.exports = new RoomManager();