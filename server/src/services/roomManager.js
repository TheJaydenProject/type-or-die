import crypto from 'crypto';
import redis from '../config/redis.js';

class RoomManager {
  constructor() {
    this.ROOM_PREFIX = 'room:';
    this.IP_PREFIX = 'ip:';
    this.LOCK_PREFIX = 'lock:room:';
    this.GLOBAL_ROOM_COUNT = 'global:room_count';
    
    this.MAX_ROOMS_PER_IP = parseInt(process.env.MAX_ROOMS_PER_IP) || 4;
    this.MAX_GLOBAL_ROOMS = parseInt(process.env.MAX_GLOBAL_ROOMS) || 200;
    this.ROOM_TTL = parseInt(process.env.ROOM_TTL_SECONDS) || 86400;
    
    this.LOCK_TTL = 5;
    this.LOCK_RETRY_ATTEMPTS = 3;
    this.LOCK_RETRY_DELAY = 50;
    
    this.MAX_PLAYERS_PER_ROOM = 16;
    this.EVENT_RATE_LIMIT = 100;
    this.playerEventCounts = new Map();
    
    setInterval(() => this.cleanupRateLimitData(), 60000);
    setInterval(() => this.cleanupInactiveRooms(), 300000);
  }

  // ... [Locking methods] ...
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

