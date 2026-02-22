import type {
	ClientToServerEvents,
	PlayerState,
	RoomState,
	ServerToClientEvents,
	SocketData,
} from "@typeordie/shared";
import crypto from "crypto";
import type { Server, Socket } from "socket.io";
import roomManager from "../services/roomManager.js";
import {
	cleanupRoomTimer,
	queuePlayerEvent,
} from "../utils/playerStateHelpers.js";
import {
	CONSTANTS,
	safeErrorMessage,
	validateInput,
} from "../utils/socketValidation.js";

type TypedServer = Server<
	ClientToServerEvents,
	ServerToClientEvents,
	Record<string, never>,
	SocketData
>;
type TypedSocket = Socket<
	ClientToServerEvents,
	ServerToClientEvents,
	Record<string, never>,
	SocketData
>;

async function checkGameOver(
	io: TypedServer,
	roomCode: string,
	room: RoomState,
): Promise<boolean> {
	if (room.status === "FINISHED") {
		return true;
	}

	const alivePlayers = Object.values(room.players).filter(
		(p) => p.status === "ALIVE",
	);

	if (alivePlayers.length === 0) {
		const sortedPlayers = Object.values(room.players).sort((a, b) => {
			// 1. Primary: Sentence Count (Highest Wins)
			if (b.completedSentences !== a.completedSentences) {
				return b.completedSentences - a.completedSentences;
			}

			// 2. Secondary: Efficiency Score (Correct - Mistakes)
			// Penalty Factor is 1.0
			const scoreA = a.totalCorrectChars - a.totalMistypes;
			const scoreB = b.totalCorrectChars - b.totalMistypes;

			if (scoreB !== scoreA) {
				return scoreB - scoreA;
			}

			// 3. Tie-Breaker: Raw Output (If efficiency is equal, faster typist wins)
			return b.totalCorrectChars - a.totalCorrectChars;
		});

		room.status = "FINISHED";
		cleanupRoomTimer(roomCode);
		await roomManager.updateRoom(roomCode, room);

		// Final Stats now only contain player state without score metadata
		const finalStats: Record<string, PlayerState> = {};
		for (const player of Object.values(room.players)) {
			finalStats[player.id] = { ...player };
		}

		io.to(roomCode).emit("game_ended", {
			reason: "ALL_DEAD",
			winnerId: sortedPlayers[0]?.id ?? null,
			finalStats,
		});
		return true;
	}

	await roomManager.updateRoom(roomCode, room);
	return false;
}

/**
 * Handles the logic when a user types a character.
 */
async function processCharTypedEvent(
	io: TypedServer,
	socket: TypedSocket,
	data: {
		roomCode: string;
		char: string;
		charIndex: number;
		timestamp?: number;
	},
): Promise<void> {
	const playerId = socket.data.playerId;
	if (!playerId) return;

	const { roomCode, char, charIndex } = data;

	const updated = await roomManager.atomicCharUpdate(
		roomCode,
		playerId,
		char,
		charIndex,
	);

	if (!updated) {
		return;
	}

	const { room, player, result } = updated;

	if (player.activeRoulette && !player.activeRoulette.survived) {
		return;
	}

	if (player.status === "DEAD") {
		return;
	}

	if (result.type === "CORRECT") {
		io.to(roomCode).emit("player_progress", {
			playerId,
			...player,
		});
	} else if (result.type === "SENTENCE_COMPLETE") {
		await roomManager.updateRoom(roomCode, room);

		if (player.completedSentences === room.settings.sentenceCount) {
			room.status = "FINISHED";
			cleanupRoomTimer(roomCode);
			await roomManager.updateRoom(roomCode, room);

			io.to(roomCode).emit("game_ended", {
				reason: "COMPLETION",
				winnerId: playerId,
				finalStats: {
					...room.players,
				},
			});
		} else {
			io.to(roomCode).emit("sentence_completed", {
				playerId,
				newSentenceIndex: player.currentSentenceIndex,
				...player,
			});
		}
	} else if (result.type === "MISTYPE") {
		await processMistypeEvent(io, socket, {
			roomCode,
			sentenceIndex: player.currentSentenceIndex,
		});
	}
}

/**
 * Handles logic when client reports a mistype.
 */
