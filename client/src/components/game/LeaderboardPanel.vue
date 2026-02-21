<script setup lang="ts">
import type { PlayerState } from "@typeordie/shared";
import { computed } from "vue";

const props = defineProps<{
	players: Record<string, PlayerState>;
	playerId: string;
	totalSentences: number;
	highlightedPlayerId?: string;
	onPlayerClick?: (id: string) => void;
}>();

// Ranking: alive first → sentences desc → efficiency (correct - mistypes) desc → correct chars desc
const sortedPlayers = computed(() => {
	return Object.values(props.players).sort((a, b) => {
		if (a.status === "ALIVE" && b.status !== "ALIVE") return -1;
		if (a.status !== "ALIVE" && b.status === "ALIVE") return 1;

		if (b.completedSentences !== a.completedSentences) {
			return b.completedSentences - a.completedSentences;
		}

		const scoreA = a.totalCorrectChars - a.totalMistypes;
		const scoreB = b.totalCorrectChars - b.totalMistypes;

		if (scoreB !== scoreA) {
			return scoreB - scoreA;
		}

		return b.totalCorrectChars - a.totalCorrectChars;
	});
});

const currentPlayer = computed(() => props.players[props.playerId]);

const accuracy = computed(() => {
	const p = currentPlayer.value;
	if (!p) return "100.0";

	return p.totalTypedChars > 0
		? ((p.totalCorrectChars / p.totalTypedChars) * 100).toFixed(1)
		: "100.0";
});

const handleEntryClick = (player: PlayerState) => {
	if (props.onPlayerClick && player.status === "ALIVE") {
		props.onPlayerClick(player.id);
	}
};
</script>

<template>
  <div class="leaderboard-zone">
    <div class="lb-header">LIVE RANKING</div>

    <div class="lb-list">
      <div
        v-for="(player, idx) in sortedPlayers"
        :key="player.id"
        class="lb-entry"
        :class="{
          'lb-dead': player.status === 'DEAD',
          'lb-you': player.id === (highlightedPlayerId || playerId),
          'lb-clickable': !!onPlayerClick && player.status === 'ALIVE'
        }"
        @click="handleEntryClick(player)"
        :style="{ cursor: (onPlayerClick && player.status === 'ALIVE') ? 'pointer' : 'default' }"
      >
        <div class="lb-rank">
          {{ idx + 1 }}. {{ player.nickname }}
          {{ player.status === 'DEAD' ? ' [KIA]' : '' }}
        </div>

        <div class="lb-bar">
          <div
            class="lb-fill"
            :style="{ width: `${(player.completedSentences / totalSentences) * 100}%` }"
          ></div>
        </div>

        <div class="lb-stats">
          <div class="stat-box">
            <span class="stat-label">PROGRESS</span>
            <span class="stat-value">{{ player.completedSentences }}/{{ totalSentences }}</span>
          </div>
          <div class="stat-box">
            <span class="stat-label">CHAMBER</span>
            <span class="stat-value">{{ player.status === 'ALIVE' ? `1/${player.rouletteOdds}` : '--' }}</span>
          </div>
          <div class="stat-box">
            <span class="stat-label">SPEED</span>
            <span class="stat-value">{{ player.averageWPM || 0 }} WPM</span>
          </div>
        </div>
      </div>
    </div>

    <div class="stats-panel">
      <div class="stats-header">YOUR DATA</div>
      <div class="stats-line">ACCURACY: {{ accuracy }}%</div>
      <div class="stats-line">TOTAL HITS: {{ currentPlayer?.totalCorrectChars || 0 }}</div>
      <div class="stats-line">TOTAL ERRORS: {{ currentPlayer?.totalMistypes || 0 }}</div>
    </div>
  </div>
</template>
