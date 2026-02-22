<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import {
	calculateGlobalCharIndex,
	isNavigationKey,
	shouldAdvanceWord,
	validateChar,
} from "./game/GameController.js";
import LeaderboardPanel from "./game/LeaderboardPanel.vue";
import StatusHUD from "./game/StatusHUD.vue";
import TypingField from "./game/TypingField.vue";
import RouletteRevolver from "./RouletteRevolver.vue";

const props = defineProps({
	socket: { type: Object, required: true },
	room: { type: Object, required: true },
	playerId: { type: String, required: true },
	sentences: { type: Array, required: true },
	isSpectator: { type: Boolean, default: false },
});

const emit = defineEmits(["leave"]);

const players = ref({});
const currentSentenceIndex = ref(0);
const currentWordIndex = ref(0);
const currentCharInWord = ref(0);
const remainingTime = ref(20);
let gameLoopInterval = null;

const mistypeFlash = ref(false);
const flashKey = ref(0);
const isProcessingError = ref(false);
const spectatingPlayerId = ref(null);
const showRoulette = ref(false);
const isRouletteActive = ref(false);
const rouletteResult = ref(null);
const showVictory = ref(false);
const showAbortConfirm = ref(false);
const winnerAnnouncement = ref(null);

const isHost = computed(() => props.room.hostId === props.playerId);

const initializePlayers = () => {
	const initialPlayers = {};
	Object.keys(props.room.players).forEach((pId) => {
		const rawP = props.room.players[pId];

		initialPlayers[pId] = {
			...rawP,
			currentSentenceIndex: rawP.currentSentenceIndex || 0,
			currentWordIndex: rawP.currentWordIndex || 0,
			currentCharInWord: rawP.currentCharInWord || 0,
			currentCharIndex: rawP.currentCharIndex || 0,
			completedSentences: rawP.completedSentences || 0,
			totalCorrectChars: rawP.totalCorrectChars || 0,
			totalTypedChars: rawP.totalTypedChars || 0,
			totalMistypes: rawP.totalMistypes || 0,
			averageWPM: rawP.averageWPM || 0,
			mistakeStrikes: rawP.mistakeStrikes || 0,
			status: rawP.status || "ALIVE",
			sentenceStartTime: rawP.sentenceStartTime || Date.now(),
			calculatedTime: 20,
			activeRoulette: null,
		};
	});
	players.value = initialPlayers;

	if (props.isSpectator) {
		const alivePlayers = Object.values(initialPlayers).filter(
			(p) => p.status === "ALIVE",
		);
		if (alivePlayers.length > 0) {
			spectatingPlayerId.value = alivePlayers[0].id;
		}
	}
};

initializePlayers();

const currentPlayer = computed(() => players.value[props.playerId] || {});
const status = computed(() => currentPlayer.value.status || "ALIVE");

const spectatorTarget = computed(() => {
	if (spectatingPlayerId.value) {
		return players.value[spectatingPlayerId.value] || null;
	}
	return null;
});

const displayTarget = computed(() => {
	if (spectatingPlayerId.value) {
		return players.value[spectatingPlayerId.value] || null;
	}
	if (props.isSpectator) {
		return spectatingPlayerId.value
			? players.value[spectatingPlayerId.value]
			: null;
	}
	return players.value[props.playerId];
});

const currentSentence = computed(() => {
	const raw = props.sentences[currentSentenceIndex.value] || [];
	return Array.isArray(raw) ? raw.join(" ") : raw;
});

const words = computed(() => {
	const raw = props.sentences[currentSentenceIndex.value] || [];
	return Array.isArray(raw) ? raw : [];
});

const currentWord = computed(() => {
	return words.value[currentWordIndex.value] || "";
});

const handleResetGame = () => {
	showAbortConfirm.value = true;
};

