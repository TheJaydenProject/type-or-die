<script setup>
import { ref, computed, onMounted } from 'vue'

const props = defineProps({
  survived: Boolean,
  previousOdds: Number,
  newOdds: Number,
  roll: Number
})

const phase = ref('spinning')
const currentHighlight = ref(null)
const cylinder = ref(null)

const chambers = computed(() => {
  return Array.from({ length: props.previousOdds }, (_, i) => ({
    isBullet: i === 0,
    index: i
  }))
})

const degreesPerChamber = computed(() => 360 / props.previousOdds)

onMounted(() => {
  if (!cylinder.value) return

  const targetChamber = props.roll - 1
  const degPerChamber = degreesPerChamber.value
  
  const fullRotations = 3
  const finalAngle = -(targetChamber * degPerChamber)
  const totalRotation = (fullRotations * 360) + finalAngle
  
  cylinder.value.classList.add('spinning')
  
  let currentRotation = 0
  const spinDuration = 2000
  const startTime = Date.now()
  
  const spin = () => {
    const elapsed = Date.now() - startTime
    const progress = Math.min(elapsed / spinDuration, 1)
    
    // Ease out cubic
    const easeProgress = 1 - Math.pow(1 - progress, 3)
    currentRotation = totalRotation * easeProgress
    
    if (cylinder.value) {
      cylinder.value.style.transform = `translate(-50%, -50%) rotate(${currentRotation}deg)`
    }
    
    const normalizedRotation = ((currentRotation % 360) + 360) % 360
    const currentChamberIndex = Math.round(normalizedRotation / degPerChamber) % props.previousOdds
    currentHighlight.value = (props.previousOdds - currentChamberIndex) % props.previousOdds
    
    if (progress < 1) {
      requestAnimationFrame(spin)
    } else {
      if (cylinder.value) cylinder.value.classList.remove('spinning')
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

<template>
  <div class="roulette-overlay">
    <div class="revolver-container">
      <div class="revolver-title">JUDGMENT</div>
      
      <div class="revolver-chamber-area">
        <div class="revolver-hammer">▼</div>
        
        <div ref="cylinder" class="revolver-cylinder">
          <div 
            v-for="(chamber, i) in chambers" 
            :key="i"
            class="chamber"
            :class="{
              'highlighted': i === currentHighlight,
              'bullet-chamber': chamber.isBullet,
              'empty-chamber': !chamber.isBullet
            }"
            :style="{
              left: `calc(50% + ${Math.sin((i * degreesPerChamber * Math.PI) / 180) * 100}px)`,
              top: `calc(50% + ${-Math.cos((i * degreesPerChamber * Math.PI) / 180) * 100}px)`
            }"
          ></div>
        </div>
      </div>

      <div v-if="phase === 'result'" class="revolver-result" :class="survived ? 'survived' : 'died'">
        <div class="result-text">
          {{ survived ? 'CLICK!' : 'BANG!' }}
        </div>
        <div class="result-odds">
          {{ survived ? `1/${previousOdds} → 1/${newOdds}` : `1/${previousOdds}` }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@import './RouletteRevolver.css';
</style>