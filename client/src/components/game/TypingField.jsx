import React from 'react';

function TypingField({ 
  sentences, 
  currentSentenceIndex, 
  currentWordIndex, 
  currentCharInWord 
}) {
  const currentSentence = sentences[currentSentenceIndex] || '';
  const words = currentSentence.split(' ');
  const currentWord = words[currentWordIndex] || '';

  return (
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
  );
}

export default TypingField;