const confirmAbort = () => {
	props.socket.emit(
		"force_reset_game",
		{ roomCode: props.room.roomCode },
		(response) => {
			if (!response?.success) {
				console.error("Failed to abort game:", response?.error);
			}
		},
	);
	showAbortConfirm.value = false;
};

const cancelAbort = () => {
	showAbortConfirm.value = false;
};

const startGameLoop = () => {
	if (gameLoopInterval) clearInterval(gameLoopInterval);

	gameLoopInterval = setInterval(() => {
		const target = displayTarget.value;

		if (!target || target.status === "DEAD") {
			remainingTime.value = 0;
			return;
		}

		// Freeze visually during animation
		if (showRoulette.value) {
			return;
		}

		const startTime = new Date(target.sentenceStartTime).getTime();
		if (!startTime || Number.isNaN(startTime)) {
			remainingTime.value = 20;
			return;
		}

		const elapsed = (Date.now() - startTime) / 1000;
		// sentenceStartTime is set to a future timestamp post-roulette to grant a grace window
		const calculatedTime =
			elapsed < 0 ? 20 : Math.min(20, Math.max(0, 20 - elapsed));

		remainingTime.value = calculatedTime;

		if (!props.isSpectator && target.id === props.playerId) {
			if (calculatedTime <= 0) {
				props.socket.emit("sentence_timeout", {
					roomCode: props.room.roomCode,
					sentenceIndex: currentSentenceIndex.value,
				});
			}
		}
	}, 100);
};

watch([() => props.isSpectator, spectatingPlayerId], () => {
	// When we switch targets, immediately check if the new target
	// has an active roulette animation running
	syncRouletteUI();
});

const handleKeyPress = (e) => {
	if (
		status.value !== "ALIVE" ||
		isProcessingError.value ||
		props.isSpectator ||
		isRouletteActive.value
	)
		return;

	const key = e.key;
	if (isNavigationKey(key) && key !== " ") return;
	e.preventDefault();

	const _words = words.value;
	const _currentWord = currentWord.value;
	const charIndex = calculateGlobalCharIndex(
		_words,
		currentWordIndex.value,
		currentCharInWord.value,
	);

	if (key === " ") {
		if (shouldAdvanceWord(currentCharInWord.value, _currentWord)) {
			if (currentWordIndex.value < _words.length - 1) {
				currentWordIndex.value++;
				currentCharInWord.value = 0;

				props.socket.emit("char_typed", {
					roomCode: props.room.roomCode,
					char: " ",
					charIndex: charIndex,
					timestamp: Date.now(),
				});
			}
		} else {
			triggerMistype(key, _currentWord[currentCharInWord.value], charIndex);
		}
		return;
	}

	const expectedChar = _currentWord[currentCharInWord.value];
	if (validateChar(key, expectedChar)) {
		const newCharInWord = currentCharInWord.value + 1;
		currentCharInWord.value = newCharInWord;

		props.socket.emit("char_typed", {
			roomCode: props.room.roomCode,
			char: key,
			charIndex: charIndex,
			timestamp: Date.now(),
		});
	} else {
		triggerMistype(key, expectedChar, charIndex);
	}
};

const triggerMistype = (typed, expected, charIndex) => {
	isProcessingError.value = true;
	props.socket.emit("mistype", {
		roomCode: props.room.roomCode,
		expectedChar: expected,
		typedChar: typed,
		charIndex: charIndex,
		sentenceIndex: currentSentenceIndex.value,
	});
	currentWordIndex.value = 0;
	currentCharInWord.value = 0;
};

