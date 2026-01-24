import React, { useState, useEffect, useRef } from 'react';
import './GameScreen.css';
import './RouletteRevolver.css';
import GameEndScreen from './GameEndScreen';
import GameController from './game/GameController';
import TypingField from './game/TypingField';
import StatusHUD from './game/StatusHUD';
import LeaderboardPanel from './game/LeaderboardPanel';

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

      if (GameController.isNavigationKey(key) && key !== ' ') return;

      const words = currentSentence.split(' ');
      const currentWord = words[currentWordIndex] || '';
      const charIndex = GameController.calculateGlobalCharIndex(words, currentWordIndex, currentCharInWord);

      if (key === ' ') {
        if (GameController.shouldAdvanceWord(currentCharInWord, currentWord)) {
          if (currentWordIndex < words.length - 1) {
            setCurrentWordIndex(prev => prev + 1);
            setCurrentCharInWord(0);
            
            socket.emit('char_typed', {
              roomCode: room.roomCode,
              char: ' ',
              charIndex: charIndex,
              timestamp: Date.now()
            });
          }
        } else {
          setIsProcessingError(true);
          socket.emit('mistype', {
            roomCode: room.roomCode,
            expectedChar: currentWord[currentCharInWord],
            typedChar: key,
            charIndex: charIndex,
            sentenceIndex: currentSentenceIndex
          });
          setCurrentWordIndex(0);
          setCurrentCharInWord(0);
        }
        return;
      }

      const expectedChar = currentWord[currentCharInWord];

      if (GameController.validateChar(key, expectedChar)) {
        const newCharInWord = currentCharInWord + 1;
        setCurrentCharInWord(newCharInWord);

        socket.emit('char_typed', {
          roomCode: room.roomCode,
          char: key,
          charIndex: charIndex,
          timestamp: Date.now()
        });

        if (GameController.shouldCompleteSentence(currentWordIndex, words, newCharInWord, currentWord)) {
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
          charIndex: charIndex,
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

          <StatusHUD
            remainingTime={remainingTime}
            mistakeStrikes={currentPlayer.mistakeStrikes || 0}
            currentSentenceIndex={currentSentenceIndex}
            totalSentences={sentences.length}
            mistypeFlash={mistypeFlash}
          />

          <TypingField
            sentences={sentences}
            currentSentenceIndex={currentSentenceIndex}
            currentWordIndex={currentWordIndex}
            currentCharInWord={currentCharInWord}
          />
        </div>

        <LeaderboardPanel
          players={players}
          playerId={playerId}
          totalSentences={sentences.length}
        />
      </div>
    </div>
  );
}

export default GameScreen;