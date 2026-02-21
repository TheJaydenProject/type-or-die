export function validateChar(typedChar, expectedChar) {
	return typedChar === expectedChar;
}

export function shouldAdvanceWord(currentCharInWord, currentWord) {
	return currentCharInWord === currentWord.length;
}

export function shouldCompleteSentence(
	currentWordIndex,
	words,
	currentCharInWord,
	currentWord,
) {
	return (
		currentWordIndex === words.length - 1 &&
		currentCharInWord === currentWord.length
	);
}

export function calculateGlobalCharIndex(
	words,
	currentWordIndex,
	currentCharInWord,
) {
	let index = 0;
	for (let i = 0; i < currentWordIndex; i++) {
		index += words[i].length + 1;
	}
	return index + currentCharInWord;
}

export function calculateWPM(charsTyped, timeElapsedMinutes) {
	if (timeElapsedMinutes <= 0) return 0;
	return Math.round(charsTyped / 5 / timeElapsedMinutes);
}

export function isNavigationKey(key) {
	return key.length > 1 && key !== " ";
}
