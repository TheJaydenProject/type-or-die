import crypto from 'crypto';
import redis from '../config/redis.js';
import luaScripts from '../utils/luaScripts.js';
import { RoomState, PlayerState } from '@typeordie/shared';

interface RateLimitData {
  count: number;
  resetTime: number;
}

class RoomManager {
  private ROOM_PREFIX = 'room:';
  private IP_PREFIX = 'ip:';
  private LOCK_PREFIX = 'lock:room:';
  private GLOBAL_ROOM_COUNT = 'global:room_count';
  
  private MAX_ROOMS_PER_IP = parseInt(process.env.MAX_ROOMS_PER_IP || '4');
  private MAX_GLOBAL_ROOMS = parseInt(process.env.MAX_GLOBAL_ROOMS || '200');
  private ROOM_TTL = parseInt(process.env.ROOM_TTL_SECONDS || '86400');
  
  private LOCK_TTL = 5;
  private LOCK_RETRY_ATTEMPTS = 3;
  private LOCK_RETRY_DELAY = 50;
  
  private MAX_PLAYERS_PER_ROOM = 16;
  private EVENT_RATE_LIMIT = 100;
  
  private playerEventCounts = new Map<string, RateLimitData>();
  
  constructor() {
    setInterval(() => this.cleanupRateLimitData(), 60000);
    setInterval(() => this.cleanupInactiveRooms(), 300000);
  }

  // ... [Locking methods] ...
  async acquireLock(roomCode: string): Promise<string> {
    const lockKey = `${this.LOCK_PREFIX}${roomCode}`;
    const lockValue = crypto.randomBytes(16).toString('hex');

    for (let attempt = 0; attempt < this.LOCK_RETRY_ATTEMPTS; attempt++) {
      const acquired = await redis.set(lockKey, lockValue, 'EX', this.LOCK_TTL, 'NX');
      if (acquired === 'OK') {
        return lockValue;
      }
      await new Promise(resolve => setTimeout(resolve, this.LOCK_RETRY_DELAY));
    }

    throw new Error(`Failed to acquire lock for room ${roomCode}`);
  }

  async releaseLock(roomCode: string, lockValue: string): Promise<void> {
    const lockKey = `${this.LOCK_PREFIX}${roomCode}`;
    try {
      await redis.eval(
        luaScripts.getScript('releaseLock'),
        1,
        lockKey,
        lockValue
      );
    } catch (err: any) {
      console.error(`Lock release failed for ${roomCode}:`, err.message);
    }
  }

  async withLock<T>(roomCode: string, operation: () => Promise<T>): Promise<T> {
    const lockValue = await this.acquireLock(roomCode);
    try {
      return await operation();
    } finally {
      await this.releaseLock(roomCode, lockValue);
    }
  }

  generateRoomCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }

  hashIP(ip: string): string {
    if (!ip) return 'unknown';
    return crypto.createHash('sha256').update(ip).digest('hex');
  }

  // ... [Rate limiting & Validation] ...
  checkEventRateLimit(playerId: string): boolean {
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

  cleanupRateLimitData(): void {
    const now = Date.now();
    for (const [playerId, data] of this.playerEventCounts.entries()) {
      if (now > data.resetTime + 60000) {
        this.playerEventCounts.delete(playerId);
      }
    }
  }

  sanitizeNickname(nickname: string): string {
    if (!nickname || typeof nickname !== 'string') return 'GUEST';
    return nickname.trim().replace(/[<>"'&]/g, '').replace(/\s+/g, ' ').substring(0, 20);
  }

  validateEventData(eventName: string, data: any): boolean {
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

  // --- IP TRACKING ---

  async registerRoomCreation(hashedIP: string, roomCode: string): Promise<boolean> {
    const ipRoomsKey = `${this.IP_PREFIX}${hashedIP}:rooms`;

    try {
      const result = await redis.eval(
        luaScripts.getScript('registerRoomCreation'),
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
    } catch (err: any) {
      console.error('Redis Lua error (registerRoomCreation):', err.message);
      throw err;
    }
  }

  async unregisterRoomCreation(hashedIP: string, roomCode: string): Promise<number> {
    const ipRoomsKey = `${this.IP_PREFIX}${hashedIP}:rooms`;

    try {
      const removed = await redis.eval(
        luaScripts.getScript('unregisterRoomCreation'),
        1,
        ipRoomsKey,
        roomCode,
        this.ROOM_TTL
      );
      
      if (removed === 0) {
        console.warn(`Room ${roomCode} not found in IP tracking for ${hashedIP}`);
      }
      return removed as number;
    } catch (err: any) {
      console.error(`Failed to unregister room ${roomCode} from IP ${hashedIP}:`, err.message);
      return 0;
    }
  }

  // --- ROOM LIFECYCLE ---

  async canCreateRoom(ipAddress: string): Promise<{ allowed: boolean; reason?: string }> {
    const globalCount = await redis.get(this.GLOBAL_ROOM_COUNT);
    if (globalCount && parseInt(globalCount) >= this.MAX_GLOBAL_ROOMS) {
      return { allowed: false, reason: `Server full (${this.MAX_GLOBAL_ROOMS} rooms). Retry later.` };
    }

    const hashedIP = this.hashIP(ipAddress);
    const ipRoomsKey = `${this.IP_PREFIX}${hashedIP}:rooms`;
    const ipRooms = await redis.get(ipRoomsKey);
    if (ipRooms && JSON.parse(ipRooms).length >= this.MAX_ROOMS_PER_IP) {
      return { allowed: false, reason: `Limit reached: ${this.MAX_ROOMS_PER_IP} active rooms per IP.` };
    }

    return { allowed: true };
  }

  async createRoom(hostId: string, nickname: string, settings: any, ipAddress: string): Promise<RoomState> {
    const hashedIP = this.hashIP(ipAddress);
    
    let roomCode = '';
    let registered = false;
    let attempts = 0;

    do {
      roomCode = this.generateRoomCode();
      attempts++;
      if (attempts > 10) throw new Error('Failed to generate unique room code');
    } while (await this.roomExists(roomCode));

    registered = await this.registerRoomCreation(hashedIP, roomCode);
    
    if (!registered) {
      throw new Error(`Limit reached: ${this.MAX_ROOMS_PER_IP} active rooms per IP.`);
    }

    const sanitizedNickname = this.sanitizeNickname(nickname);
    const room: RoomState = {
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
          rouletteHistory: [],
          sentenceHistory: [],
          averageWPM: 0,
          peakWPM: 0,
          currentSessionWPM: 0,
          sentenceCharCount: 0,
          gracePeriodActive: false
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

  async roomExists(roomCode: string): Promise<boolean> {
    const room = await redis.get(`${this.ROOM_PREFIX}${roomCode}`);
    return room !== null;
  }

  async getRoom(roomCode: string): Promise<RoomState | null> {
    const roomData = await redis.get(`${this.ROOM_PREFIX}${roomCode}`);
    if (!roomData) return null;
    try {
      return JSON.parse(roomData);
    } catch (err: any) {
      console.error(`Failed to parse room ${roomCode}:`, err.message);
      return null;
    }
  }

  async updateRoom(roomCode: string, room: RoomState): Promise<void> {
    if (!room) throw new Error('Cannot update null room');
    room.lastActivity = Date.now();
    await redis.set(
      `${this.ROOM_PREFIX}${roomCode}`,
      JSON.stringify(room),
      'EX',
      this.ROOM_TTL
    );
  }

  async addPlayer(roomCode: string, playerId: string, nickname: string, ipAddress: string) {
    return this.withLock(roomCode, async () => {
      const room = await this.getRoom(roomCode);
      if (!room) throw new Error('Room not found');

      const hashedIP = this.hashIP(ipAddress);
      const sanitizedNickname = this.sanitizeNickname(nickname);

      if (room.status === 'PLAYING' || room.status === 'COUNTDOWN') {
        if (!Array.isArray(room.spectators)) room.spectators = [];
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
        rouletteHistory: [],
        sentenceHistory: [],
        averageWPM: 0,
        peakWPM: 0,
        currentSessionWPM: 0,
        sentenceCharCount: 0,
        gracePeriodActive: false
      };

      await this.updateRoom(roomCode, room);
      console.log(`Player joined: ${sanitizedNickname} -> ${roomCode}`);
      return { room, role: 'PLAYER' };
    });
  }

  async removePlayer(roomCode: string, playerId: string) {
    return this.withLock(roomCode, async () => {
      const room = await this.getRoom(roomCode);
      if (!room) return { deleted: true };

      console.log(`Removing player ${playerId} from room ${roomCode}`);
      this.playerEventCounts.delete(playerId);

      if (room.players && room.players[playerId]) {
        delete room.players[playerId];
      }
      
      if (!Array.isArray(room.spectators)) room.spectators = [];
      room.spectators = room.spectators.filter(id => id !== playerId);

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

  async reconnectPlayer(roomCode: string, playerId: string, newSocketId: string) {
    return this.withLock(roomCode, async () => {
      const room = await this.getRoom(roomCode);
      if (!room) throw new Error('Room not found');
      const player = room.players[playerId];
      if (!player) throw new Error('Player not found in room');
      player.status = 'ALIVE';
      player.socketId = newSocketId;
      player.disconnectedAt = null;
      await this.updateRoom(roomCode, room);
      return room;
    });
  }

  async deleteRoom(roomCode: string, knownCreatorIP: string | null = null): Promise<void> {
    console.log(`Deleting room ${roomCode}...`);
    let creatorIP = knownCreatorIP;
    
    if (!creatorIP) {
      const room = await this.getRoom(roomCode);
      if (room) {
        creatorIP = room.creatorIP;
        if (room.players) {
          Object.keys(room.players).forEach(pid => this.playerEventCounts.delete(pid));
        }
      }
    }

    const cleanupResults = await Promise.allSettled([
      creatorIP 
        ? this.unregisterRoomCreation(creatorIP, roomCode)
        : this.cleanupOrphanedIPTracking(roomCode),
      redis.decr(this.GLOBAL_ROOM_COUNT),
      redis.del(`${this.ROOM_PREFIX}${roomCode}`)
    ]);

    const [ipCleanup, countDecr, roomDeletion] = cleanupResults;
    
    if (roomDeletion.status === 'rejected') {
      console.error(`CRITICAL: Room key deletion failed for ${roomCode}:`, roomDeletion.reason);
    }
  }

  async forceDeleteRoom(roomCode: string): Promise<void> {
    await this.deleteRoom(roomCode);
  }

  async cleanupOrphanedIPTracking(roomCode: string): Promise<void> {
    try {
      const ipKeys = await redis.keys(`${this.IP_PREFIX}*:rooms`);
      for (const ipKey of ipKeys) {
        const rooms = await redis.get(ipKey);
        if (rooms && rooms.includes(roomCode)) {
           const roomList = JSON.parse(rooms).filter((r: string) => r !== roomCode);
           if (roomList.length > 0) {
             await redis.set(ipKey, JSON.stringify(roomList), 'EX', this.ROOM_TTL);
           } else {
             await redis.del(ipKey);
           }
           console.log(`Cleaned orphaned reference to ${roomCode} in ${ipKey}`);
        }
      }
    } catch (err: any) {
      console.error(`Failed to cleanup orphaned IP tracking:`, err.message);
    }
  }

  async cleanupInactiveRooms(): Promise<void> {
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
    } catch (error: any) {
      console.error('Cleanup error:', error.message);
    }
  }

  async getMetrics() {
    const [globalCount, keys] = await Promise.all([
      redis.get(this.GLOBAL_ROOM_COUNT),
      redis.keys(`${this.ROOM_PREFIX}*`)
    ]);

    return {
      activeRooms: globalCount ? parseInt(globalCount, 10) : 0,
      totalKeys: keys.length,
      memoryUsage: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2) + ' MB',
      uptime: Math.floor(process.uptime()) + 's'
    };
  }

  async atomicCharUpdate(roomCode: string, playerId: string, char: string, charIndex: number) {
    try {
      const result = await redis.eval(
        luaScripts.getScript('atomicCharUpdate'),
        1,
        `${this.ROOM_PREFIX}${roomCode}`,
        playerId,
        char,
        charIndex,
        Date.now(),
        this.ROOM_TTL
      );
      
      if (!result) return null;
      
      const parsed = JSON.parse(result as string);
      const room = await this.getRoom(roomCode);
      
      if (!room) return null;
      
      return {
        room,
        player: parsed.player,
        result: {
          type: parsed.type,
          wordIndex: parsed.wordIndex,
          charInWord: parsed.charInWord,
          ...parsed.extraData
        }
      };
    } catch (err: any) {
      console.error(`atomicCharUpdate failed for ${roomCode}:`, err.message);
      return null;
    }
  }
}

export default new RoomManager();