<script setup>
import { computed } from 'vue'

const props = defineProps({
  sentences: { type: Array, required: true },
  currentSentenceIndex: { type: Number, default: 0 },
  currentWordIndex: { type: Number, default: 0 },
  currentCharInWord: { type: Number, default: 0 }
})

const currentSentence = computed(() => props.sentences[props.currentSentenceIndex] || '')
const words = computed(() => currentSentence.value.split(' '))

const getCharClass = (wordIdx, charIdx) => {
  if (wordIdx < props.currentWordIndex) {
    return 'char-done'
  }
  if (wordIdx === props.currentWordIndex) {
    if (charIdx < props.currentCharInWord) return 'char-done'
    if (charIdx === props.currentCharInWord) return 'char-current'
  }
  return 'char-pending'
}

const getSpaceClass = (wordIdx) => {
  return wordIdx < props.currentWordIndex ? 'char-done' : 'char-pending'
}
</script>

<template>
  <div class="scrolling-sentences">
    
    <div v-if="currentSentenceIndex > 0" class="sentence-row sentence-prev">
      {{ sentences[currentSentenceIndex - 1] }}
    </div>
    
    <div class="sentence-row sentence-current">
      <div class="words-container">
        <template v-for="(word, wordIdx) in words" :key="wordIdx">
          <span class="word" :style="{ marginRight: '0.5em' }">
            
            <span 
              v-for="(char, charIdx) in word" 
              :key="charIdx"
              :class="getCharClass(wordIdx, charIdx)"
            >
              {{ char }}
            </span>

            <span 
              v-if="wordIdx === currentWordIndex && currentCharInWord === word.length"
              class="char-current-after"
            ></span>
          </span>

          <span 
            v-if="wordIdx < words.length - 1" 
            class="space-char"
            :class="getSpaceClass(wordIdx)"
          > </span>
        </template>
      </div>
    </div>
    
    <div v-if="currentSentenceIndex < sentences.length - 1" class="sentence-row sentence-next">
      {{ sentences[currentSentenceIndex + 1] }}
    </div>

  </div>
</template>