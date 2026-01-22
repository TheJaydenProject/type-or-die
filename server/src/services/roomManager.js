// server/src/services/roomManager.js
const crypto = require('crypto');
const redis = require('../config/redis');

class RoomManager {
  constructor() {
    this.ROOM_PREFIX = 'room:';
    this.IP_PREFIX = 'ip:';
    this.GLOBAL_ROOM_COUNT = 'global:room_count';
    this.MAX_ROOMS_PER_IP = 2;
    this.MAX_GLOBAL_ROOMS = 100;
    this.ROOM_TTL = 86400; // 24 hours
  }

  // Generate unique 6-character room code
  generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed confusing chars (0,O,I,1)
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }

  // Hash IP address for privacy
  hashIP(ip) {
    return crypto.createHash('sha256').update(ip).digest('hex');
  }

  // Check if room creation is allowed
  async canCreateRoom(ipAddress) {
    const hashedIP = this.hashIP(ipAddress);
    
    // Check IP limit
    const ipRoomsKey = `${this.IP_PREFIX}${hashedIP}:rooms`;
    const ipRooms = await redis.get(ipRoomsKey);
    const roomCount = ipRooms ? JSON.parse(ipRooms).length : 0;
    
    if (roomCount >= this.MAX_ROOMS_PER_IP) {
      return {
        allowed: false,
        reason: `You already have ${this.MAX_ROOMS_PER_IP} active rooms. Close one to create another.`
      };
    }
    
    // Check global limit
    const globalCount = await redis.get(this.GLOBAL_ROOM_COUNT);
    if (globalCount && parseInt(globalCount) >= this.MAX_GLOBAL_ROOMS) {
      return {
        allowed: false,
        reason: `Server at capacity (${this.MAX_GLOBAL_ROOMS}/${this.MAX_GLOBAL_ROOMS} rooms). Try again in a few minutes.`
      };
    }
    
    return { allowed: true };
  }

  // Create a new room
  async createRoom(hostId, nickname, settings, ipAddress) {
    // Check limits
    const limitCheck = await this.canCreateRoom(ipAddress);
    if (!limitCheck.allowed) {
      throw new Error(limitCheck.reason);
    }

    // Generate unique room code
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

    // Create room object
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
          nickname,
          isGuest: true,
          socketId: null, // Will be set on socket connection
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

    // Save to Redis
    await redis.set(
      `${this.ROOM_PREFIX}${roomCode}`,
      JSON.stringify(room),
      'EX',
      this.ROOM_TTL
    );

    // Register room for IP tracking
    await this.registerRoomCreation(hashedIP, roomCode);

    console.log(`✅ Room created: ${roomCode} by ${nickname}`);
    
    return room;
  }

  // Register room creation for IP tracking
  async registerRoomCreation(hashedIP, roomCode) {
    const ipRoomsKey = `${this.IP_PREFIX}${hashedIP}:rooms`;
    
    const rooms = await redis.get(ipRoomsKey);
    const roomList = rooms ? JSON.parse(rooms) : [];
    roomList.push(roomCode);
    
    await redis.set(ipRoomsKey, JSON.stringify(roomList), 'EX', this.ROOM_TTL);
    await redis.incr(this.GLOBAL_ROOM_COUNT);
  }

  // Check if room exists
  async roomExists(roomCode) {
    const room = await redis.get(`${this.ROOM_PREFIX}${roomCode}`);
    return room !== null;
  }

  // Get room data
  async getRoom(roomCode) {
    const roomData = await redis.get(`${this.ROOM_PREFIX}${roomCode}`);
    if (!roomData) return null;
    return JSON.parse(roomData);
  }

  // Update room data
  async updateRoom(roomCode, room) {
    room.lastActivity = Date.now();
    await redis.set(
      `${this.ROOM_PREFIX}${roomCode}`,
      JSON.stringify(room),
      'EX',
      this.ROOM_TTL
    );
  }

  // Add player to room
  async addPlayer(roomCode, playerId, nickname, ipAddress) {
    const room = await this.getRoom(roomCode);
    if (!room) {
      throw new Error('Room not found');
    }

    const hashedIP = this.hashIP(ipAddress);

    // If room is in PLAYING status, add as spectator
    if (room.status === 'PLAYING' || room.status === 'COUNTDOWN') {
      room.spectators.push(playerId);
      await this.updateRoom(roomCode, room);
      return { room, role: 'SPECTATOR' };
    }

    // Add as player in LOBBY
    room.players[playerId] = {
      id: playerId,
      nickname,
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
      sentenceStartTime: null,
      remainingTime: 20,
      rouletteHistory: [],
      sentenceHistory: [],
      averageWPM: 0,
      peakWPM: 0,
      currentSessionWPM: 0
    };

    await this.updateRoom(roomCode, room);
    
    console.log(`✅ Player joined: ${nickname} → ${roomCode}`);
    
    return { room, role: 'PLAYER' };
  }

  // Remove player from room
  async removePlayer(roomCode, playerId) {
    const room = await this.getRoom(roomCode);
    if (!room) return { deleted: true }; // Room already gone

    console.log(`🚪 Removing player ${playerId} from room ${roomCode}`);

    // Remove from players
    delete room.players[playerId];
    
    // Remove from spectators
    room.spectators = room.spectators.filter(id => id !== playerId);

    const remainingPlayers = Object.keys(room.players).length;
    const remainingSpectators = room.spectators.length;

    console.log(`  ↳ Players left: ${remainingPlayers}, Spectators: ${remainingSpectators}`);

    // If no one left, delete immediately
    if (remainingPlayers === 0 && remainingSpectators === 0) {
      console.log(`  ↳ Room is empty, deleting...`);
      await this.deleteRoom(roomCode);
      return { deleted: true };
    }

    // Handle host migration if host left
    if (room.hostId === playerId) {
      const playerIds = Object.keys(room.players);
      if (playerIds.length > 0) {
        const oldHost = room.hostId;
        room.hostId = playerIds[0];
        console.log(`👑 Host migrated: ${oldHost} → ${room.hostId} (${room.players[room.hostId].nickname})`);
      }
    }

    await this.updateRoom(roomCode, room);
    return { deleted: false, room };
  }

  // Reconnect player back to room (within grace period)
  async reconnectPlayer(roomCode, playerId, newSocketId) {
    const room = await this.getRoom(roomCode);
    if (!room) throw new Error('Room not found');

    const player = room.players[playerId];
    if (!player) throw new Error('Player not found in room');
    
    // Update status back to ALIVE
    player.status = 'ALIVE';
    player.socketId = newSocketId;
    player.gracePeriodActive = false;
    player.disconnectedAt = null;

    await this.updateRoom(roomCode, room);
    return room;
  }

  // Delete room
  async deleteRoom(roomCode) {
    const room = await this.getRoom(roomCode);
    if (!room) return;

    // Remove from IP tracking
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

    // Decrement global counter
    await redis.decr(this.GLOBAL_ROOM_COUNT);

    // Delete room
    await redis.del(`${this.ROOM_PREFIX}${roomCode}`);
    
    console.log(`🗑️  Room deleted: ${roomCode}`);
  }
}

module.exports = new RoomManager();