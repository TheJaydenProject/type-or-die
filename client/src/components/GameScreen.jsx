import { useState, useEffect, useRef } from 'react';
import './GameScreen.css';
import './RouletteRevolver.css';
import GameEndScreen from './GameEndScreen';

// Revolver Roulette Component
function RouletteRevolver({ survived, previousOdds, newOdds, roll }) {
  const [phase, setPhase] = useState('spinning');
  const [currentHighlight, setCurrentHighlight] = useState(null);
  
  useEffect(() => {
    const cylinderRef = document.querySelector('.revolver-cylinder');
    if (!cylinderRef) return;

    const targetChamber = roll - 1;
    const degreesPerChamber = 360 / previousOdds;
    
    const fullRotations = 3;
    const finalAngle = -(targetChamber * degreesPerChamber);
    const totalRotation = (fullRotations * 360) + finalAngle;
    
    cylinderRef.classList.add('spinning');
    
    let currentRotation = 0;
    const spinDuration = 2000;
    const startTime = Date.now();
    
    const spin = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / spinDuration, 1);
      
      const easeProgress = 1 - Math.pow(1 - progress, 3);
      currentRotation = totalRotation * easeProgress;
      
      cylinderRef.style.transform = `translate(-50%, -50%) rotate(${currentRotation}deg)`;
      
      const normalizedRotation = ((currentRotation % 360) + 360) % 360;
      const currentChamberIndex = Math.round(normalizedRotation / degreesPerChamber) % previousOdds;
      setCurrentHighlight((previousOdds - currentChamberIndex) % previousOdds);
      
      if (progress < 1) {
        requestAnimationFrame(spin);
      } else {
        cylinderRef.classList.remove('spinning');
        setPhase('stopped');
        setCurrentHighlight(targetChamber);
        
        setTimeout(() => {
          setPhase('result');
        }, 450);
      }
    };
    
    setTimeout(() => {
      requestAnimationFrame(spin);
    }, 200);

  }, [roll, previousOdds]);

  const chambers = Array.from({ length: previousOdds }, (_, i) => ({
    isBullet: i === 0,
    index: i
  }));

  const degreesPerChamber = 360 / previousOdds;

  return (
    <div className="roulette-overlay">
      <div className="revolver-container">
        <div className="revolver-title">RUSSIAN ROULETTE</div>
        
        <div className="revolver-chamber-area">
          <div className="revolver-hammer">▼</div>
          
          <div className="revolver-cylinder">
            {chambers.map((chamber, i) => {
              const angle = i * degreesPerChamber;
              const radius = 100;
              const x = Math.sin((angle * Math.PI) / 180) * radius;
              const y = -Math.cos((angle * Math.PI) / 180) * radius;
              
              const isHighlighted = i === currentHighlight;
              
              return (
                <div
                  key={i}
                  className={`chamber ${isHighlighted ? 'highlighted' : ''} ${chamber.isBullet ? 'bullet-chamber' : 'empty-chamber'}`}
                  style={{
                    left: `calc(50% + ${x}px)`,
                    top: `calc(50% + ${y}px)`
                  }}
                />
              );
            })}
          </div>
        </div>

        {phase === 'result' && (
          <div className={`revolver-result ${survived ? 'survived' : 'died'}`}>
            <div className="result-text">
              {survived ? 'CLICK!' : 'BANG!'}
            </div>
            <div className="result-odds">
              {survived 
                ? `1/${previousOdds} → 1/${newOdds}` 
                : `1/${previousOdds}`
              }
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function GameScreen({ socket, room, playerId, sentences, onLeave }) {
  const [currentSentenceIndex, setCurrentSentenceIndex] = useState(0);
  const [currentCharIndex, setCurrentCharIndex] = useState(0);
  const [remainingTime, setRemainingTime] = useState(20);
  const [status, setStatus] = useState('ALIVE');
  const [players, setPlayers] = useState(room.players);
  const [mistypeFlash, setMistypeFlash] = useState(false);
  const [flashKey, setFlashKey] = useState(0);
  const [showRoulette, setShowRoulette] = useState(false);
  const [rouletteResult, setRouletteResult] = useState(null);
  const [isProcessingError, setIsProcessingError] = useState(false);
  
  // Ref to track roulette state synchronously to avoid race conditions
  const rouletteActiveRef = useRef(false);

  const currentSentence = sentences[currentSentenceIndex] || '';
  const currentPlayer = players[playerId] || {};

  useEffect(() => {
    if (status !== 'ALIVE') return;

    const interval = setInterval(() => {
      setRemainingTime(prev => {
        const newTime = Math.max(0, prev - 0.1);
        if (newTime <= 0 && prev > 0) {
          socket.emit('sentence_timeout', {
            roomCode: room.roomCode,
            sentenceIndex: currentSentenceIndex
          });
        }
        return newTime;
      });
    }, 100);

    return () => clearInterval(interval);
  }, [status, currentSentenceIndex, socket, room.roomCode]);

  useEffect(() => {
    if (status !== 'ALIVE' || isProcessingError) return;

    const handleKeyPress = (e) => {
      e.preventDefault();

      const key = e.key;
      if (key.length > 1) return;

      const expectedChar = currentSentence[currentCharIndex];

      if (key === expectedChar) {
        const newCharIndex = currentCharIndex + 1;
        setCurrentCharIndex(newCharIndex);

        socket.emit('char_typed', {
          roomCode: room.roomCode,
          char: key,
          charIndex: currentCharIndex,
          timestamp: Date.now()
        });

        if (newCharIndex === currentSentence.length) {
          setTimeout(() => {
            const nextIndex = currentSentenceIndex + 1;
            if (nextIndex < sentences.length) {
              setCurrentSentenceIndex(nextIndex);
              setCurrentCharIndex(0);
              setRemainingTime(20);
            }
          }, 100);
        }
      } else {
        setIsProcessingError(true);
        
        socket.emit('mistype', {
          roomCode: room.roomCode,
          expectedChar: expectedChar,
          typedChar: key,
          charIndex: currentCharIndex,
          sentenceIndex: currentSentenceIndex
        });
        
        setCurrentCharIndex(0);
      }
    };

    document.addEventListener('keydown', handleKeyPress);
    return () => document.removeEventListener('keydown', handleKeyPress);
  }, [status, isProcessingError, currentCharIndex, currentSentence, currentSentenceIndex, socket, room.roomCode, sentences.length]);

  useEffect(() => {
    const handlePlayerProgress = (data) => {
      setPlayers(prev => ({
        ...prev,
        [data.playerId]: {
          ...prev[data.playerId],
          currentCharIndex: data.charIndex,
          currentSentenceIndex: data.sentenceIndex,
          completedSentences: data.completedSentences,
          totalCorrectChars: data.totalCorrectChars,
          totalTypedChars: data.totalTypedChars,
          totalMistypes: data.totalMistypes,
          averageWPM: data.wpm,
          status: data.status
        }
      }));
    };

    const handlePlayerStrike = (data) => {
      setPlayers(prev => ({
        ...prev,
        [data.playerId]: {
          ...prev[data.playerId],
          mistakeStrikes: data.strikes
        }
      }));

      if (data.playerId === playerId) {
        setMistypeFlash(true);
        setFlashKey(prev => prev + 1);
        setRemainingTime(20);
        setTimeout(() => {
          setMistypeFlash(false);
        }, 300);

        if (data.strikes < 3) {
          setTimeout(() => {
            setIsProcessingError(false);
          }, 300);
        }
      }
    };

    const handleRouletteResult = (data) => {
      if (data.playerId === playerId) {
        console.log('🎰 Roulette result:', data.survived ? 'SURVIVED' : 'DIED');
        
        // Update synchronous Ref immediately
        rouletteActiveRef.current = true;
        
        setShowRoulette(true);
        setRouletteResult(data);

        if (!data.survived) {
          setStatus('DEAD');
        }
        
        setPlayers(prev => ({
          ...prev,
          [data.playerId]: {
            ...prev[data.playerId],
            rouletteOdds: data.newOdds,
            mistakeStrikes: data.survived ? 0 : prev[data.playerId].mistakeStrikes
          }
        }));
        
        setTimeout(() => {
          setShowRoulette(false);
          setRouletteResult(null);
          rouletteActiveRef.current = false;
          
          if (data.survived) {
            setCurrentCharIndex(0);
            setRemainingTime(20);
            setIsProcessingError(false);
          }
        }, 4500);
      } else {
        setPlayers(prev => ({
          ...prev,
          [data.playerId]: {
            ...prev[data.playerId],
            rouletteOdds: data.newOdds,
            mistakeStrikes: data.survived ? 0 : prev[data.playerId].mistakeStrikes
          }
        }));
      }
    };

    const handlePlayerDied = (data) => {
      setPlayers(prev => ({
        ...prev,
        [data.playerId]: {
          ...prev[data.playerId],
          status: 'DEAD'
        }
      }));

      if (data.playerId === playerId && data.deathReason !== 'MISTYPE' && data.deathReason !== 'TIMEOUT') {
        setStatus('DEAD');
      }
    };

    const handleSentenceCompleted = (data) => {
      setPlayers(prev => ({
        ...prev,
        [data.playerId]: {
          ...prev[data.playerId],
          completedSentences: prev[data.playerId].completedSentences + 1
        }
      }));
    };


    socket.on('player_progress', handlePlayerProgress);
    socket.on('player_strike', handlePlayerStrike);
    socket.on('roulette_result', handleRouletteResult);
    socket.on('player_died', handlePlayerDied);
    socket.on('sentence_completed', handleSentenceCompleted);

    return () => {
      socket.off('player_progress', handlePlayerProgress);
      socket.off('player_strike', handlePlayerStrike);
      socket.off('roulette_result', handleRouletteResult);
      socket.off('player_died', handlePlayerDied);
      socket.off('sentence_completed', handleSentenceCompleted);
    };
  }, [socket, playerId, showRoulette, status]); 

  const sortedPlayers = Object.values(players).sort((a, b) => {
    if (a.status === 'ALIVE' && b.status !== 'ALIVE') return -1;
    if (a.status !== 'ALIVE' && b.status === 'ALIVE') return 1;
    if (b.completedSentences !== a.completedSentences) {
      return b.completedSentences - a.completedSentences;
    }
    return b.totalCorrectChars - a.totalCorrectChars;
  });

  return (
    <div key={flashKey} className={`terminal ${mistypeFlash ? 'flash' : ''}`}>
      {showRoulette && rouletteResult && (
        <RouletteRevolver 
          survived={rouletteResult.survived}
          previousOdds={rouletteResult.previousOdds}
          newOdds={rouletteResult.newOdds}
          roll={rouletteResult.roll}
        />
      )}

      <div className="terminal-header">
        <button onClick={onLeave} className="term-btn">EXIT</button>
      </div>

      <div className="terminal-body">
        <div className="typing-zone">
          {status === 'DEAD' && !showRoulette && (
            <div className="death-screen">
              <div className="death-text">
                <p>YOU ARE DEAD</p>
                <p>FINAL: {currentPlayer.completedSentences}/{sentences.length}</p>
                <p className="death-sub">[SPECTATING]</p>
              </div>
            </div>
          )}

          <div className="game-status-bar">
            <div className="strikes-container">
              {[0, 1, 2].map(i => (
                <span 
                  key={i} 
                  className={`strike-box ${i < (currentPlayer.mistakeStrikes || 0) ? 'crossed' : ''} ${mistypeFlash && i === (currentPlayer.mistakeStrikes || 0) - 1 ? 'flash-strike' : ''}`}
                >
                  {i < (currentPlayer.mistakeStrikes || 0) ? '☒' : '☐'}
                </span>
              ))}
            </div>
            
            <span className="term-label">SENTENCE {currentSentenceIndex + 1}/{sentences.length}</span>
            
            <span className={`term-timer ${remainingTime < 5 ? 'critical' : ''}`}>
              {remainingTime.toFixed(1)}S
            </span>
          </div>

          <div className="scrolling-sentences">
            {currentSentenceIndex > 0 && (
              <div className="sentence-row sentence-prev">
                {sentences[currentSentenceIndex - 1]}
              </div>
            )}
            
            <div className="sentence-row sentence-current">
              {currentSentence.split('').map((char, idx) => (
                <span
                  key={idx}
                  className={`
                    ${idx < currentCharIndex ? 'char-done' : 'char-pending'}
                    ${idx === currentCharIndex && status === 'ALIVE' ? 'char-current' : ''}
                  `.trim()}
                >
                  {char === ' ' ? ' ' : char}
                </span>
              ))}
            </div>
            
            {currentSentenceIndex < sentences.length - 1 && (
              <div className="sentence-row sentence-next">
                {sentences[currentSentenceIndex + 1]}
              </div>
            )}
          </div>

          <div className="typing-status">
            {status === 'ALIVE' ? '> TYPE TO SURVIVE' : '> [ELIMINATED]'}
          </div>
        </div>

        <div className="leaderboard-zone">
          <div className="lb-header">LIVE LEADERBOARD</div>
          <div className="lb-list">
            {sortedPlayers.map((player, idx) => (
              <div
                key={player.id}
                className={`lb-entry ${player.status === 'DEAD' ? 'lb-dead' : ''} ${player.id === playerId ? 'lb-you' : ''}`}
              >
                <div className="lb-rank">
                  {idx + 1}. {player.id === playerId ? '[YOU] ' : ''}{player.nickname}
                  {player.status === 'DEAD' && ' [X]'}
                </div>
                <div className="lb-bar">
                  <div 
                    className="lb-fill" 
                    style={{ width: `${(player.completedSentences / sentences.length) * 100}%` }}
                  />
                </div>
                <div className="lb-stats">
                  <span>{player.completedSentences}/{sentences.length}</span>
                  <span>{player.status === 'ALIVE' ? `1/${player.rouletteOdds}` : '--'}</span>
                  <span>WPM {player.averageWPM || 0}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="stats-panel">
            <div className="stats-header">YOUR DATA</div>
            <div className="stats-line">
              ACC: {currentPlayer.totalTypedChars > 0 
                ? ((currentPlayer.totalCorrectChars / currentPlayer.totalTypedChars) * 100).toFixed(1) 
                : 100}%
            </div>
            <div className="stats-line">HIT: {currentPlayer.totalCorrectChars || 0}</div>
            <div className="stats-line">ERR: {currentPlayer.totalMistypes || 0}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default GameScreen;