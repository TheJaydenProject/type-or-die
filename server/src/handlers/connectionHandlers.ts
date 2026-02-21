import type {
	ClientToServerEvents,
	PlayerState,
	ServerToClientEvents,
	SocketData,
} from "@typeordie/shared";
import type { Server, Socket } from "socket.io";
import roomManager from "../services/roomManager.js";
import { assert } from "../utils/assert.js";
import { generateSessionToken } from "../utils/auth.js";
import {
	cleanupDisconnectTimer,
	disconnectTimers,
	playerEventQueues,
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

export function setupConnectionHandlers(io: TypedServer, socket: TypedSocket) {
	socket.on("reconnect_attempt", async (data, callback) => {
		try {
			validateInput("roomCode", data);
			validateInput("playerId", data);

			const { roomCode, playerId } = data;

			const room = await roomManager.getRoom(roomCode);
			if (!room || !room.players[playerId]) {
				return callback({
					success: false,
					error: "Session expired or invalid",
				});
			}

			const player = room.players[playerId];

			if (player.status !== "DISCONNECTED") {
				return callback({
					success: false,
					error: "Player is already active or dead",
				});
			}

			const timeSinceDisconnect = Date.now() - (player.disconnectedAt || 0);
			if (timeSinceDisconnect > CONSTANTS.DISCONNECT_GRACE_PERIOD) {
				await roomManager.removePlayer(roomCode, playerId);
				return callback({ success: false, error: "Grace period expired" });
			}

			// 1. REHYDRATE SOCKET DATA
			const reconnectingPlayer = assert(
				room.players[playerId],
				`Player ${playerId} vanished between validation and reconnect rehydration`,
			);
			socket.data.playerId = playerId;
			socket.data.nickname = reconnectingPlayer.nickname;
			socket.data.roomCode = roomCode;
			socket.data.token = generateSessionToken(playerId, roomCode);

			socket.join(roomCode);

			const updatedRoom = await roomManager.reconnectPlayer(
				roomCode,
				playerId,
				socket.id,
			);
			cleanupDisconnectTimer(playerId);

			socket.to(roomCode).emit("player_reconnected", {
				playerId: playerId,
				resumedState: updatedRoom.players[playerId],
			});

			console.log(`Player reconnected: ${playerId} to room ${roomCode}`);

			const reconnectedPlayer = assert(
				updatedRoom.players[playerId],
				`Player ${playerId} missing from room after reconnect write`,
			);
			if (!Array.isArray(updatedRoom.spectators)) {
				throw new Error(
					`Room ${roomCode} has malformed spectators array after reconnect`,
				);
			}
			const isSpectator =
				updatedRoom.spectators.includes(playerId) ||
				reconnectedPlayer.status === "DEAD";

			if (
				updatedRoom.status === "PLAYING" ||
				updatedRoom.status === "COUNTDOWN"
			) {
				socket.emit("sync_game_state", updatedRoom);

				Object.keys(updatedRoom.players).forEach((pId) => {
					const p = updatedRoom.players[pId];
					socket.emit("player_progress", {
						playerId: pId,
						...p,
					});
				});
			}

			callback({
				success: true,
				room: updatedRoom,
				playerId: playerId,
				role: isSpectator ? "SPECTATOR" : "PLAYER",
			});
		} catch (error) {
			console.error(
				"Reconnect error:",
				error instanceof Error ? error.message : error,
			);
			callback({ success: false, error: safeErrorMessage(error) });
		}
	});

	socket.on("disconnect", async () => {
		// 2. RETRIEVE FROM SOCKET DATA
		const roomCode = socket.data.roomCode;
		const playerId = socket.data.playerId;

		console.log(`[DISCONNECT] Socket ${socket.id} disconnected`);

		if (roomCode && playerId) {
			console.log(
				`[DISCONNECT] Processing disconnect for player ${playerId} in room ${roomCode}`,
			);

			try {
				const room = await roomManager.getRoom(roomCode);

				if (!room) {
					console.log(
						`[DISCONNECT] Room ${roomCode} not found - already deleted?`,
					);
					return;
				}

				if (!room.players[playerId]) {
					console.log(`[DISCONNECT] Player ${playerId} not in room anymore`);
					return;
				}

				const player = room.players[playerId];

				const shouldUseGracePeriod =
					player.status === "ALIVE" &&
					(room.status === "PLAYING" ||
						room.status === "COUNTDOWN" ||
						room.status === "LOBBY");

				if (shouldUseGracePeriod) {
					console.log(`[DISCONNECT] Using grace period for ${playerId}`);
					player.status = "DISCONNECTED";
					player.disconnectedAt = Date.now();

					await roomManager.updateRoom(roomCode, room);

					socket.to(roomCode).emit("player_disconnected", {
						playerId: playerId,
						gracePeriodEnd: Date.now() + CONSTANTS.DISCONNECT_GRACE_PERIOD,
						updatedPlayers: Object.values(room.players) as PlayerState[],
					});

					const timeoutId = setTimeout(async () => {
						try {
							if (!disconnectTimers.has(playerId)) {
								console.log(
									`[DISCONNECT] Timer cancelled for ${playerId} (reconnected)`,
								);
								return;
							}

							const freshRoom = await roomManager.getRoom(roomCode);
							if (!freshRoom) {
								disconnectTimers.delete(playerId);
								return;
							}
							const freshPlayer = freshRoom.players[playerId];
							if (!freshPlayer) {
								// Player already removed by a concurrent event — clean up and bail
								disconnectTimers.delete(playerId);
								return;
							}
							if (freshPlayer.status === "DISCONNECTED") {
								console.log(
									`[DISCONNECT] Grace period expired for ${playerId}`,
								);

								playerEventQueues.delete(playerId);

								const result = await roomManager.removePlayer(
									roomCode,
									playerId,
								);
								if (result && !result.deleted && result.room) {
									if (result.room.status === "LOBBY") {
										io.to(roomCode).emit("game_force_reset", {
											room: result.room,
										});
									} else {
										io.to(roomCode).emit("player_left", {
											playerId: playerId,
											updatedPlayers: Object.values(
												result.room.players,
											) as PlayerState[],
											newHostId: result.room.hostId,
										});
									}
								}
							}
						} catch (err) {
							console.error(
								`[DISCONNECT] Error handling disconnect timeout for ${playerId}:`,
								err,
							);
						} finally {
							disconnectTimers.delete(playerId);
						}
					}, CONSTANTS.DISCONNECT_GRACE_PERIOD);

					disconnectTimers.set(playerId, timeoutId);
				} else {
					console.log(`[DISCONNECT] Immediately removing ${playerId}`);

					cleanupDisconnectTimer(playerId);
					playerEventQueues.delete(playerId);

					const result = await roomManager.removePlayer(roomCode, playerId);

					if (result && !result.deleted && result.room) {
						if (result.room.status === "LOBBY") {
							io.to(roomCode).emit("game_force_reset", { room: result.room });
						} else {
							io.to(roomCode).emit("player_left", {
								playerId: playerId,
								updatedPlayers: Object.values(
									result.room.players,
								) as PlayerState[],
								newHostId: result.room.hostId,
							});
						}
					}
				}
			} catch (err) {
				console.error(
					`[DISCONNECT] Error in disconnect handler for ${playerId}:`, // Added back the context string
					err instanceof Error ? err.message : err,
				);
			}
		}
	});

	socket.on("heartbeat", () => {
		socket.emit("heartbeat_ack");
	});
}
