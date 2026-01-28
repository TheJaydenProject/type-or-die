<template>
  <div class="scrolling-sentences">
    <div v-if="currentSentenceIndex > 0" class="sentence-row sentence-prev">
      {{ sentences[currentSentenceIndex - 1] }}
    </div>
    
    <div class="sentence-row sentence-current">
      <div class="words-container">
        <template v-for="(word, wordIdx) in words" :key="wordIdx">
          <span class="word">
            <span
              v-for="(char, charIdx) in word.split('')"
              :key="charIdx"
              :class="getCharClass(wordIdx, charIdx)"
            >
              {{ char }}
            </span>
            <span 
              v-if="wordIdx === currentWordIndex && currentCharInWord === currentWord.length"
              class="char-current-after"
            ></span>
          </span>
          <span 
            v-if="wordIdx < words.length - 1"
            :class="['space-char', wordIdx < currentWordIndex ? 'char-done' : 'char-pending']"
          >
            {{ ' ' }}
          </span>
        </template>
      </div>
    </div>
    
    <div v-if="currentSentenceIndex < sentences.length - 1" class="sentence-row sentence-next">
      {{ sentences[currentSentenceIndex + 1] }}
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  sentences: {
    type: Array,
    required: true
  },
  currentSentenceIndex: {
    type: Number,
    required: true
  },
  currentWordIndex: {
    type: Number,
    required: true
  },
  currentCharInWord: {
    type: Number,
    required: true
  }
})

const currentSentence = computed(() => 
  props.sentences[props.currentSentenceIndex] || ''
)

const words = computed(() => 
  currentSentence.value.split(' ')
)

const currentWord = computed(() => 
  words.value[props.currentWordIndex] || ''
)

function getCharClass(wordIdx, charIdx) {
  let className = 'char-pending'
  
  if (wordIdx < props.currentWordIndex) {
    className = 'char-done'
  } else if (wordIdx === props.currentWordIndex) {
    if (charIdx < props.currentCharInWord) {
      className = 'char-done'
    } else if (charIdx === props.currentCharInWord) {
      className = 'char-current'
    }
  }
  
  return className
}
</script>