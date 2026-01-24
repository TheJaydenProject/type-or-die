import React, { useState, useEffect, useRef } from 'react';
import './GameScreen.css';
import './RouletteRevolver.css';
import GameEndScreen from './GameEndScreen';

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
        <div className="revolver-title">JUDGMENT</div>
        
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
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [currentCharInWord, setCurrentCharInWord] = useState(0);
  const [remainingTime, setRemainingTime] = useState(20);
  const [status, setStatus] = useState('ALIVE');
  const [players, setPlayers] = useState(room.players);
  const [mistypeFlash, setMistypeFlash] = useState(false);
  const [flashKey, setFlashKey] = useState(0);
  const [showRoulette, setShowRoulette] = useState(false);
  const [rouletteResult, setRouletteResult] = useState(null);
  const [isProcessingError, setIsProcessingError] = useState(false);
  const [showVictory, setShowVictory] = useState(false);
  const rouletteActiveRef = useRef(false);
  
  const currentSentence = sentences[currentSentenceIndex] || '';
  const words = currentSentence.split(' ');
  const currentWord = words[currentWordIndex] || '';
  const currentPlayer = players[playerId] || {};

  const calculateGlobalCharIndex = () => {
    let index = 0;
    for (let i = 0; i < currentWordIndex; i++) {
      index += words[i].length + 1;
    }
    return index + currentCharInWord;
  };

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

      if (key === ' ') {
        if (currentCharInWord === currentWord.length) {
          if (currentWordIndex < words.length - 1) {
            setCurrentWordIndex(prev => prev + 1);
            setCurrentCharInWord(0);
            
            socket.emit('char_typed', {
              roomCode: room.roomCode,
              char: ' ',
              charIndex: calculateGlobalCharIndex(),
              timestamp: Date.now()
            });
          }
        } else {
          setIsProcessingError(true);
          socket.emit('mistype', {
            roomCode: room.roomCode,
            expectedChar: currentWord[currentCharInWord],
            typedChar: key,
            charIndex: calculateGlobalCharIndex(),
            sentenceIndex: currentSentenceIndex
          });
          setCurrentWordIndex(0);
          setCurrentCharInWord(0);
        }
        return;
      }

      if (key.length > 1) return;

      const expectedChar = currentWord[currentCharInWord];

      if (key === expectedChar) {
        const newCharInWord = currentCharInWord + 1;
        setCurrentCharInWord(newCharInWord);

        socket.emit('char_typed', {
          roomCode: room.roomCode,
          char: key,
          charIndex: calculateGlobalCharIndex(),
          timestamp: Date.now()
        });

        if (newCharInWord === currentWord.length && currentWordIndex === words.length - 1) {
          setTimeout(() => {
            const nextIndex = currentSentenceIndex + 1;
            if (nextIndex < sentences.length) {
              setCurrentSentenceIndex(nextIndex);
              setCurrentWordIndex(0);
              setCurrentCharInWord(0);
              setRemainingTime(20);
            } else {
              setShowVictory(true);
            }
          }, 100);
        }
      } else {
        setIsProcessingError(true);
        socket.emit('mistype', {
          roomCode: room.roomCode,
          expectedChar: expectedChar,
          typedChar: key,
          charIndex: calculateGlobalCharIndex(),
          sentenceIndex: currentSentenceIndex
        });
        setCurrentWordIndex(0);
        setCurrentCharInWord(0);
      }
    };

    document.addEventListener('keydown', handleKeyPress);
    return () => document.removeEventListener('keydown', handleKeyPress);
  }, [status, isProcessingError, currentCharInWord, currentWord, currentWordIndex, words, currentSentenceIndex, socket, room.roomCode, sentences.length]);

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
            setCurrentWordIndex(0);
            setCurrentCharInWord(0);
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

          {showVictory && (
            <div className="victory-screen">
              <div className="victory-text">
                <p>MISSION COMPLETE</p>
                <p>SURVIVED: {currentPlayer.completedSentences}/{sentences.length}</p>
                <p className="victory-sub">[ANALYZING RESULTS]<span className="loading-dots" /></p>
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
              <div className="words-container">
                {words.map((word, wordIdx) => (
                  <React.Fragment key={wordIdx}>
                    <span className="word">
                      {word.split('').map((char, charIdx) => {
                        let className = 'char-pending';
                        
                        if (wordIdx < currentWordIndex) {
                          className = 'char-done';
                        } else if (wordIdx === currentWordIndex) {
                          if (charIdx < currentCharInWord) {
                            className = 'char-done';
                          } else if (charIdx === currentCharInWord) {
                            className = 'char-current';
                          }
                        }
                        
                        return (
                          <span key={charIdx} className={className}>
                            {char}
                          </span>
                        );
                      })}
                      {wordIdx === currentWordIndex && currentCharInWord === currentWord.length && (
                        <span className="char-current-after"></span>
                      )}
                    </span>
                    {wordIdx < words.length - 1 && (
                      <span className={`space-char ${wordIdx < currentWordIndex ? 'char-done' : 'char-pending'}`}>
                        {' '}
                      </span>
                    )}
                  </React.Fragment>
                ))}
              </div>
            </div>
            
            {currentSentenceIndex < sentences.length - 1 && (
              <div className="sentence-row sentence-next">
                {sentences[currentSentenceIndex + 1]}
              </div>
            )}
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