async function processMistypeEvent(
	io: TypedServer,
	socket: TypedSocket,
	data: {
		roomCode: string;
		sentenceIndex: number;
		expectedChar?: string;
		typedChar?: string;
	},
): Promise<void> {
	const playerId = socket.data.playerId;
	if (!playerId) return;

	const { roomCode, sentenceIndex } = data;

	const room = await roomManager.getRoom(roomCode);
	if (!room || room.status !== "PLAYING") return;

	const player = room.players[playerId];
	if (!player || player.status !== "ALIVE") return;

	if (sentenceIndex !== player.currentSentenceIndex) {
		console.warn(
			`[SECURITY] Player ${playerId} sent mistype for sentence ${sentenceIndex} but is on ${player.currentSentenceIndex}`,
		);
		return;
	}

	if (player.sentenceCharCount > 0) {
		player.totalCorrectChars = Math.max(
			0,
			player.totalCorrectChars - player.sentenceCharCount,
		);
	}

	// 1. Reset Server-side State for the current sentence
	player.mistakeStrikes = (player.mistakeStrikes || 0) + 1;
	player.totalMistypes++;
	player.currentCharIndex = 0;
	player.currentWordIndex = 0;
	player.currentCharInWord = 0;
	player.sentenceCharCount = 0;

	const resetStartTime = Date.now();
	player.sentenceStartTime = resetStartTime;

	// Notify of the strike
	io.to(roomCode).emit("player_strike", {
		playerId: playerId,
		strikes: player.mistakeStrikes,
		maxStrikes: CONSTANTS.MAX_STRIKES,
		sentenceStartTime: resetStartTime,
	});

	if (player.mistakeStrikes >= CONSTANTS.MAX_STRIKES) {
		player.mistakeStrikes = 0;
		const odds = player.rouletteOdds;
		const roll = crypto.randomInt(1, odds + 1);
		const survived = roll > 1;

		if (!Array.isArray(player.rouletteHistory)) player.rouletteHistory = [];

		player.rouletteHistory.push({
			sentenceIndex: sentenceIndex,
			odds: `1/${odds}`,
			survived: survived,
			roll: roll,
			timestamp: Date.now(),
		});

		if (survived) {
			player.rouletteOdds = Math.max(CONSTANTS.MIN_ROULETTE_ODDS, odds - 1);
			const futureStartTime = Date.now() + CONSTANTS.ROULETTE_ANIMATION_MS;
			player.sentenceStartTime = futureStartTime;

			io.to(roomCode).emit("roulette_result", {
				playerId: playerId,
				survived: true,
				newOdds: player.rouletteOdds,
				previousOdds: odds,
				roll: roll,
			});

			// Force UI reset to start of sentence after roulette animation
			io.to(roomCode).emit("player_progress", {
				playerId: playerId,
				rouletteOdds: player.rouletteOdds,
				mistakeStrikes: 0,
				currentCharIndex: 0,
				currentWordIndex: 0,
				currentCharInWord: 0,
				sentenceStartTime: futureStartTime,
			});
		} else {
			player.status = "DEAD";
			player.activeRoulette = {
				survived: false,
				newOdds: odds,
				previousOdds: odds,
				roll: roll,
				expiresAt: Date.now() + CONSTANTS.ROULETTE_ANIMATION_MS,
			};

			// Save room state immediately to persist DEAD status
			await roomManager.updateRoom(roomCode, room);

			io.to(roomCode).emit("roulette_result", {
				playerId: playerId,
				survived: false,
				newOdds: odds,
				previousOdds: odds,
				roll: roll,
			});

			// Delay death broadcast to allow roulette animation to finish
			setTimeout(async () => {
				try {
					const freshRoom = await roomManager.getRoom(roomCode);
					if (!freshRoom || !freshRoom.players[playerId]) return;

					const p = freshRoom.players[playerId];

					if (!Array.isArray(p.sentenceHistory)) p.sentenceHistory = [];
					p.sentenceHistory.push({
						sentenceIndex: sentenceIndex,
						completed: false,
						deathReason: "MISTYPE",
						timeUsed: (Date.now() - (p.sentenceStartTime || Date.now())) / 1000,
					});

					io.to(roomCode).emit("player_died", {
						playerId: playerId,
						deathReason: "MISTYPE",
					});

					await checkGameOver(io, roomCode, freshRoom);
				} catch (err) {
					console.error(`Error in delayed mistype death for ${playerId}:`, err);
				}
			}, CONSTANTS.ROULETTE_ANIMATION_MS);

			// Save room with the activeRoulette state for persistence/reconnects
			await roomManager.updateRoom(roomCode, room);
			return;
		}
	} else {
		// For 1 or 2 strikes, force UI reset to start of sentence
		io.to(roomCode).emit("player_progress", {
			playerId: playerId,
			currentCharIndex: 0,
			currentWordIndex: 0,
			currentCharInWord: 0,
			mistakeStrikes: player.mistakeStrikes,
			sentenceStartTime: resetStartTime,
		});
	}

	await roomManager.updateRoom(roomCode, room);
}

/**
 * Handles logic when a player runs out of time.
 */
