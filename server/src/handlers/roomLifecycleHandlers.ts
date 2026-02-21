import type {
	ClientToServerEvents,
	PlayerState,
	ServerToClientEvents,
	SocketData,
} from "@typeordie/shared";
import type { Server, Socket } from "socket.io";
import { v4 as uuidv4 } from "uuid";
import roomManager from "../services/roomManager.js";
import { generateSessionToken } from "../utils/auth.js";
import {
	cleanupDisconnectTimer,
	playerEventQueues,
} from "../utils/playerStateHelpers.js";
import { requireValidSession } from "../utils/sessionGuard.js";
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

export function setupRoomLifecycleHandlers(
	io: TypedServer,
	socket: TypedSocket,
) {
	socket.on("create_room", async (data, callback) => {
		try {
			roomManager.validateEventData("create_room", data);
			validateInput("nickname", data);

			const { nickname, settings } = data;
			const ipAddress = socket.handshake.address;
			const playerId = uuidv4();

			if (!settings || !settings.sentenceCount) {
				return callback({ success: false, error: "Invalid settings" });
			}

			const room = await roomManager.createRoom(
				playerId,
				nickname.trim().substring(0, CONSTANTS.MAX_NICKNAME_LENGTH),
				settings,
				ipAddress,
			);

			// Persist to socket.data
			socket.data.playerId = playerId;
			socket.data.nickname = nickname
				.trim()
				.substring(0, CONSTANTS.MAX_NICKNAME_LENGTH);
			socket.data.roomCode = room.roomCode;
			socket.data.token = generateSessionToken(playerId, room.roomCode);

			socket.join(room.roomCode);

			// Update room with socket ID
			if (room.players[playerId]) {
				room.players[playerId].socketId = socket.id;
				await roomManager.updateRoom(room.roomCode, room);
			}

			console.log(`Room created: ${room.roomCode}`);

			callback({
				success: true,
				roomCode: room.roomCode,
				playerId: playerId,
				role: "PLAYER",
				room: room,
			});
		} catch (error) {
			console.error(
				"Create room error:",
				error instanceof Error ? error.message : error,
			);
			callback({ success: false, error: safeErrorMessage(error) });
		}
	});

	socket.on("join_room", async (data, callback) => {
		try {
			const ipAddress = socket.handshake.address;
			if (!roomManager.checkEventRateLimit(ipAddress)) {
				console.warn(`[DoS Block] Join flood detected from ${ipAddress}`);
				return callback({
					success: false,
					error: "Rate limit exceeded. Please wait.",
				});
			}

			roomManager.validateEventData("join_room", data);
			validateInput("nickname", data);

			const { roomCode, nickname } = data;
			const playerId = uuidv4();

			if (!roomCode || roomCode.length !== 6) {
				return callback({ success: false, error: "Invalid room code" });
			}

			// Check existence before acquiring lock to save resources
			const roomExists = await roomManager.roomExists(roomCode.toUpperCase());
			if (!roomExists) {
				return callback({ success: false, error: "Room not found" });
			}

			const { room, role } = await roomManager.addPlayer(
				roomCode.toUpperCase(),
				playerId,
				nickname.trim().substring(0, CONSTANTS.MAX_NICKNAME_LENGTH),
				ipAddress,
			);

			// Persist to socket.data
			socket.data.playerId = playerId;
			socket.data.nickname = nickname
				.trim()
				.substring(0, CONSTANTS.MAX_NICKNAME_LENGTH);
			socket.data.roomCode = room.roomCode;
			socket.data.token = generateSessionToken(playerId, room.roomCode);

			socket.join(room.roomCode);

			if (role === "PLAYER" && room.players[playerId]) {
				room.players[playerId].socketId = socket.id;
				await roomManager.updateRoom(room.roomCode, room);
			}

			// Handle Spectator State Sync
			if (role === "SPECTATOR") {
				if (room.status === "PLAYING") {
					socket.emit("sync_game_state", room);

					Object.keys(room.players).forEach((pId) => {
						const p = room.players[pId];
						socket.emit("player_progress", {
							playerId: pId,
							...p,
						});
					});
				} else if (room.status === "COUNTDOWN") {
					const anyPlayer = Object.values(room.players)[0];
					if (!anyPlayer) {
						// COUNTDOWN with zero players is a degenerate state — skip sync
						return { room, role };
					}
					const startTime = anyPlayer.sentenceStartTime ?? Date.now();

					socket.emit("countdown_start", {
						sentences: room.sentences as unknown as string[][],
						startTime: startTime,
						duration: CONSTANTS.COUNTDOWN_DURATION,
					});
				}
			}

			// Broadcast to others
			socket.to(room.roomCode).emit("player_joined", {
				playerId: playerId,
				nickname: nickname.trim().substring(0, CONSTANTS.MAX_NICKNAME_LENGTH),
				role: role as "PLAYER" | "SPECTATOR",
				updatedPlayers: Object.values(room.players) as PlayerState[],
			});

			console.log(`Player joined: ${nickname} -> ${room.roomCode} (${role})`);

			callback({
				success: true,
				playerId: playerId,
				room: room,
				role: role as "PLAYER" | "SPECTATOR",
				sentences: room.sentences || [],
			});
		} catch (error) {
			console.error(
				"Join room error:",
				error instanceof Error ? error.message : error,
			);
			callback({ success: false, error: safeErrorMessage(error) });
		}
	});

	socket.on("join_as_player", async (_data, callback) => {
		try {
			const playerId = socket.data.playerId;
			const nickname = socket.data.nickname;
			// Use the server-authoritative room code, not the client-supplied one.
			const roomCode = socket.data.roomCode;

			// Safety checks
			if (!playerId || !nickname || !roomCode)
				return callback({ success: false, error: "No session found" });

			// Force-add them as a player
			// This works because roomManager.addPlayer overwrites existing entries
			// and if the status is LOBBY or FINISHED, it treats them as a PLAYER.
			const { room } = await roomManager.addPlayer(
				roomCode,
				playerId,
				nickname,
				socket.handshake.address,
			);

			// Ensure socket is linked (redundant but safe)
			if (room.players[playerId]) {
				room.players[playerId].socketId = socket.id;
				await roomManager.updateRoom(room.roomCode, room);
			}

			// Broadcast the update so everyone sees the new player
			socket.to(roomCode).emit("player_joined", {
				playerId,
				nickname,
				role: "PLAYER",
				updatedPlayers: Object.values(room.players),
			});

			// Send success back to the clicker
			callback({ success: true, room });
		} catch (error) {
			console.error(
				"Join as player error:",
				error instanceof Error ? error.message : error,
			);
			callback({ success: false, error: safeErrorMessage(error) });
		}
	});

	socket.on("leave_room", async (data, callback) => {
		try {
			validateInput("roomCode", data);
			const { roomCode } = data;
			const playerId = socket.data.playerId;

			if (!playerId) {
				return callback?.({ success: false, error: "Not in a room" });
			}

			cleanupDisconnectTimer(playerId);
			playerEventQueues.delete(playerId);

			const result = await roomManager.removePlayer(roomCode, playerId);

			if (result && !result.deleted && result.room) {
				if (result.room.status === "LOBBY") {
					socket.to(roomCode).emit("game_force_reset", { room: result.room });
				} else {
					socket.to(roomCode).emit("player_left", {
						playerId,
						updatedPlayers: Object.values(result.room.players) as PlayerState[],
						newHostId: result.room.hostId,
					});
				}
			}

			socket.leave(roomCode);

			delete socket.data.playerId;
			delete socket.data.roomCode;

			callback?.({ success: true });
		} catch (error) {
			console.error(
				"Leave room error:",
				error instanceof Error ? error.message : error,
			);
			callback?.({ success: false, error: safeErrorMessage(error) });
		}
	});

	socket.on("kick_player", async (data, callback) => {
		try {
			const session = requireValidSession(socket);
			if (!session)
				return callback({ success: false, error: "Invalid session" });

			validateInput("targetPlayerId", data);
			const { targetPlayerId } = data;
			const roomCode = socket.data.roomCode;
			const playerId = socket.data.playerId;

			if (!roomCode || !playerId)
				return callback({ success: false, error: "No active session" });

			const room = await roomManager.getRoom(roomCode);
			if (!room) return callback({ success: false, error: "Room not found" });
			if (room.hostId !== playerId)
				return callback({
					success: false,
					error: "Only the host can kick players",
				});
			if (room.status !== "LOBBY")
				return callback({
					success: false,
					error: "Can only kick during lobby",
				});
			if (!room.players[targetPlayerId])
				return callback({ success: false, error: "Player not found" });
			if (targetPlayerId === playerId)
				return callback({ success: false, error: "Cannot kick yourself" });

			const targetSocketId = room.players[targetPlayerId].socketId;
			const result = await roomManager.removePlayer(roomCode, targetPlayerId);

			if (result && !result.deleted && result.room) {
				io.to(roomCode).emit("player_kicked", {
					kickedPlayerId: targetPlayerId,
					updatedPlayers: Object.values(result.room.players) as PlayerState[],
					newHostId: result.room.hostId,
				});
			}

			// Remove the kicked player's socket from the room
			if (targetSocketId) {
				const kickedSocket = io.sockets.sockets.get(targetSocketId);
				if (kickedSocket) {
					kickedSocket.leave(roomCode);
					delete kickedSocket.data.playerId;
					delete kickedSocket.data.roomCode;
				}
			}

			callback({ success: true });
		} catch (error) {
			console.error(
				"Kick player error:",
				error instanceof Error ? error.message : error,
			);
			callback({ success: false, error: safeErrorMessage(error) });
		}
	});

	socket.on("change_settings", async (data, callback) => {
		try {
			validateInput("roomCode", data);
			const { roomCode, sentenceCount } = data;
			const playerId = socket.data.playerId;

			const room = await roomManager.getRoom(roomCode);
			if (!room) return callback({ success: false, error: "Room not found" });
			if (room.hostId !== playerId)
				return callback({
					success: false,
					error: "Only host can change settings",
				});

			if (sentenceCount < 5 || sentenceCount > 100 || sentenceCount % 5 !== 0) {
				return callback({ success: false, error: "Invalid sentence count" });
			}

			room.settings.sentenceCount = sentenceCount;
			await roomManager.updateRoom(roomCode, room);

			io.to(roomCode).emit("settings_updated", { sentenceCount });
			callback({ success: true });
		} catch (error) {
			console.error(
				"Change settings error:",
				error instanceof Error ? error.message : error,
			);
			callback({ success: false, error: safeErrorMessage(error) });
		}
	});
}
