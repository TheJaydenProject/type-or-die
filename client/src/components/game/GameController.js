class GameController {
  static validateChar(typedChar, expectedChar) {
    return typedChar === expectedChar;
  }

  static shouldAdvanceWord(currentCharInWord, currentWord) {
    return currentCharInWord === currentWord.length;
  }

  static shouldCompleteSentence(currentWordIndex, words, currentCharInWord, currentWord) {
    return currentWordIndex === words.length - 1 && 
           currentCharInWord === currentWord.length;
  }

  static calculateGlobalCharIndex(words, currentWordIndex, currentCharInWord) {
    let index = 0;
    for (let i = 0; i < currentWordIndex; i++) {
      index += words[i].length + 1;
    }
    return index + currentCharInWord;
  }

  static calculateWPM(charsTyped, timeElapsedMinutes) {
    if (timeElapsedMinutes <= 0) return 0;
    return Math.round((charsTyped / 5) / timeElapsedMinutes);
  }

  static isNavigationKey(key) {
    return key.length > 1 && key !== ' ';
  }
}

export default GameController;