const onPlayerProgress = (data) => {
	if (players.value[data.playerId]) {
		const currentP = players.value[data.playerId];

		// Don't overwrite sentenceStartTime from server timestamps — the server clock
		// may be skewed relative to the client, causing the timer to start at 17s
		// instead of 20s. onPlayerStrike and onRouletteResult already set a fresh
		// client-local Date.now(), so player_progress should never clobber it.
		// The only exception is sentence completion (data.currentSentenceIndex changes),
		// which is handled by onSentenceCompleted with its own sentenceStartTime.
		const newSentenceStartTime = currentP.sentenceStartTime;

		players.value[data.playerId] = {
			...currentP,
			currentCharIndex: data.currentCharIndex ?? currentP.currentCharIndex,
			currentSentenceIndex:
				data.currentSentenceIndex ?? currentP.currentSentenceIndex,
			currentWordIndex: data.currentWordIndex ?? currentP.currentWordIndex,
			currentCharInWord: data.currentCharInWord ?? currentP.currentCharInWord,
			completedSentences:
				data.completedSentences ?? currentP.completedSentences,
			totalCorrectChars: data.totalCorrectChars ?? currentP.totalCorrectChars,
			totalTypedChars: data.totalTypedChars ?? currentP.totalTypedChars,
			totalMistypes: data.totalMistypes ?? currentP.totalMistypes,
			averageWPM: data.averageWPM ?? currentP.averageWPM,
			status: data.status ?? currentP.status,
			sentenceStartTime: newSentenceStartTime,
		};
	}

	if (data.playerId === props.playerId && !props.isSpectator) {
		if (typeof data.currentSentenceIndex === "undefined") return;

		const isDesynced =
			currentSentenceIndex.value !== data.currentSentenceIndex ||
			currentWordIndex.value !== (data.currentWordIndex || 0) ||
			currentCharInWord.value !== (data.currentCharInWord || 0);

		if (isDesynced || isProcessingError.value || showRoulette.value) {
			currentSentenceIndex.value = data.currentSentenceIndex;
			currentWordIndex.value = data.currentWordIndex || 0;
			currentCharInWord.value = data.currentCharInWord || 0;

			isProcessingError.value = false;
			showRoulette.value = false;
			isRouletteActive.value = false;
		}
	}
};

const onPlayerStrike = (data) => {
	if (players.value[data.playerId]) {
		players.value[data.playerId] = {
			...players.value[data.playerId],
			mistakeStrikes: data.strikes,
			// Use client-local Date.now() rather than the server timestamp to avoid
			// clock skew causing the timer to start partway through (e.g. 17s not 20s).
			sentenceStartTime: Date.now(),
			currentWordIndex: 0,
			currentCharInWord: 0,
			currentCharIndex: 0,
		};

		if (data.playerId === props.playerId) {
			currentWordIndex.value = 0;
			currentCharInWord.value = 0;

			mistypeFlash.value = true;
			flashKey.value += 1;
			setTimeout(() => {
				mistypeFlash.value = false;
				isProcessingError.value = false;
			}, 300);
		}
	}
};

const syncRouletteUI = () => {
	const target = displayTarget.value;

	if (target?.activeRoulette && target.activeRoulette.expiresAt > Date.now()) {
		rouletteResult.value = target.activeRoulette;
		showRoulette.value = true;
		isRouletteActive.value = target.id === props.playerId;
	} else {
		showRoulette.value = false;
		rouletteResult.value = null;
		isRouletteActive.value = false;
	}
};

const onRouletteResult = (data) => {
	if (players.value[data.playerId]) {
		players.value[data.playerId] = {
			...players.value[data.playerId],
			rouletteOdds: data.newOdds,
			mistakeStrikes: 0,
			currentWordIndex: 0,
			currentCharInWord: 0,
		};

		if (data.playerId === props.playerId && data.survived) {
			currentWordIndex.value = 0;
			currentCharInWord.value = 0;
			isProcessingError.value = false;
		}

		const fallbackOdds = data.survived ? data.newOdds + 1 : data.newOdds;

		players.value[data.playerId].activeRoulette = {
			...data,
			previousOdds: data.previousOdds || fallbackOdds,
			expiresAt: Date.now() + 5000,
		};

		if (data.survived) {
			players.value[data.playerId].sentenceStartTime = Date.now() + 5000;
		}

		// Must match the roulette animation duration so the overlay clears in sync
		setTimeout(() => {
			if (players.value[data.playerId]) {
				players.value[data.playerId].activeRoulette = null;
			}
			if (displayTarget.value?.id === data.playerId) {
				syncRouletteUI();
			}
		}, 5000);
	}

	if (displayTarget.value?.id === data.playerId) {
		syncRouletteUI();
	}
};