    throw new Error(`Failed to acquire lock for room ${roomCode} after ${this.LOCK_RETRY_ATTEMPTS} attempts`);
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
    if (!ip) return 'unknown';
    return crypto.createHash('sha256').update(ip).digest('hex');
  }

  // ... [Rate limiting & Validation] ...
  checkEventRateLimit(playerId) {
    if (!playerId) return false;
    const now = Date.now();
    const playerData = this.playerEventCounts.get(playerId);
    if (!playerData || now > playerData.resetTime) {
      this.playerEventCounts.set(playerId, { count: 1, resetTime: now + 1000 });
      return true;
    }
    if (playerData.count >= this.EVENT_RATE_LIMIT) {
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
    if (!nickname || typeof nickname !== 'string') return 'GUEST';
    return nickname.trim().replace(/[<>"'&]/g, '').replace(/\s+/g, ' ').substring(0, 20);
  }

  validateEventData(eventName, data) {
    if (!data || typeof data !== 'object') throw new Error('Invalid event data structure');
    const roomCodeRegex = /^[A-Z0-9]{6}$/;
    
    switch (eventName) {
      case 'char_typed':
        if (typeof data.char !== 'string' || data.char.length !== 1) throw new Error('Invalid char');
        if (typeof data.charIndex !== 'number' || data.charIndex < 0) throw new Error('Invalid charIndex');
        if (!roomCodeRegex.test(data.roomCode)) throw new Error('Invalid roomCode');
        break;
      case 'create_room':
        if (!data.nickname || typeof data.nickname !== 'string') throw new Error('Invalid nickname');
        if (!data.settings || typeof data.settings.sentenceCount !== 'number') throw new Error('Invalid settings');
        if (data.settings.sentenceCount < 5 || data.settings.sentenceCount > 100) throw new Error('sentenceCount out of range (5-100)');
        break;
      case 'join_room':
        if (!roomCodeRegex.test(data.roomCode)) throw new Error('Invalid roomCode format');
        if (!data.nickname || typeof data.nickname !== 'string') throw new Error('Invalid nickname');
        break;
      case 'mistype':
      case 'sentence_timeout':
        if (!roomCodeRegex.test(data.roomCode)) throw new Error('Invalid roomCode');
        if (typeof data.sentenceIndex !== 'number' || data.sentenceIndex < 0) throw new Error('Invalid sentenceIndex');
        break;
    }
    return true;
  }

  // --- ATOMIC IP TRACKING (LUA SCRIPTS) ---

  async registerRoomCreation(hashedIP, roomCode) {
    const ipRoomsKey = `${this.IP_PREFIX}${hashedIP}:rooms`;
    
    // Lua: Check limit, push if allowed, expire
    const script = `
      local current = redis.call('get', KEYS[1])
      local rooms = {}
      if current then
        rooms = cjson.decode(current)
      end
      
      if #rooms >= tonumber(ARGV[1]) then
        return 0 -- Limit reached
      end
      
      table.insert(rooms, ARGV[2])
      redis.call('set', KEYS[1], cjson.encode(rooms), 'EX', ARGV[3])
      return 1 -- Success
    `;

    try {
      const result = await redis.eval(
        script, 
        1, 
        ipRoomsKey, 
        this.MAX_ROOMS_PER_IP, 
        roomCode, 
        this.ROOM_TTL
      );
      
      if (result === 1) {
        await redis.incr(this.GLOBAL_ROOM_COUNT);
        return true;
      }
      return false;
    } catch (err) {
      console.error('Redis Lua error (registerRoomCreation):', err.message);
      throw err;
    }
  }

  async unregisterRoomCreation(hashedIP, roomCode) {
    const ipRoomsKey = `${this.IP_PREFIX}${hashedIP}:rooms`;
    
    const script = `
      local current = redis.call('get', KEYS[1])
      if not current then return 0 end
      
      local rooms = cjson.decode(current)
      local new_rooms = {}
      local removed = 0
      
      for i, code in ipairs(rooms) do
        if code ~= ARGV[1] then
          table.insert(new_rooms, code)
        else
          removed = 1
        end
      end
      
      if #new_rooms == 0 then
        redis.call('del', KEYS[1])
      else
        redis.call('set', KEYS[1], cjson.encode(new_rooms), 'EX', ARGV[2])
      end
      
      return removed
    `;

    try {
      const removed = await redis.eval(script, 1, ipRoomsKey, roomCode, this.ROOM_TTL);
      if (removed === 0) {
        console.warn(`Room ${roomCode} not found in IP tracking for ${hashedIP}`);
      }
      return removed;
    } catch (err) {
      console.error(`Failed to unregister room ${roomCode} from IP ${hashedIP}:`, err.message);
      return 0;
    }
  }

  // --- ROOM LIFECYCLE ---

  async canCreateRoom(ipAddress) {
    const globalCount = await redis.get(this.GLOBAL_ROOM_COUNT);
    if (globalCount && parseInt(globalCount) >= this.MAX_GLOBAL_ROOMS) {
      return { allowed: false, reason: `Server full (${this.MAX_GLOBAL_ROOMS} rooms). Retry later.` };
    }

    // Optimization: Check non-atomically first to avoid Lua overhead if obviously full
    const hashedIP = this.hashIP(ipAddress);
    const ipRoomsKey = `${this.IP_PREFIX}${hashedIP}:rooms`;
    const ipRooms = await redis.get(ipRoomsKey);
    if (ipRooms && JSON.parse(ipRooms).length >= this.MAX_ROOMS_PER_IP) {
      return { allowed: false, reason: `Limit reached: ${this.MAX_ROOMS_PER_IP} active rooms per IP.` };
    }

    return { allowed: true };
  }

  async createRoom(hostId, nickname, settings, ipAddress) {
    const hashedIP = this.hashIP(ipAddress);
    
    let roomCode;
    let registered = false;
    let attempts = 0;

    do {
      roomCode = this.generateRoomCode();
      attempts++;
      if (attempts > 10) throw new Error('Failed to generate unique room code');
    } while (await this.roomExists(roomCode));

    // Atomic Registration
    registered = await this.registerRoomCreation(hashedIP, roomCode);
    
    if (!registered) {
      throw new Error(`Limit reached: ${this.MAX_ROOMS_PER_IP} active rooms per IP.`);
    }

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
          currentSessionWPM: 0,
          sentenceCharCount: 0
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

    console.log(`Room created: ${roomCode} by ${sanitizedNickname}`);
    return room;
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
    if (!room) throw new Error('Cannot update null room');
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
      if (!room) throw new Error('Room not found');

      const hashedIP = this.hashIP(ipAddress);
      const sanitizedNickname = this.sanitizeNickname(nickname);

      if (room.status === 'PLAYING' || room.status === 'COUNTDOWN') {
        if (!room.spectators) room.spectators = [];
        room.spectators.push(playerId);
        await this.updateRoom(roomCode, room);
        return { room, role: 'SPECTATOR' };
      }

      const currentPlayerCount = Object.keys(room.players || {}).length;
      if (currentPlayerCount >= this.MAX_PLAYERS_PER_ROOM) {
        throw new Error(`Room full (${currentPlayerCount}/${this.MAX_PLAYERS_PER_ROOM} players)`);
      }

      if (!room.players) room.players = {};
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
        currentSessionWPM: 0,
        sentenceCharCount: 0
      };

      await this.updateRoom(roomCode, room);
      console.log(`Player joined: ${sanitizedNickname} -> ${roomCode}`);
      return { room, role: 'PLAYER' };
    });
  }

  async removePlayer(roomCode, playerId) {
    return this.withLock(roomCode, async () => {
      const room = await this.getRoom(roomCode);
      if (!room) return { deleted: true };

      console.log(`Removing player ${playerId} from room ${roomCode}`);
      this.playerEventCounts.delete(playerId);

      if (room.players && room.players[playerId]) {
        delete room.players[playerId];
      }
      
      if (room.spectators) {
        room.spectators = room.spectators.filter(id => id !== playerId);
      }

      const remainingPlayers = Object.keys(room.players || {}).length;
      const remainingSpectators = (room.spectators || []).length;

      if (remainingPlayers === 0 && remainingSpectators === 0) {
        console.log(`  ↳ Room ${roomCode} is empty, deleting immediately...`);
        await this.deleteRoom(roomCode, room.creatorIP);
        return { deleted: true };
      }

      // Host migration logic...
      if (room.hostId === playerId) {
        const playerIds = Object.keys(room.players);
        if (playerIds.length > 0) {
          const oldHost = room.hostId;
          room.hostId = playerIds[0];
          console.log(`Host migrated: ${oldHost} -> ${room.hostId}`);
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


  async deleteRoom(roomCode, knownCreatorIP = null) {
    console.log(`Deleting room ${roomCode}...`);
    let creatorIP = knownCreatorIP;
    
    // Fetch IP if not provided
    if (!creatorIP) {
      const room = await this.getRoom(roomCode);
      if (room) {
        creatorIP = room.creatorIP;
        // Clean player event counts while we have the room
        if (room.players) {
          Object.keys(room.players).forEach(pid => this.playerEventCounts.delete(pid));
        }
      }
    }

    // Execute ALL cleanup operations in parallel with guaranteed completion
    const cleanupResults = await Promise.allSettled([
      // 1. IP tracking (atomic Lua script)
      creatorIP 
        ? this.unregisterRoomCreation(creatorIP, roomCode)
        : this.cleanupOrphanedIPTracking(roomCode),
      
      // 2. Global room count
      redis.decr(this.GLOBAL_ROOM_COUNT),
      
      // 3. Room key deletion (MUST succeed)
      redis.del(`${this.ROOM_PREFIX}${roomCode}`)
    ]);

    // Verify critical operations succeeded
    const [ipCleanup, countDecr, roomDeletion] = cleanupResults;
    
    if (roomDeletion.status === 'rejected') {
      console.error(`CRITICAL: Room key deletion failed for ${roomCode}:`, roomDeletion.reason);
    } else if (roomDeletion.value === 0) {
      console.warn(`Room key ${roomCode} was already missing`);
    }
    
    if (ipCleanup.status === 'rejected') {
      console.error(`IP cleanup failed for ${roomCode}:`, ipCleanup.reason);
    }
    
    if (countDecr.status === 'rejected') {
      console.error(`Global count decrement failed:`, countDecr.reason);
    }

    // Log success
    const failures = cleanupResults.filter(r => r.status === 'rejected').length;
    if (failures === 0) {
      console.log(`✓ Room ${roomCode} fully deleted (all 3 cleanups succeeded)`);
    } else {
      console.warn(`⚠ Room ${roomCode} deleted with ${failures} cleanup failures`);
    }
  }

  // Force delete bypassing locks (admin/cleanup)
  async forceDeleteRoom(roomCode) {
    await this.deleteRoom(roomCode);
  }

  async cleanupOrphanedIPTracking(roomCode) {
    try {
      const ipKeys = await redis.keys(`${this.IP_PREFIX}*:rooms`);
      for (const ipKey of ipKeys) {
        const rooms = await redis.get(ipKey);
        if (rooms && rooms.includes(roomCode)) {
           const roomList = JSON.parse(rooms).filter(r => r !== roomCode);
           if (roomList.length > 0) {
             await redis.set(ipKey, JSON.stringify(roomList), 'EX', this.ROOM_TTL);
           } else {
             await redis.del(ipKey);
           }
           console.log(`Cleaned orphaned reference to ${roomCode} in ${ipKey}`);
        }
      }
    } catch (err) {
      console.error(`Failed to cleanup orphaned IP tracking:`, err.message);
    }
  }

  async cleanupInactiveRooms() {
    try {
      const pattern = `${this.ROOM_PREFIX}*`;
      const keys = await redis.keys(pattern);
      const now = Date.now();
      const INACTIVE_THRESHOLD = 3600000; // 1 hour
      let cleaned = 0;

      for (const key of keys) {
        const roomData = await redis.get(key);
        if (!roomData) continue;
        try {
          const room = JSON.parse(roomData);
          const inactiveDuration = now - (room.lastActivity || room.createdAt);
          if (inactiveDuration > INACTIVE_THRESHOLD) {
            const roomCode = key.replace(this.ROOM_PREFIX, '');
            await this.deleteRoom(roomCode, room.creatorIP);
            cleaned++;
          }
        } catch (e) {
          await redis.del(key);
        }
      }
      if (cleaned > 0) console.log(`Cleaned ${cleaned} inactive rooms`);
    } catch (error) {
      console.error('Cleanup error:', error.message);
    }
  }

  async atomicCharUpdate(roomCode, playerId, char, charIndex) {
    return this.withLock(roomCode, async () => {
      const room = await this.getRoom(roomCode);
      if (!room || room.status !== 'PLAYING') return null;

      const player = room.players[playerId];
      if (!player || player.status !== 'ALIVE') return null;

      const currentSentence = room.sentences[player.currentSentenceIndex];
      const words = currentSentence.split(' ');
      const currentWord = words[player.currentWordIndex];
      const targetChar = currentWord[player.currentCharInWord];

      if (char === targetChar) {
        player.currentCharInWord++;
        player.currentCharIndex++;
        player.totalTypedChars++;
        player.totalCorrectChars++;
        
        if (!player.sentenceCharCount) player.sentenceCharCount = 0;
        player.sentenceCharCount++;

        if (room.gameStartedAt) {
          const totalMinutes = (Date.now() - room.gameStartedAt) / 1000 / 60;
          if (totalMinutes > 0) {
            player.averageWPM = Math.round((player.totalCorrectChars / 5) / totalMinutes);
          }
        }
        
        const timeElapsed = (Date.now() - player.sentenceStartTime) / 1000 / 60;
        if (timeElapsed > 0) {
          player.currentSessionWPM = Math.round((player.sentenceCharCount / 5) / timeElapsed);
        }

        let resultType = 'CORRECT';
        let extraData = {};

        if (player.currentCharInWord >= currentWord.length) {
          if (player.currentWordIndex >= words.length - 1) {
            resultType = 'SENTENCE_COMPLETE';
            player.completedSentences++;
            player.currentSentenceIndex++;
            player.currentWordIndex = 0;
            player.currentCharInWord = 0;
            player.currentCharIndex = 0;
            player.sentenceCharCount = 0;
            
            const now = Date.now();
            extraData.timeUsed = (now - player.sentenceStartTime) / 1000;
            player.sentenceStartTime = now;
            extraData.newSentenceStartTime = now;
            
            player.sentenceHistory.push({
              sentenceIndex: player.currentSentenceIndex - 1,
              completed: true,
              wpm: player.currentSessionWPM,
              timeUsed: extraData.timeUsed
            });
          } else {
            player.currentWordIndex++;
            player.currentCharInWord = 0;
          }
        }

        await this.updateRoom(roomCode, room);
        
        return {
          room,
          player,
          result: {
            type: resultType,
            wordIndex: player.currentWordIndex,
            charInWord: player.currentCharInWord,
            ...extraData
          }
        };
      }
      return null; 
    });
  }
}

export default new RoomManager();