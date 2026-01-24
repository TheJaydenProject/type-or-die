import { useState } from 'react';
import './GameEndScreen.css';

function GameEndScreen({ gameEndData, room, playerId, onMainMenu, onReplay }) {
  const [activeTab, setActiveTab] = useState('leaderboard');

  if (!gameEndData || !room || !playerId) {
    return (
      <div className="results-overlay">
        <div className="terminal-results error-state">
          <div className="results-header">
            <span>FATAL ERROR</span>
            <span>DATA_CORRUPT</span>
          </div>
          <div className="error-body">
            <p>CRITICAL SYSTEM FAILURE</p>
            <p>SESSION LOST</p>
            <button onClick={onMainMenu} className="results-btn primary">
              FORCE ABORT
            </button>
          </div>
        </div>
      </div>
    );
  }

  const { winnerId, finalStats } = gameEndData;
  const currentPlayer = finalStats[playerId] || {};
  const sentences = room.sentences || [];
  
  const calculateGrade = (player) => {
    if (player.status === 'DEAD') return 'F';
    const acc = player.totalTypedChars > 0 
      ? (player.totalCorrectChars / player.totalTypedChars)
      : 0;
    
    if (acc === 1) return 'SS';
    if (acc > 0.98) return 'S';
    if (acc > 0.95) return 'A';
    if (acc > 0.90) return 'B';
    return 'C';
  };

  const grade = calculateGrade(currentPlayer);
  
  const accuracy = currentPlayer.totalTypedChars > 0
    ? ((currentPlayer.totalCorrectChars / currentPlayer.totalTypedChars) * 100).toFixed(2)
    : "0.00";

  const sortedPlayers = Object.values(finalStats).sort((a, b) => {
    if (a.id === winnerId) return -1;
    if (b.id === winnerId) return 1;
    if (a.status === 'ALIVE' && b.status !== 'ALIVE') return -1;
    if (a.status !== 'ALIVE' && b.status === 'ALIVE') return 1;
    return b.completedSentences - a.completedSentences;
  });

  return (
    <div className="results-overlay">
      <div className="terminal-results">
        
        <div className="results-header">
          <span className="header-title">MISSION REPORT</span>
          <span className="header-id">ID: {room.roomCode}</span>
        </div>

        <div className="results-grid">
          
          <div className="results-summary">
            <div className="grade-container">
              <span className="grade-label">ASSESSMENT</span>
              <span className={`grade-value grade-${grade}`}>{grade}</span>
            </div>

            <div className="stats-block">
              <div className="stat-row">
                <span className="stat-label">STATUS</span>
                <span className={`stat-value ${currentPlayer.status === 'DEAD' ? 'status-dead' : 'status-alive'}`}>
                  {currentPlayer.status}
                </span>
              </div>
              <div className="stat-row">
                <span className="stat-label">COMPLETION</span>
                <span className="stat-value">{currentPlayer.completedSentences}/{sentences.length}</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">ACCURACY</span>
                <span className="stat-value">{accuracy}%</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">SPEED</span>
                <span className="stat-value">{currentPlayer.averageWPM || 0} WPM</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">ERRORS</span>
                <span className="stat-value">{currentPlayer.totalMistypes}</span>
              </div>
            </div>
          </div>

          <div className="results-data">
            <div className="tabs-nav">
              <button 
                className={`tab-btn ${activeTab === 'leaderboard' ? 'active' : ''}`}
                onClick={() => setActiveTab('leaderboard')}
              >
                RANKING
              </button>
              <button 
                className={`tab-btn ${activeTab === 'sentences' ? 'active' : ''}`}
                onClick={() => setActiveTab('sentences')}
              >
                LOGS
              </button>
              <button 
                className={`tab-btn ${activeTab === 'roulette' ? 'active' : ''}`}
                onClick={() => setActiveTab('roulette')}
              >
                CASUALTY
              </button>
            </div>

            <div className="tab-viewport">
              {activeTab === 'leaderboard' && (
                <div className="data-list">
                  {sortedPlayers.map((p, i) => (
                    <div 
                      key={p.id} 
                      className={`data-row ${p.id === playerId ? 'is-self' : ''} ${p.status === 'DEAD' ? 'is-dead' : ''}`}
                    >
                      <span className="row-rank">{(i + 1).toString().padStart(2, '0')}</span>
                      <span className="row-name">
                        {p.nickname}
                        {p.id === winnerId && <span className="badge-win">[WIN]</span>}
                        {p.status === 'DEAD' && <span className="badge-dead">[KIA]</span>}
                      </span>
                      <span className="row-stat">{p.completedSentences}/{sentences.length}</span>
                      <span className="row-stat">{p.averageWPM} WPM</span>
                    </div>
                  ))}
                </div>
              )}

              {activeTab === 'sentences' && (
                <div className="data-list">
                  {(currentPlayer.sentenceHistory || []).map((s, idx) => (
                    <div key={idx} className="data-row history-row">
                      <span className="row-index">{(s.sentenceIndex + 1).toString().padStart(2, '0')}</span>
                      <span className="row-content">
                        {s.completed ? 'COMPLETED' : `FAILED: ${s.deathReason}`}
                      </span>
                      <span className="row-stat">{s.wpm} WPM</span>
                      <span className="row-stat">{s.timeUsed.toFixed(1)}s</span>
                    </div>
                  ))}
                  {(!currentPlayer.sentenceHistory?.length) && (
                    <div className="empty-state">NO_DATA_AVAILABLE</div>
                  )}
                </div>
              )}

              {activeTab === 'roulette' && (
                <div className="data-list">
                  {[...(currentPlayer.rouletteHistory || [])].reverse().map((r, i) => (
                    <div key={i} className={`data-row roulette-row ${r.survived ? 'survived' : 'fatal'}`}>
                      <span className="row-odds">1/{r.odds}</span>
                      <span className="row-chamber">[{r.survived ? 'EMPTY' : 'BULLET'}]</span>
                      <span className="row-result">{r.survived ? 'SURVIVED' : 'FATAL'}</span>
                    </div>
                  ))}
                  {(!currentPlayer.rouletteHistory?.length) && (
                    <div className="empty-state">NO_CASUALTY_EVENTS</div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="results-actions">
          <button className="results-btn" onClick={onReplay}>
            RETURN TO LOBBY
          </button>
          <button className="results-btn" onClick={onMainMenu}>
            EXIT TO MENU
          </button>
        </div>

      </div>
    </div>
  );
}

export default GameEndScreen;