const onPlayerDied = (data) => {
	if (players.value[data.playerId]) {
		players.value[data.playerId] = {
			...players.value[data.playerId],
			status: "DEAD",
		};
	}

	if (displayTarget.value && data.playerId === displayTarget.value.id) {
		console.log(
			`TARGET [${data.playerId}] TERMINATED - Initiating Switch Protocol...`,
		);

		setTimeout(() => {
			const alivePlayers = Object.values(players.value).filter(
				(p) => p.status === "ALIVE" && p.id !== props.playerId,
			);

			if (alivePlayers.length > 0) {
				// Auto-follow the leader after the watched player dies
				alivePlayers.sort(
					(a, b) => b.completedSentences - a.completedSentences,
				);

				console.log(`Switching camera to ${alivePlayers[0].nickname}`);
				spectatingPlayerId.value = alivePlayers[0].id;
			}
		}, 4000);
	}
};

const onSentenceCompleted = (data) => {
	if (players.value[data.playerId]) {
		const p = players.value[data.playerId];
		p.completedSentences = (p.completedSentences || 0) + 1;
		p.currentSentenceIndex = data.newSentenceIndex;
		p.sentenceStartTime = Date.now();
		p.currentWordIndex = 0;
		p.currentCharInWord = 0;
		p.currentCharIndex = 0;

		players.value[data.playerId] = { ...p };
	}

	if (data.playerId === props.playerId && !props.isSpectator) {
		currentSentenceIndex.value = data.newSentenceIndex;
		currentWordIndex.value = 0;
		currentCharInWord.value = 0;
		isProcessingError.value = false;
	}
};

const onGameEnded = (data) => {
	console.log("🏁 Game ended event received:", data);

	Object.keys(data.finalStats).forEach((pId) => {
		if (players.value[pId]) {
			players.value[pId] = { ...players.value[pId], ...data.finalStats[pId] };
		}
	});

	if (data.winnerId === props.playerId && data.reason === "COMPLETION") {
		showVictory.value = true;
	} else if (data.reason === "COMPLETION") {
		const winner = players.value[data.winnerId];
		winnerAnnouncement.value = winner ? winner.nickname : "UNKNOWN";
	}
};

onMounted(() => {
	document.addEventListener("keydown", handleKeyPress);

	props.socket.on("player_progress", onPlayerProgress);
	props.socket.on("player_strike", onPlayerStrike);
	props.socket.on("roulette_result", onRouletteResult);
	props.socket.on("player_died", onPlayerDied);
	props.socket.on("sentence_completed", onSentenceCompleted);
	props.socket.on("game_ended", onGameEnded);

	startGameLoop();
});

onUnmounted(() => {
	document.removeEventListener("keydown", handleKeyPress);

	if (gameLoopInterval) clearInterval(gameLoopInterval);

	props.socket.off("player_progress", onPlayerProgress);
	props.socket.off("player_strike", onPlayerStrike);
	props.socket.off("roulette_result", onRouletteResult);
	props.socket.off("player_died", onPlayerDied);
	props.socket.off("sentence_completed", onSentenceCompleted);
	props.socket.off("game_ended", onGameEnded);
});

const onLeaveClick = () => {
	emit("leave");
};
</script>

