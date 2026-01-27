import Redis from 'ioredis';
import pg from 'pg';
import { io as ioClient } from 'socket.io-client';

const { Pool } = pg;

// Docker network configuration - services communicate via service names
const CONFIG = {
  redis: { 
    host: process.env.REDIS_HOST || 'redis', 
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined
  },
  postgres: { 
    host: process.env.DB_HOST || 'postgres', 
    port: parseInt(process.env.DB_PORT) || 5432, 
    database: process.env.DB_NAME || 'typeordie_dev', 
    user: process.env.DB_USER || 'devuser', 
    password: process.env.DB_PASSWORD || 'devpass123' 
  },
  server: { 
    url: process.env.SERVER_URL || 'http://backend:3001' 
  }
};

class TestRunner {
  constructor() {
    this.redis = null;
    this.pgPool = null;
    this.results = {
      total: 0,
      passed: 0,
      failed: 0,
      tests: []
    };
  }

  async test(name, testFn) {
    this.results.total++;
    process.stdout.write(`\n  Testing: ${name}... `);
    
    try {
      await testFn();
      this.results.passed++;
      this.results.tests.push({ name, status: 'PASS' });
      console.log('✓ PASS');
      return true;
    } catch (error) {
      this.results.failed++;
      this.results.tests.push({ name, status: 'FAIL', error: error.message });
      console.log(`✗ FAIL: ${error.message}`);
      return false;
    }
  }

  assert(condition, message) {
    if (!condition) {
      throw new Error(message || 'Assertion failed');
    }
  }

  async cleanup() {
    if (this.redis) {
      await this.redis.quit();
    }
    if (this.pgPool) {
      await this.pgPool.end();
    }
  }

