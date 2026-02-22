import type {
	ClientToServerEvents,
	ServerToClientEvents,
	SocketData,
} from "@typeordie/shared";
import type { RemoteSocket, Server, Socket } from "socket.io";
import roomManager from "../services/roomManager.js";
import sentenceService from "../services/sentenceService.js";
import {
	buildFreshPlayerState,
	cleanupRoomTimer,
	resetPlayerToLobbyState,
	roomCountdownTimers,
} from "../utils/playerStateHelpers.js";
import {
	CONSTANTS,
	safeErrorMessage,
	validateInput,
} from "../utils/socketValidation.js";

// Helper types for strict socket.io usage
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

export function setupGameFlowHandlers(io: TypedServer, socket: TypedSocket) {
	socket.on("start_game", async (data, callback) => {
		try {
			validateInput("roomCode", data);
			const { roomCode } = data;
			const playerId = socket.data.playerId; // Access via .data

			const room = await roomManager.getRoom(roomCode);
			if (!room) return callback({ success: false, error: "Room not found" });
			if (room.hostId !== playerId)
				return callback({ success: false, error: "Only host can start game" });

			const playerCount = Object.keys(room.players).length;
			if (playerCount < 1)
				return callback({ success: false, error: "Need at least 1 player" });

			cleanupRoomTimer(roomCode);

			room.status = "COUNTDOWN";

			const rawSentences = await sentenceService.selectSentences(
				room.settings.sentenceCount,
			);
			const splitSentences = rawSentences.map((s) => s.split(" "));

			room.sentences = splitSentences as unknown as string[];

			const countdownStartTime = Date.now();

			Object.keys(room.players).forEach((pId) => {
				resetPlayerToLobbyState(room.players[pId]);
				room.players[pId].sentenceStartTime =
					countdownStartTime + CONSTANTS.COUNTDOWN_DURATION;
			});

			await roomManager.updateRoom(roomCode, room);

			io.to(roomCode).emit("countdown_start", {
				sentences: splitSentences,
				startTime: countdownStartTime,
				duration: CONSTANTS.COUNTDOWN_DURATION,
			});

			console.log(`Game starting: ${roomCode} (${playerCount} players)`);

			const timerId = setTimeout(async () => {
				try {
					const updatedRoom = await roomManager.getRoom(roomCode);
					if (updatedRoom && updatedRoom.status === "COUNTDOWN") {
						updatedRoom.status = "PLAYING";
						updatedRoom.gameStartedAt = Date.now();

						await roomManager.updateRoom(roomCode, updatedRoom);

						io.to(roomCode).emit("game_start", {
							firstSentence: splitSentences[0],
							gameStartTime: Date.now(),
						});

						console.log(`Game started: ${roomCode}`);
					}
				} catch (err) {
					console.error(`Error starting game for room ${roomCode}:`, err);
				} finally {
					roomCountdownTimers.delete(roomCode);
				}
			}, CONSTANTS.COUNTDOWN_DURATION);

			roomCountdownTimers.set(roomCode, timerId);

			callback({ success: true });
		} catch (error) {
			console.error(
				"Start game error:",
				error instanceof Error ? error.message : error,
			);
			callback({ success: false, error: safeErrorMessage(error) });
		}
	});

	socket.on("force_reset_game", async (data, callback) => {
		try {
			validateInput("roomCode", data);
			const { roomCode } = data;
			const playerId = socket.data.playerId;

			const room = await roomManager.getRoom(roomCode);
			if (!room) return callback({ success: false, error: "Room not found" });
			if (room.hostId !== playerId)
				return callback({ success: false, error: "Only host can reset game" });

			console.log(`FORCE RESET: Host ${playerId} resetting room ${roomCode}`);

			cleanupRoomTimer(roomCode);

			try {
				// Fetch remote sockets to recover lost spectators
				const roomSockets = await io.in(roomCode).fetchSockets();
				const spectatorSocketMap = new Map<
					string,
					RemoteSocket<ServerToClientEvents, SocketData>
				>();

				for (const sock of roomSockets) {
					const sockPlayerId = sock.data.playerId;
					if (sockPlayerId) {
						spectatorSocketMap.set(sockPlayerId, sock);
					}
				}

				if (room.spectators && room.spectators.length > 0) {
					for (const spectatorId of room.spectators) {
						if (!room.players[spectatorId]) {
							const spectatorSocket = spectatorSocketMap.get(spectatorId);

							if (spectatorSocket) {
								const nickname = spectatorSocket.data.nickname || "SPECTATOR";
								const recoveredPlayer = buildFreshPlayerState(
									spectatorId,
									nickname,
									spectatorSocket.id,
									spectatorSocket.handshake.address,
								);

								room.players[spectatorId] = recoveredPlayer;
								console.log(`Recovered spectator ${nickname} (${spectatorId})`);
							}
						}
					}
				}
			} catch (recoveryError) {
				console.error(
					`Spectator recovery failed in ${roomCode}:`,
					recoveryError instanceof Error
						? recoveryError.message
						: recoveryError,
				);
			}

			room.status = "LOBBY";
			room.sentences = [];
			room.gameStartedAt = null;
			room.spectators = [];

			Object.keys(room.players).forEach((pId) => {
				resetPlayerToLobbyState(room.players[pId]);
			});

			await roomManager.updateRoom(roomCode, room);

			io.to(roomCode).emit("game_force_reset", { room });
			console.log(`Room ${roomCode} reset to lobby`);

			callback({ success: true });
		} catch (error) {
			console.error(
				"Force reset error:",
				error instanceof Error ? error.message : error,
			);
			callback({ success: false, error: safeErrorMessage(error) });
		}
	});

	socket.on("request_replay", async (data, callback) => {
		try {
			validateInput("roomCode", data);
			const { roomCode } = data;
			const playerId = socket.data.playerId;

			if (!playerId)
				return callback?.({ success: false, error: "Not authenticated" });

			const room = await roomManager.getRoom(roomCode);
			if (!room) return callback?.({ success: false, error: "Room not found" });
			if (room.hostId !== playerId)
				return callback?.({
					success: false,
					error: "Only host can request replay",
				});

			console.log(`REPLAY: Resetting room ${roomCode}`);

			cleanupRoomTimer(roomCode);

			const { cleanupDisconnectTimer, playerEventQueues } = await import(
				"../utils/playerStateHelpers.js"
			);
			Object.keys(room.players).forEach((pId) => {
				const p = room.players[pId];
				cleanupDisconnectTimer(pId);
				playerEventQueues.delete(pId);
				resetPlayerToLobbyState(p);
			});

			try {
				// Promote spectators to players for the next round
				const roomSockets = await io.in(roomCode).fetchSockets();

				for (const sock of roomSockets) {
					const sockPlayerId = sock.data.playerId;

					if (sockPlayerId && !room.players[sockPlayerId]) {
						const nickname = sock.data.nickname || "OPERATOR";
						const newPlayer = buildFreshPlayerState(
							sockPlayerId,
							nickname,
							sock.id,
							sock.handshake.address,
						);

						room.players[sockPlayerId] = newPlayer;
						console.log(
							`Replay: Promoted spectator ${nickname} (${sockPlayerId}) to player`,
						);
					}
				}
			} catch (err) {
				console.error(
					`Spectator promotion failed in ${roomCode}:`,
					err instanceof Error ? err.message : err,
				);
			}

			room.status = "LOBBY";
			room.sentences = [];
			room.gameStartedAt = null;
			room.spectators = [];

			// Cleanup previous game stats
			delete room.winnerId;
			delete room.winnerNickname;
			delete room.finalStats;

			Object.keys(room.players).forEach((pId) => {
				resetPlayerToLobbyState(room.players[pId]);
			});

			await roomManager.updateRoom(roomCode, room);

			io.to(roomCode).emit("replay_started", { room });
			console.log(`Replay complete for room: ${roomCode}`);

			callback?.({ success: true });
		} catch (error) {
			console.error(
				"Replay error:",
				error instanceof Error ? error.message : error,
			);
			callback?.({ success: false, error: safeErrorMessage(error) });
		}
	});
}