<template>
  <div :key="flashKey" class="terminal" :class="{ 'flash': mistypeFlash }">

    <div v-if="showAbortConfirm" class="confirm-overlay">
      <div class="confirm-dialog">
        <div class="confirm-title">ABORT MISSION?</div>
        <div class="confirm-message">
          This will stop the game for everyone and return to lobby.

          Continue?
        </div>
        <div class="confirm-actions">
          <button @click="confirmAbort" class="confirm-btn confirm-btn-ok">OK</button>
          <button @click="cancelAbort" class="confirm-btn confirm-btn-cancel">CANCEL</button>
        </div>
      </div>
    </div>

    <RouletteRevolver
      v-if="showRoulette && rouletteResult"
      :survived="rouletteResult.survived"
      :previousOdds="rouletteResult.previousOdds"
      :newOdds="rouletteResult.newOdds"
      :roll="rouletteResult.roll"
    />

    <div class="terminal-header">
      <div v-if="spectatorTarget" class="spectator-header-badge">
        SPECTATING: {{ spectatorTarget.nickname }}
      </div>

      <div class="header-right">
        <button v-if="isHost" @click="handleResetGame" class="term-btn-reset">ABORT</button>
        <button @click="onLeaveClick" class="term-btn">EXIT</button>
      </div>
    </div>

    <div class="terminal-body">
      <div class="typing-zone">

        <div v-if="displayTarget?.status === 'DEAD' && !showRoulette" class="death-screen">
          <div class="death-text">
            <p>{{ (isSpectator || displayTarget?.id !== playerId) ? 'SUBJECT TERMINATED' : 'YOU ARE DEAD' }}</p>

            <p>FINAL: {{ displayTarget.completedSentences }}/{{ sentences.length }}</p>

            <p class="death-sub">
              {{ (isSpectator || displayTarget?.id !== playerId) ? `[OBSERVING: ${displayTarget.nickname}]` : '[MISSION FAILED]' }}
            </p>
          </div>
        </div>

        <div
          v-if="showVictory || (displayTarget?.completedSentences >= sentences.length)"
          class="victory-screen"
        >
          <div class="victory-text">
            <p>{{ isSpectator ? 'TARGET EXTRACTED' : 'MISSION COMPLETE' }}</p>
            <p>SURVIVED: {{ displayTarget.completedSentences }}/{{ sentences.length }}</p>
            <p class="victory-sub">
              {{ isSpectator ? `[WINNER: ${displayTarget.nickname}]` : '[ANALYZING RESULTS]' }}
              <span class="loading-dots"></span>
            </p>
          </div>
        </div>

        <div v-if="winnerAnnouncement && !showVictory" class="announcement-screen">
          <div class="announcement-text">
            <p>PROTOCOL ENDED</p>
            <p class="winner-name">WINNER: {{ winnerAnnouncement }}</p>
            <p class="announcement-sub">[RETURNING TO HQ]<span class="loading-dots"></span></p>
          </div>
        </div>

        <StatusHUD
          :remainingTime="remainingTime"
          :mistakeStrikes="displayTarget?.mistakeStrikes || 0"
          :currentSentenceIndex="displayTarget?.currentSentenceIndex || 0"
          :totalSentences="sentences.length"
          :mistypeFlash="mistypeFlash"
        />

        <TypingField
          :key="`typing-${displayTarget?.id}-${displayTarget?.currentSentenceIndex}-${displayTarget?.mistakeStrikes}-${displayTarget?.status}`"
          :sentences="sentences.map(s => Array.isArray(s) ? s.join(' ') : s)"
          :currentSentenceIndex="displayTarget?.currentSentenceIndex || 0"
          :currentWordIndex="displayTarget?.currentWordIndex || 0"
          :currentCharInWord="displayTarget?.currentCharInWord || 0"
        />
      </div>

      <LeaderboardPanel
        :players="players"
        :playerId="playerId"
        :totalSentences="sentences.length"
        :onPlayerClick="isSpectator ? (id) => spectatingPlayerId = id : undefined"
        :highlightedPlayerId="isSpectator ? spectatingPlayerId : playerId"
      />
    </div>
  </div>
</template>

<style src="./GameScreen.css"></style>
