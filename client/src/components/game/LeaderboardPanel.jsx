import React from 'react';

function LeaderboardPanel({ players, playerId, totalSentences }) {
  const sortedPlayers = Object.values(players).sort((a, b) => {
    if (a.status === 'ALIVE' && b.status !== 'ALIVE') return -1;
    if (a.status !== 'ALIVE' && b.status === 'ALIVE') return 1;
    if (b.completedSentences !== a.completedSentences) {
      return b.completedSentences - a.completedSentences;
    }
    return b.totalCorrectChars - a.totalCorrectChars;
  });

  const currentPlayer = players[playerId] || {};

  return (
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
                style={{ width: `${(player.completedSentences / totalSentences) * 100}%` }}
              />
            </div>
            <div className="lb-stats">
              <span>{player.completedSentences}/{totalSentences}</span>
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
  );
}

export default LeaderboardPanel;