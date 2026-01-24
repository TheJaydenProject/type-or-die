import React from 'react';

function StatusHUD({ 
  remainingTime, 
  mistakeStrikes, 
  currentSentenceIndex, 
  totalSentences,
  mistypeFlash 
}) {
  return (
    <div className="game-status-bar">
      <div className="strikes-container">
        {[0, 1, 2].map(i => (
          <span 
            key={i} 
            className={`strike-box ${i < mistakeStrikes ? 'crossed' : ''} ${mistypeFlash && i === mistakeStrikes - 1 ? 'flash-strike' : ''}`}
          >
            {i < mistakeStrikes ? '☒' : '☐'}
          </span>
        ))}
      </div>
      
      <span className="term-label">
        SENTENCE {currentSentenceIndex + 1}/{totalSentences}
      </span>
      
      <span className={`term-timer ${remainingTime < 5 ? 'critical' : ''}`}>
        {remainingTime.toFixed(1)}S
      </span>
    </div>
  );
}

export default StatusHUD;