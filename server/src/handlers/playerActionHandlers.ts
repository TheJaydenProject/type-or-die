import type {
	ClientToServerEvents,
	PlayerState,
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
): Promise<boolean> {
	const room = await roomManager.getRoom(roomCode);
	if (!room || room.status === "FINISHED") {
		return true;
	}

	const alivePlayers = Object.values(room.players).filter(
		(p) => p.status === "ALIVE",
	);

	if (alivePlayers.length === 0) {
		// Only the writer that actually flips PLAYING -> FINISHED announces the end, so
		// two players dying at once on different replicas can't end the game twice.
		const finished = await roomManager.patchRoom(roomCode, {
			requireStatus: "PLAYING",
			setStatus: "FINISHED",
		});
		if (!finished) return true;

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

		cleanupRoomTimer(roomCode);

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

	return false;
}

/**
 * Handles the logic when a user types a character.
 */
async function processCharTypedEvent(
	io: TypedServer,
	playerId: string,
	data: {
		roomCode: string;
		char: string;
		charIndex: number;
		timestamp?: number;
	},
): Promise<void> {
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
		// atomicCharUpdate.lua already saved the room; writing `room` back here would
		// overwrite other players' keystrokes made since it was read.
		if (player.completedSentences === room.settings.sentenceCount) {
			const finished = await roomManager.patchRoom(roomCode, {
				requireStatus: "PLAYING",
				setStatus: "FINISHED",
			});
			if (!finished) return;
			cleanupRoomTimer(roomCode);

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
		await processMistypeEvent(io, playerId, {
			roomCode,
			sentenceIndex: player.currentSentenceIndex,
		});
	} else if (result.type === "TIMEOUT") {
		await processTimeoutEvent(io, playerId, {
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
	playerId: string,
	data: {
		roomCode: string;
		sentenceIndex: number;
		expectedChar?: string;
		typedChar?: string;
	},
): Promise<void> {
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

			// Persist DEAD (and activeRoulette, for reconnects) before announcing it
			await roomManager.patchRoom(roomCode, { playerId, playerFields: player });

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
					await roomManager.patchRoom(roomCode, {
						playerId,
						playerFields: { sentenceHistory: p.sentenceHistory },
					});

					io.to(roomCode).emit("player_died", {
						playerId: playerId,
						deathReason: "MISTYPE",
					});

					await checkGameOver(io, roomCode);
				} catch (err) {
					console.error(`Error in delayed mistype death for ${playerId}:`, err);
				}
			}, CONSTANTS.ROULETTE_ANIMATION_MS);
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

	await roomManager.patchRoom(roomCode, { playerId, playerFields: player });
}

/**
 * Handles a player running out of time. Called for the client's own
 * sentence_timeout, for a late keystroke (atomicCharUpdate.lua), and by the sweep.
 */
async function processTimeoutEvent(
	io: TypedServer,
	playerId: string,
	data: { roomCode: string; sentenceIndex: number },
): Promise<void> {
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

	// Ignore a timeout that isn't due yet by the server's clock. This is also what makes
	// a duplicate (client event + sweep) harmless: a survived roll moves
	// sentenceStartTime into the future, so the second one is rejected here.
	if (
		typeof player.sentenceStartTime === "number" &&
		Date.now() <
			player.sentenceStartTime +
				CONSTANTS.GAME_DURATION_TIMEOUT -
				CONSTANTS.TIMEOUT_EARLY_TOLERANCE_MS
	) {
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

		await roomManager.patchRoom(roomCode, { playerId, playerFields: player });
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
		await roomManager.patchRoom(roomCode, { playerId, playerFields: player });

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
				await roomManager.patchRoom(roomCode, {
					playerId,
					playerFields: { sentenceHistory: p.sentenceHistory },
				});

				io.to(roomCode).emit("player_died", {
					playerId: playerId,
					deathReason: "TIMEOUT",
				});

				await checkGameOver(io, roomCode);
			} catch (err) {
				console.error(`Error in delayed timeout death for ${playerId}:`, err);
			}
		}, CONSTANTS.ROULETTE_ANIMATION_MS);
	}
}

/**
 * The 20s limit can't depend on the client reporting its own timeout: a modified
 * client would simply never send it. Each replica checks the players whose sockets
 * it holds, so no two replicas time out the same player.
 */
export function startTimeoutSweep(io: TypedServer): void {
	setInterval(async () => {
		try {
			const roomCodes = new Set<string>();
			for (const socket of io.sockets.sockets.values()) {
				if (socket.data.roomCode && socket.data.playerId) {
					roomCodes.add(socket.data.roomCode);
				}
			}

			const now = Date.now();
			const deadlineMs =
				CONSTANTS.GAME_DURATION_TIMEOUT + CONSTANTS.TIMEOUT_SLACK_MS;

			for (const roomCode of roomCodes) {
				const room = await roomManager.getRoom(roomCode);
				if (!room || room.status !== "PLAYING") continue;

				for (const player of Object.values(room.players)) {
					if (
						player.status !== "ALIVE" ||
						typeof player.sentenceStartTime !== "number" ||
						now <= player.sentenceStartTime + deadlineMs ||
						!player.socketId ||
						!io.sockets.sockets.has(player.socketId)
					) {
						continue;
					}

					const sentenceIndex = player.currentSentenceIndex;
					void queuePlayerEvent(player.id, () =>
						processTimeoutEvent(io, player.id, { roomCode, sentenceIndex }),
					);
				}
			}
		} catch (err) {
			console.error(
				"Timeout sweep error:",
				err instanceof Error ? err.message : err,
			);
		}
	}, CONSTANTS.TIMEOUT_SWEEP_INTERVAL_MS);
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
				processCharTypedEvent(io, playerId, data),
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
				processMistypeEvent(io, playerId, data),
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
				processTimeoutEvent(io, playerId, data),
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