  printSummary() {
    console.log('\n' + '='.repeat(60));
    console.log('TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total:  ${this.results.total}`);
    console.log(`Passed: ${this.results.passed} ✓`);
    console.log(`Failed: ${this.results.failed} ${this.results.failed > 0 ? '✗' : ''}`);
    console.log('='.repeat(60));
    
    if (this.results.failed > 0) {
      console.log('\nFailed Tests:');
      this.results.tests
        .filter(t => t.status === 'FAIL')
        .forEach(t => console.log(`  ✗ ${t.name}: ${t.error}`));
    }
    
    console.log('\n');
    process.exit(this.results.failed > 0 ? 1 : 0);
  }
}

async function runInfrastructureTests(runner) {
  console.log('\n' + '='.repeat(60));
  console.log('INFRASTRUCTURE TESTS');
  console.log('='.repeat(60));

  await runner.test('Redis connection', async () => {
    runner.redis = new Redis(CONFIG.redis);
    await runner.redis.ping();
  });

  await runner.test('Redis write/read operations', async () => {
    await runner.redis.set('test:key', 'test-value');
    const value = await runner.redis.get('test:key');
    runner.assert(value === 'test-value', 'Redis read/write mismatch');
    await runner.redis.del('test:key');
  });

  await runner.test('PostgreSQL connection', async () => {
    runner.pgPool = new Pool(CONFIG.postgres);
    const result = await runner.pgPool.query('SELECT NOW()');
    runner.assert(result.rows.length > 0, 'No result from PostgreSQL');
  });

  await runner.test('PostgreSQL sentences table exists', async () => {
    const result = await runner.pgPool.query(`
      SELECT COUNT(*) FROM sentences WHERE is_active = TRUE
    `);
    const count = parseInt(result.rows[0].count);
    runner.assert(count > 0, `Sentences table has ${count} active sentences (need at least 1)`);
  });

  await runner.test('PostgreSQL can query sentences', async () => {
    const result = await runner.pgPool.query(`
      SELECT text FROM sentences 
      WHERE is_active = TRUE 
        AND language = 'en' 
        AND contains_emoji = FALSE 
        AND word_count BETWEEN 5 AND 10 
      LIMIT 5
    `);
    runner.assert(result.rows.length > 0, 'No valid sentences found in database');
  });
}

async function runSocketTests(runner) {
  console.log('\n' + '='.repeat(60));
  console.log('SOCKET.IO TESTS');
  console.log('='.repeat(60));

  let socket1, socket2, testRoomCode, player1Id, player2Id;

  await runner.test('Socket.io connection', async () => {
    return new Promise((resolve, reject) => {
      socket1 = ioClient(CONFIG.server.url, { 
        transports: ['websocket'],
        reconnection: false
      });
      
      const timeout = setTimeout(() => {
        socket1.close();
        reject(new Error('Connection timeout'));
      }, 5000);
      
      socket1.on('connect', () => {
        clearTimeout(timeout);
        resolve();
      });
      
      socket1.on('connect_error', (err) => {
        clearTimeout(timeout);
        socket1.close();
        reject(err);
      });
    });
  });

  await runner.test('Create room', async () => {
    return new Promise((resolve, reject) => {
      socket1.emit('create_room', {
        nickname: 'TEST_PLAYER_1',
        settings: { sentenceCount: 5 }
      }, (response) => {
        try {
          runner.assert(response.success, `Room creation failed: ${response.error}`);
          runner.assert(response.roomCode, 'No room code returned');
          runner.assert(response.playerId, 'No player ID returned');
          runner.assert(response.room, 'No room object returned');
          testRoomCode = response.roomCode;
          player1Id = response.playerId;
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });
  });

  await runner.test('Join room', async () => {
    return new Promise((resolve, reject) => {
      socket2 = ioClient(CONFIG.server.url, { 
        transports: ['websocket'],
        reconnection: false
      });
      
      socket2.on('connect', () => {
        socket2.emit('join_room', {
          roomCode: testRoomCode,
          nickname: 'TEST_PLAYER_2'
        }, (response) => {
          try {
            runner.assert(response.success, `Join room failed: ${response.error}`);
            runner.assert(response.playerId, 'No player ID returned for player 2');
            runner.assert(response.role === 'PLAYER', 'Player should join as PLAYER role');
            player2Id = response.playerId;
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });
    });
  });

  await runner.test('Change room settings (host only)', async () => {
    return new Promise((resolve, reject) => {
      socket1.emit('change_settings', {
        roomCode: testRoomCode,
        sentenceCount: 10
      }, (response) => {
        try {
          runner.assert(response.success, `Settings change failed: ${response.error}`);
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });
  });

  await runner.test('Non-host cannot change settings', async () => {
    return new Promise((resolve, reject) => {
      socket2.emit('change_settings', {
        roomCode: testRoomCode,
        sentenceCount: 15
      }, (response) => {
        try {
          runner.assert(!response.success, 'Non-host should not be able to change settings');
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });
  });

  await runner.test('Start game', async () => {
    return new Promise((resolve, reject) => {
      let countdownReceived = false;
      
      socket1.on('countdown_start', (data) => {
        countdownReceived = true;
        runner.assert(data.sentences, 'No sentences in countdown_start');
        runner.assert(Array.isArray(data.sentences), 'Sentences should be an array');
        runner.assert(data.sentences.length === 10, `Expected 10 sentences, got ${data.sentences.length}`);
      });
      
      socket1.emit('start_game', { roomCode: testRoomCode }, (response) => {
        try {
          runner.assert(response.success, `Start game failed: ${response.error}`);
          
          setTimeout(() => {
            runner.assert(countdownReceived, 'Did not receive countdown_start event');
            resolve();
          }, 500);
        } catch (err) {
          reject(err);
        }
      });
    });
  });

  await runner.test('Game starts after countdown', async () => {
    return new Promise((resolve, reject) => {
      let gameStartReceived = false;
      
      socket1.on('game_start', (data) => {
        gameStartReceived = true;
      });
      
      setTimeout(() => {
        try {
          runner.assert(gameStartReceived, 'Did not receive game_start event after countdown');
          resolve();
        } catch (err) {
          reject(err);
        }
      }, 3500);
    });
  });

  await runner.test('Cleanup sockets', async () => {
    if (socket1) socket1.close();
    if (socket2) socket2.close();
  });
}

async function runGameLogicTests(runner) {
  console.log('\n' + '='.repeat(60));
  console.log('GAME LOGIC TESTS');
  console.log('='.repeat(60));

  let socket, roomCode, playerId;

  await runner.test('Setup game session', async () => {
    return new Promise((resolve, reject) => {
      socket = ioClient(CONFIG.server.url, { 
        transports: ['websocket'],
        reconnection: false
      });
      
      socket.on('connect', () => {
        socket.emit('create_room', {
          nickname: 'LOGIC_TEST',
          settings: { sentenceCount: 5 }
        }, (response) => {
          try {
            runner.assert(response.success, 'Failed to create room for logic test');
            roomCode = response.roomCode;
            playerId = response.playerId;
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });
    });
  });

  await runner.test('Start game and get sentences', async () => {
    return new Promise((resolve, reject) => {
      let sentences = [];
      
      socket.on('countdown_start', (data) => {
        sentences = data.sentences;
      });
      
      socket.on('game_start', () => {
        try {
          runner.assert(sentences.length > 0, 'No sentences received');
          resolve();
        } catch (err) {
          reject(err);
        }
      });
      
      socket.emit('start_game', { roomCode }, (response) => {
        if (!response.success) {
          reject(new Error(`Start game failed: ${response.error}`));
        }
      });
    });
  });

  await runner.test('Type correct characters', async () => {
    return new Promise((resolve, reject) => {
      let progressReceived = false;
      
      socket.on('player_progress', (data) => {
        if (data.playerId === playerId) {
          progressReceived = true;
          runner.assert(data.charIndex >= 0, 'Character index should be valid');
        }
      });
      
      setTimeout(() => {
        socket.emit('char_typed', {
          roomCode,
          char: 'a',
          charIndex: 0,
          timestamp: Date.now()
        });
        
        setTimeout(() => {
          try {
            runner.assert(progressReceived, 'Did not receive player_progress event');
            resolve();
          } catch (err) {
            reject(err);
          }
        }, 500);
      }, 3500);
    });
  });

  await runner.test('Handle mistype', async () => {
    return new Promise((resolve, reject) => {
      let strikeReceived = false;
      
      socket.on('player_strike', (data) => {
        if (data.playerId === playerId) {
          strikeReceived = true;
          runner.assert(data.strikes > 0, 'Strikes should increment');
        }
      });
      
      socket.emit('mistype', {
        roomCode,
        expectedChar: 'a',
        typedChar: 'b',
        charIndex: 1,
        sentenceIndex: 0
      });
      
      setTimeout(() => {
        try {
          runner.assert(strikeReceived, 'Did not receive player_strike event');
          resolve();
        } catch (err) {
          reject(err);
        }
      }, 500);
    });
  });

  await runner.test('Cleanup game session', async () => {
    if (socket) socket.close();
  });
}

async function runRoomManagerTests(runner) {
  console.log('\n' + '='.repeat(60));
  console.log('ROOM MANAGER TESTS');
  console.log('='.repeat(60));

  await runner.test('Room creation increments global count', async () => {
    const beforeCount = await runner.redis.get('global:room_count');
    const before = beforeCount ? parseInt(beforeCount) : 0;
    
    const socket = ioClient(CONFIG.server.url, { 
      transports: ['websocket'],
      reconnection: false
    });
    
    await new Promise((resolve, reject) => {
      socket.on('connect', () => {
        socket.emit('create_room', {
          nickname: 'COUNT_TEST',
          settings: { sentenceCount: 5 }
        }, async (response) => {
          try {
            if (response.success) {
              const afterCount = await runner.redis.get('global:room_count');
              const after = afterCount ? parseInt(afterCount) : 0;
              runner.assert(after > before, `Room count should increment (before: ${before}, after: ${after})`);
              socket.close();
              resolve();
            } else {
              reject(new Error(response.error));
            }
          } catch (err) {
            socket.close();
            reject(err);
          }
        });
      });
    });
  });

  await runner.test('Room data persists in Redis', async () => {
    const socket = ioClient(CONFIG.server.url, { 
      transports: ['websocket'],
      reconnection: false
    });
    
    await new Promise((resolve, reject) => {
      socket.on('connect', () => {
        socket.emit('create_room', {
          nickname: 'REDIS_TEST',
          settings: { sentenceCount: 5 }
        }, async (response) => {
          try {
            if (response.success) {
              const roomData = await runner.redis.get(`room:${response.roomCode}`);
              runner.assert(roomData, 'Room data not found in Redis');
              
              const room = JSON.parse(roomData);
              runner.assert(room.roomCode === response.roomCode, 'Room code mismatch');
              runner.assert(room.players[response.playerId], 'Player not found in room');
              
              socket.close();
              resolve();
            } else {
              reject(new Error(response.error));
            }
          } catch (err) {
            socket.close();
            reject(err);
          }
        });
      });
    });
  });
}

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('TYPE OR DIE - COMPREHENSIVE TEST SUITE (DOCKER)');
  console.log('='.repeat(60));
  console.log('\nConfiguration:');
  console.log(`  Redis:    ${CONFIG.redis.host}:${CONFIG.redis.port}`);
  console.log(`  Postgres: ${CONFIG.postgres.host}:${CONFIG.postgres.port}`);
  console.log(`  Server:   ${CONFIG.server.url}`);
  console.log('\nStarting tests...\n');

  const runner = new TestRunner();

  try {
    await runInfrastructureTests(runner);
    await runSocketTests(runner);
    await runGameLogicTests(runner);
    await runRoomManagerTests(runner);
  } catch (error) {
    console.error('\n\nFATAL ERROR:', error);
  } finally {
    await runner.cleanup();
    runner.printSummary();
  }
}

main().catch(console.error);