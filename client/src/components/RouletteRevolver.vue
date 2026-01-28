<template>
  <div class="roulette-overlay">
    <div class="revolver-container">
      <div class="revolver-title">JUDGMENT</div>
      
      <div class="revolver-chamber-area">
        <div class="revolver-hammer">▼</div>
        
        <div ref="cylinderRef" class="revolver-cylinder">
          <div
            v-for="(chamber, i) in chambers"
            :key="i"
            :class="[
              'chamber',
              { 'highlighted': i === currentHighlight },
              chamber.isBullet ? 'bullet-chamber' : 'empty-chamber'
            ]"
            :style="{
              left: `calc(50% + ${getChamberX(i)}px)`,
              top: `calc(50% + ${getChamberY(i)}px)`
            }"
          />
        </div>
      </div>

      <div v-if="phase === 'result'" :class="['revolver-result', survived ? 'survived' : 'died']">
        <div class="result-text">
          {{ survived ? 'CLICK!' : 'BANG!' }}
        </div>
        <div class="result-odds">
          {{ survived 
            ? `1/${previousOdds} → 1/${newOdds}` 
            : `1/${previousOdds}`
          }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'

const props = defineProps({
  survived: {
    type: Boolean,
    required: true
  },
  previousOdds: {
    type: Number,
    required: true
  },
  newOdds: {
    type: Number,
    required: true
  },
  roll: {
    type: Number,
    required: true
  }
})

const phase = ref('spinning')
const currentHighlight = ref(null)
const cylinderRef = ref(null)

const degreesPerChamber = computed(() => 360 / props.previousOdds)

const chambers = computed(() => {
  return Array.from({ length: props.previousOdds }, (_, i) => ({
    isBullet: i === 0,
    index: i
  }))
})

function getChamberX(i) {
  const angle = i * degreesPerChamber.value
  const radius = 100
  return Math.sin((angle * Math.PI) / 180) * radius
}

function getChamberY(i) {
  const angle = i * degreesPerChamber.value
  const radius = 100
  return -Math.cos((angle * Math.PI) / 180) * radius
}

onMounted(() => {
  if (!cylinderRef.value) return

  const targetChamber = props.roll - 1
  const fullRotations = 3
  const finalAngle = -(targetChamber * degreesPerChamber.value)
  const totalRotation = (fullRotations * 360) + finalAngle
  
  cylinderRef.value.classList.add('spinning')
  
  let currentRotation = 0
  const spinDuration = 2000
  const startTime = Date.now()
  
  const spin = () => {
    const elapsed = Date.now() - startTime
    const progress = Math.min(elapsed / spinDuration, 1)
    
    const easeProgress = 1 - Math.pow(1 - progress, 3)
    currentRotation = totalRotation * easeProgress
    
    cylinderRef.value.style.transform = `translate(-50%, -50%) rotate(${currentRotation}deg)`
    
    const normalizedRotation = ((currentRotation % 360) + 360) % 360
    const currentChamberIndex = Math.round(normalizedRotation / degreesPerChamber.value) % props.previousOdds
    currentHighlight.value = (props.previousOdds - currentChamberIndex) % props.previousOdds
    
    if (progress < 1) {
      requestAnimationFrame(spin)
    } else {
      cylinderRef.value.classList.remove('spinning')
      phase.value = 'stopped'
      currentHighlight.value = targetChamber
      
      setTimeout(() => {
        phase.value = 'result'
      }, 450)
    }
  }
  
  setTimeout(() => {
    requestAnimationFrame(spin)
  }, 200)
})
</script>

<style>
@import './RouletteRevolver.css';
</style>