async function processTimeoutEvent(
	io: TypedServer,
	socket: TypedSocket,
	data: { roomCode: string; sentenceIndex: number },
): Promise<void> {
	const playerId = socket.data.playerId;
	if (!playerId) return;

	const { roomCode, sentenceIndex } = data;
	const room = await roomManager.getRoom(roomCode);
	if (!room || room.status !== "PLAYING") return;

	const player = room.players[playerId];
	if (!player || player.status !== "ALIVE") return;

	if (sentenceIndex !== player.currentSentenceIndex) {
		console.warn(
			`[SECURITY] Player ${playerId} sent timeout for sentence ${sentenceIndex} but is on ${player.currentSentenceIndex}`,
		);
		return;
	}

	const odds = player.rouletteOdds;
	const roll = crypto.randomInt(1, odds + 1);
	const survived = roll > 1;

	if (!Array.isArray(player.rouletteHistory)) player.rouletteHistory = [];

	player.rouletteHistory.push({
		sentenceIndex: sentenceIndex,
		odds: `1/${odds}`,
		survived: survived,
		roll: roll,
		timestamp: Date.now(),
	});

	if (survived) {
		if (player.sentenceCharCount > 0) {
			player.totalCorrectChars = Math.max(
				0,
				player.totalCorrectChars - player.sentenceCharCount,
			);
		}

		player.sentenceCharCount = 0;
		player.currentCharIndex = 0;
		player.currentWordIndex = 0;
		player.currentCharInWord = 0;
		player.mistakeStrikes = 0;

		player.rouletteOdds = Math.max(CONSTANTS.MIN_ROULETTE_ODDS, odds - 1);

		const futureStartTime = Date.now() + CONSTANTS.ROULETTE_ANIMATION_MS;
		player.sentenceStartTime = futureStartTime;

		io.to(roomCode).emit("roulette_result", {
			playerId: playerId,
			survived: true,
			newOdds: player.rouletteOdds,
			previousOdds: odds,
			roll: roll,
		});

		io.to(roomCode).emit("player_progress", {
			playerId: playerId,
			rouletteOdds: player.rouletteOdds,
			currentCharIndex: 0,
			currentWordIndex: 0,
			currentCharInWord: 0,
			sentenceStartTime: futureStartTime,
		});

		await roomManager.updateRoom(roomCode, room);
	} else {
		player.status = "DEAD";
		player.activeRoulette = {
			survived: false,
			newOdds: odds,
			previousOdds: odds,
			roll: roll,
			expiresAt: Date.now() + CONSTANTS.ROULETTE_ANIMATION_MS,
		};

		io.to(roomCode).emit("roulette_result", {
			playerId: playerId,
			survived: false,
			newOdds: odds,
			roll: roll,
		});

		// Save room state before waiting for death timeout
		await roomManager.updateRoom(roomCode, room);

		// Delay death broadcast to allow roulette animation to finish
		setTimeout(async () => {
			try {
				const freshRoom = await roomManager.getRoom(roomCode);
				if (!freshRoom || !freshRoom.players[playerId]) return;

				const p = freshRoom.players[playerId];

				if (!Array.isArray(p.sentenceHistory)) p.sentenceHistory = [];
				p.sentenceHistory.push({
					sentenceIndex: sentenceIndex,
					completed: false,
					deathReason: "TIMEOUT",
					timeUsed: CONSTANTS.GAME_DURATION_TIMEOUT / 1000,
				});

				io.to(roomCode).emit("player_died", {
					playerId: playerId,
					deathReason: "TIMEOUT",
				});

				await checkGameOver(io, roomCode, freshRoom);
			} catch (err) {
				console.error(`Error in delayed timeout death for ${playerId}:`, err);
			}
		}, CONSTANTS.ROULETTE_ANIMATION_MS);
	}
}

export function setupPlayerActionHandlers(
	io: TypedServer,
	socket: TypedSocket,
): void {
	socket.on("char_typed", async (data) => {
		try {
			const playerId = socket.data.playerId;
			if (!playerId) return;
			if (!roomManager.checkEventRateLimit(playerId)) return;

			roomManager.validateEventData("char_typed", data);
			validateInput("charIndex", data);
			validateInput("roomCode", data);

			await queuePlayerEvent(playerId, () =>
				processCharTypedEvent(io, socket, data),
			);
		} catch (error) {
			console.error(
				"Char typed error:",
				error instanceof Error ? error.message : error,
			);
			socket.emit("event_error", {
				event: "char_typed",
				error: safeErrorMessage(error),
			});
		}
	});

	socket.on("mistype", async (data) => {
		try {
			const playerId = socket.data.playerId;
			if (!playerId) return;
			if (!roomManager.checkEventRateLimit(playerId)) return;

			roomManager.validateEventData("mistype", data);
			validateInput("roomCode", data);
			validateInput("sentenceIndex", data);

			await queuePlayerEvent(playerId, () =>
				processMistypeEvent(io, socket, data),
			);
		} catch (error) {
			console.error(
				"Mistype error:",
				error instanceof Error ? error.message : error,
			);
			socket.emit("event_error", {
				event: "mistype",
				error: safeErrorMessage(error),
			});
		}
	});

	socket.on("sentence_timeout", async (data) => {
		try {
			const playerId = socket.data.playerId;
			if (!playerId) return;
			if (!roomManager.checkEventRateLimit(playerId)) return;

			roomManager.validateEventData("sentence_timeout", data);
			validateInput("roomCode", data);
			validateInput("sentenceIndex", data);

			await queuePlayerEvent(playerId, () =>
				processTimeoutEvent(io, socket, data),
			);
		} catch (error) {
			console.error(
				"Timeout error:",
				error instanceof Error ? error.message : error,
			);
			socket.emit("event_error", {
				event: "sentence_timeout",
				error: safeErrorMessage(error),
			});
		}
	});
}
