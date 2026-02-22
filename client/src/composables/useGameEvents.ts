import type {
	ClientToServerEvents,
	GameEndReason,
	PlayerState,
	RoomState,
	ServerResponse,
	ServerToClientEvents,
} from "@typeordie/shared";
import type { Socket } from "socket.io-client";
import type { Ref } from "vue";

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface GameEndData {
	reason: GameEndReason;
	winnerId: string | null;
	finalStats: Record<string, PlayerState>;
}

interface GameEventState {
	currentRoom: Ref<RoomState | null>;
	playerId: Ref<string | null>;
	userRole: Ref<string | null>;
	view: Ref<string>;
	sentences: Ref<string[][]>;
	countdown: Ref<number | null>;
	gameEndData: Ref<GameEndData | null>;
}

export function useGameEvents(socket: AppSocket, state: GameEventState) {
	const {
		currentRoom,
		playerId,
		userRole,
		view,
		sentences,
		countdown,
		gameEndData,
	} = state;

	function handleGameEnded(data: GameEndData) {
		if (currentRoom.value) {
			currentRoom.value = {
				...currentRoom.value,
				players: data.finalStats,
				status: "FINISHED",
			};
		}
		gameEndData.value = data;
		setTimeout(() => {
			view.value = "FINISHED";
		}, 6200);
	}

	function handleGameStart(_data: {
		firstSentence: string[];
		gameStartTime: number;
	}) {
		view.value = "GAME";
		countdown.value = null;
	}

	function handleReplayStarted(data: { room: RoomState }) {
		currentRoom.value = data.room;
		gameEndData.value = null;
		userRole.value = "PLAYER";
		sentences.value = [];
		countdown.value = null;
		view.value = "LOBBY";
	}

	function handleSyncSentences(data: { sentences: string[][] }) {
		sentences.value = data.sentences;
	}

	function handleGameForceReset(data: { room: RoomState }) {
		const myId = playerId.value;
		const isWipedByJanitor = !myId || !data.room.players[myId];

		if (isWipedByJanitor) {
			socket.emit(
				"join_as_player",
				{ roomCode: data.room.roomCode },
				(res: ServerResponse & { room?: RoomState }) => {
					if (res.success) {
						currentRoom.value = res.room ?? null;
						userRole.value = "PLAYER";
						view.value = "LOBBY";
					}
				},
			);
		} else {
			currentRoom.value = data.room;
			userRole.value = "PLAYER";
			view.value = "LOBBY";
		}

		gameEndData.value = null;
		sentences.value = [];
		countdown.value = null;
	}

	socket.on("game_ended", handleGameEnded);
	socket.on("game_start", handleGameStart);
	socket.on("replay_started", handleReplayStarted);
	socket.on("sync_sentences", handleSyncSentences);
	socket.on("game_force_reset", handleGameForceReset);

	function cleanup() {
		socket.off("game_ended", handleGameEnded);
		socket.off("game_start", handleGameStart);
		socket.off("replay_started", handleReplayStarted);
		socket.off("sync_sentences", handleSyncSentences);
		socket.off("game_force_reset", handleGameForceReset);
	}

	return { cleanup };
}
