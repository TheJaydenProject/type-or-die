import { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import GameScreen from './components/GameScreen';
import GameEndScreen from './components/GameEndScreen';
import './App.css';

const socket = io('http://localhost:3001');

function App() {
  const [connected, setConnected] = useState(false);
  const [view, setView] = useState('MENU');
  const [nickname, setNickname] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [currentRoom, setCurrentRoom] = useState(null);
  const [playerId, setPlayerId] = useState(null);
  const [sentenceCount, setSentenceCount] = useState(50);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(null);
  const [sentences, setSentences] = useState([]);
  const [gameEndData, setGameEndData] = useState(null);
  const [userRole, setUserRole] = useState(null);

  useEffect(() => {
    const handleGameEnded = (data) => {
      setGameEndData(data);
      
      setTimeout(() => {
        setView('FINISHED');
      }, 6200);
    };

    socket.on('game_ended', handleGameEnded);

    return () => {
      socket.off('game_ended', handleGameEnded);
    };
  }, []);

  useEffect(() => {
    socket.on('connect', () => {
      console.log('CONNECTION ESTABLISHED');
      setConnected(true);
    });

    socket.on('disconnect', () => {
      console.log('CONNECTION TERMINATED');
      setConnected(false);
    });

    socket.on('settings_updated', (data) => {
      console.log('SETTINGS_UPDATED:', data);
      if (currentRoom) {
        setCurrentRoom({
          ...currentRoom,
          settings: {
            ...currentRoom.settings,
            sentenceCount: data.sentenceCount
          }
        });
      }
    });

    socket.on('player_joined', (data) => {
      console.log('PLAYER_JOINED:', data);
      if (currentRoom && data.updatedPlayers) {
        setCurrentRoom({
          ...currentRoom,
          players: data.updatedPlayers.reduce((acc, player) => {
            acc[player.id] = player;
            return acc;
          }, {})
        });
      }
    });

    socket.on('player_left', (data) => {
      console.log('PLAYER_LEFT:', data);
      if (currentRoom && data.updatedPlayers) {
        setCurrentRoom({
          ...currentRoom,
          players: data.updatedPlayers.reduce((acc, player) => {
            acc[player.id] = player;
            return acc;
          }, {}),
          hostId: data.newHostId || currentRoom.hostId
        });
      }
    });

    socket.on('host_migrated', (data) => {
      console.log('HOST_MIGRATED:', data);
      setError(`HOST TRANSFER: ${data.newHostNickname}`);
      setTimeout(() => setError(''), 3000);
    });

    socket.on('countdown_start', (data) => {
      console.log('COUNTDOWN_START:', data);
      setSentences(data.sentences);
      setCountdown(3);
      setView('COUNTDOWN');
      
      let count = 3;
      const interval = setInterval(() => {
        count--;
        setCountdown(count);
        if (count === 0) {
          clearInterval(interval);
        }
      }, 1000);
    });

    socket.on('game_start', (data) => {
      console.log('GAME_START:', data);
      setView('GAME');
      setCountdown(null);
    });

    socket.on('replay_started', (data) => {
      console.log('REPLAY INITIATED');
      setCurrentRoom(data.room);
      setGameEndData(null);
      setUserRole('PLAYER');
      setView('LOBBY');
    });

    socket.on('sync_sentences', (data) => {
      console.log(`Syncing ${data.sentences.length} sentences for spectator`);
      setSentences(data.sentences);
    });

    socket.on('game_force_reset', (data) => {
      console.log('GAME FORCE RESET BY HOST');
      setCurrentRoom(data.room);
      setGameEndData(null);
      setUserRole('PLAYER');
      setView('LOBBY');
    });

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('settings_updated');
      socket.off('player_joined');
      socket.off('player_left');
      socket.off('host_migrated');
      socket.off('countdown_start');
      socket.off('game_start');
      socket.off('replay_started');
      socket.off('sync_sentences');
      socket.off('game_force_reset');
    };
  }, [currentRoom]);

  useEffect(() => {
    const savedSession = localStorage.getItem('type_or_die_session');
    
    if (savedSession && connected && view === 'MENU') {
      const { playerId, roomCode } = JSON.parse(savedSession);
      
      console.log('Attempting reconnection...', { playerId, roomCode });
      setLoading(true);
      
      socket.emit('reconnect_attempt', { roomCode, playerId }, (response) => {
        if (response.success) {
          console.log('RECONNECTION SUCCESSFUL');
          setCurrentRoom(response.room);
          setPlayerId(response.playerId);
          
          // Determine role on reconnect
          const player = response.room.players[response.playerId];
          const isSpectator = response.room.spectators?.includes(response.playerId) || 
                              player?.status === 'DEAD';
          setUserRole(isSpectator ? 'SPECTATOR' : 'PLAYER');
          
          // Route based on game state
          if (response.room.status === 'PLAYING' || response.room.status === 'COUNTDOWN') {
            setView('GAME');
          } else {
            setView('LOBBY');
          }
          
          setError('Reconnected successfully!');
          setTimeout(() => setError(''), 2000);
        } else {
          console.log('RECONNECTION FAILED:', response.error);
          setError(`RECONNECTION FAILED: ${response.error}`);
          localStorage.removeItem('type_or_die_session');
          setTimeout(() => setError(''), 3000);
        }
        setLoading(false);
      });
    }
  }, [connected, view]);

  useEffect(() => {
    const handlePlayerDied = (data) => {
      if (data.playerId === playerId) {
        console.log('💀 YOU DIED - Transitioning to spectator mode');
        setUserRole('SPECTATOR');
      }
    };

    socket.on('player_died', handlePlayerDied);

    return () => {
      socket.off('player_died', handlePlayerDied);
    };
  }, [playerId]);

  const handleCreateRoom = () => {
    if (!nickname.trim()) {
      setError('ERROR: NICKNAME REQUIRED');
      return;
    }

    setLoading(true);
    setError('');

    socket.emit('create_room', {
      nickname: nickname.trim(),
      settings: {
        sentenceCount: sentenceCount
      }
    }, (response) => {
      setLoading(false);
      
      if (response.success) {
        console.log('ROOM_CREATED:', response.roomCode);
        setCurrentRoom(response.room);
        setPlayerId(response.playerId);
        setUserRole('PLAYER');
        setView('LOBBY');
        localStorage.setItem('type_or_die_session', JSON.stringify({
          playerId: response.playerId,
          roomCode: response.room.roomCode
        }));
      } else {
        setError(`ERROR: ${response.error.toUpperCase()}`);
      }
    });
  };

  const handleJoinRoom = () => {
    if (!nickname.trim()) {
      setError('ERROR: NICKNAME REQUIRED');
      return;
    }

    if (!roomCode.trim() || roomCode.length !== 6) {
      setError('ERROR: INVALID ROOM CODE');
      return;
    }

    setLoading(true);
    setError('');

    socket.emit('join_room', {
      roomCode: roomCode.toUpperCase(),
      nickname: nickname.trim()
    }, (response) => {
      setLoading(false);
      
      if (response.success) {
        console.log('ROOM_JOINED:', response.room.roomCode);
        setCurrentRoom(response.room);
        setPlayerId(response.playerId);
        setUserRole(response.role);

        if (response.sentences && response.sentences.length > 0) {
          setSentences(response.sentences);
          console.log(`Loaded ${response.sentences.length} sentences for spectator`);
        }

        if (response.role === 'SPECTATOR') {
          setView('GAME');
        } else {
          setView('LOBBY');
        }

        localStorage.setItem('type_or_die_session', JSON.stringify({
          playerId: response.playerId,
          roomCode: response.room.roomCode
        }));
      } else {
        setError(`ERROR: ${response.error.toUpperCase()}`);
      }
    });
  };

  const handleLeaveRoom = () => {
    if (currentRoom) {
      socket.emit('leave_room', { roomCode: currentRoom.roomCode });
      localStorage.removeItem('type_or_die_session');
      setCurrentRoom(null);
      setPlayerId(null);
      setView('MENU');
      setRoomCode('');
    }
  };

  const handleChangeSentences = (value) => {
    if (currentRoom && currentRoom.hostId === playerId) {
      setCurrentRoom({
        ...currentRoom,
        settings: {
          ...currentRoom.settings,
          sentenceCount: value
        }
      });

      socket.emit('change_settings', {
        roomCode: currentRoom.roomCode,
        sentenceCount: value
      }, (response) => {
        if (!response.success) {
          setError(`ERROR: ${response.error.toUpperCase()}`);
        }
      });
    }
  };

  const copyRoomCode = () => {
    if (currentRoom) {
      navigator.clipboard.writeText(currentRoom.roomCode);
      setError('ROOM CODE COPIED TO CLIPBOARD');
      setTimeout(() => setError(''), 2000);
    }
  };

  const handleStartGame = () => {
    if (currentRoom && currentRoom.hostId === playerId) {
      setLoading(true);
      socket.emit('start_game', { roomCode: currentRoom.roomCode }, (response) => {
        setLoading(false);
        if (!response.success) {
          setError(`ERROR: ${response.error.toUpperCase()}`);
        }
      });
    }
  };

  if (view === 'MENU') {
    return (
      <div className="app">
        <div className="container">
          <header>
            <h1>Type or Die</h1>
            <p className="tagline">TYPE OR DIE</p>
          </header>

          <div className="status">
            {connected ? '[ONLINE]' : '[CONNECTING...]'}
          </div>

          {error && <div className="error">{error}</div>}

          <div className="form-section">
            <label>OPERATOR NAME</label>
            <input
              type="text"
              placeholder="ENTER CALLSIGN"
              value={nickname}
              onChange={(e) => setNickname(e.target.value.toUpperCase())}
              maxLength={20}
              className="input"
            />
          </div>

          <div className="form-section">
            <label>SENTENCE COUNT: {sentenceCount}</label>
            <input
              type="range"
              min="5"
              max="100"
              step="5"
              value={sentenceCount}
              onChange={(e) => setSentenceCount(parseInt(e.target.value))}
              className="slider"
            />
            <div className="slider-labels">
              <span>5</span>
              <span>100</span>
            </div>
          </div>

          <button 
            onClick={handleCreateRoom} 
            disabled={!connected || loading}
            className="btn-primary"
          >
            {loading ? 'INITIALIZING...' : 'CREATE ROOM'}
          </button>

          <div className="divider">OR</div>

          <div className="form-section">
            <label>ROOM ACCESS CODE</label>
            <input
              type="text"
              placeholder="XXXXXX"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              maxLength={6}
              className="input"
            />
          </div>

          <button 
            onClick={handleJoinRoom} 
            disabled={!connected || loading}
            className="btn-secondary"
          >
            {loading ? 'CONNECTING...' : 'JOIN ROOM'}
          </button>
        </div>
      </div>
    );
  }

  if (view === 'LOBBY' && currentRoom) {
    const isHost = currentRoom.hostId === playerId;
    const players = Object.values(currentRoom.players);

    return (
      <div className="app">
        <div className="container">
          <div className="lobby-header">
            <button onClick={handleLeaveRoom} className="btn-back">
              EXIT
            </button>
            <div className="room-code-display">
              ROOM: <strong>{currentRoom.roomCode}</strong>
              <button onClick={copyRoomCode} className="btn-copy">
                COPY
              </button>
            </div>
          </div>

          {error && <div className="error">{error}</div>}

          <div className="settings-section">
            <h2>PARAMETERS</h2>
            <div className="form-section">
              <label>SENTENCE COUNT: {currentRoom.settings?.sentenceCount ?? 50}</label>
              <input
                type="range"
                min="5"
                max="100"
                step="5"
                value={currentRoom.settings?.sentenceCount ?? 50}
                onChange={(e) => handleChangeSentences(parseInt(e.target.value))}
                disabled={!isHost}
                className="slider"
              />
              <div className="slider-labels">
                <span>5</span>
                <span>100</span>
              </div>
              {!isHost && <p className="note">[HOST ONLY]</p>}
            </div>
          </div>

          <div className="players-section">
            <h2>OPERATORS ({players.length})</h2>
            <div className="player-list">
              {players.map((player) => (
                <div key={player.id} className="player-item">
                  {player.id === currentRoom.hostId && '[HOST] '}
                  {player.nickname}
                </div>
              ))}
            </div>
          </div>

          {isHost && (
            <button 
              onClick={handleStartGame}
              disabled={loading}
              className="btn-primary" 
              style={{ marginTop: '20px' }}
            >
              {loading ? 'INITIALIZING...' : 'BEGIN PROTOCOL'}
            </button>
          )}

          {!isHost && (
            <p className="note">AWAITING HOST AUTHORIZATION...</p>
          )}
        </div>
      </div>
    );
  }

  if (view === 'COUNTDOWN') {
    return (
      <div className="app">
        <div className="container countdown-container">
          <div className="countdown-number">
            {countdown > 0 ? countdown : 'GO!'}
          </div>
          <p className="countdown-text">
            {countdown > 0 ? 'GET READY TO TYPE...' : 'START TYPING NOW!'}
          </p>
        </div>
      </div>
    );
  }

  if (view === 'GAME' && currentRoom) {
    return (
      <GameScreen
        socket={socket}
        room={currentRoom}
        playerId={playerId}
        sentences={sentences}
        onLeave={handleLeaveRoom}
        isSpectator={userRole === 'SPECTATOR'}
      />
    );
  }

  if (view === 'FINISHED' && gameEndData) {
    console.log('🎨 Rendering GameEndScreen with:', {
      gameEndData,
      currentRoom,
      playerId
    });
    
    return (
      <GameEndScreen
        gameEndData={gameEndData}
        room={currentRoom}
        playerId={playerId}
        onMainMenu={() => {
          localStorage.removeItem('type_or_die_session');
          setView('MENU');
        }}
        onReplay={() => {
          setView('LOBBY');
        }}
      />
    );
  }

  return <div className="app">LOADING...</div>;
}

export default App;