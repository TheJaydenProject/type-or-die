import { io, type Socket } from "socket.io-client";

interface ServerResponse<T = Record<string, never>> {
	success: boolean;
	error?: string;
	roomCode?: string;
	room?: T;
}

const TARGET_URL = process.env.TARGET_URL || "http://localhost:3000";
const NUM_PLAYERS = 16;
const EMITS_PER_SECOND = 12; // ~140 WPM equivalent
const INTERVAL_MS = Math.floor(1000 / EMITS_PER_SECOND);
const MISTYPE_RATE = 0.01; // 1% intentional mistype rate

interface TestMetrics {
	emittedChars: number;
	ackedChars: number;
	errors: number;
	reconnects: number;
}

const metrics: TestMetrics = {
	emittedChars: 0,
	ackedChars: 0,
	errors: 0,
	reconnects: 0,
};

const sockets: Socket[] = [];
let roomCode: string | null = null;
let gameActive = false;

// sentences[i] is the flat string for sentence i, derived from the server's word array
let sentences: string[] = [];

/** Flatten the server's word-array sentences into plain strings with spaces */
function buildFlatSentences(raw: string[][]): string[] {
	return raw.map((words) => words.join(" "));
}

/** Per-socket typing state */
interface TypingState {
	sentenceIndex: number;
	charIndex: number; // position within the current flat sentence
}

function createSocket(nickname: string, isHost: boolean): Promise<Socket> {
	return new Promise((resolve, reject) => {
		const socket = io(TARGET_URL, {
			transports: ["websocket"],
			reconnection: true,
			reconnectionAttempts: 5,
			reconnectionDelay: 1000,
		});

		socket.on("connect", () => {
			// Only join during bootstrap. During the game, reconnects keep the existing
			// server-side session — re-joining would create a new playerId.
			if (gameActive) return;

			if (isHost) {
				socket.emit(
					"create_room",
					{ nickname, settings: { sentenceCount: 5 } },
					(res: ServerResponse) => {
						if (!res.success)
							return reject(new Error(`create_room failed: ${res.error}`));
						roomCode = res.roomCode ?? null;
						resolve(socket);
					},
				);
			} else if (roomCode) {
				socket.emit(
					"join_room",
					{ roomCode, nickname },
					(res: ServerResponse) => {
						if (!res.success)
							return reject(new Error(`join_room failed: ${res.error}`));
						resolve(socket);
					},
				);
			} else {
				reject(new Error("Room code not available for client join"));
			}
		});

		socket.on("player_progress", () => {
			metrics.ackedChars++;
		});

		socket.on("event_error", (err: { event: string; error: string }) => {
			console.error(`[Socket ${socket.id}] Error:`, err);
			metrics.errors++;
		});

		socket.on("disconnect", (reason) => {
			if (reason === "io server disconnect") {
				socket.connect();
			}
		});

		socket.on("session_token", (data: { token: string }) => {
			socket.auth = { token: data.token };
		});

		setTimeout(() => reject(new Error("Connection timeout")), 5000);
	});
}

function startAssaultPhase() {
	console.log("[Phase 2] Commencing 12Hz I/O Assault...");
	gameActive = true;

	sockets.forEach((socket) => {
		const state: TypingState = { sentenceIndex: 0, charIndex: 0 };

		const interval = setInterval(() => {
			if (!gameActive) {
				clearInterval(interval);
				return;
			}
			if (!roomCode || !socket.connected) return;
			if (state.sentenceIndex >= sentences.length) return;

			const currentSentence = sentences[state.sentenceIndex];
			const targetChar = currentSentence[state.charIndex];

			if (targetChar === undefined) return;

			const isMistype = Math.random() < MISTYPE_RATE;
			const charToSend = isMistype ? "!" : targetChar;

			socket.emit("char_typed", {
				roomCode,
				char: charToSend,
				charIndex: state.charIndex,
			});

			metrics.emittedChars++;

			if (isMistype) {
				// Server resets charIndex to 0 on mistype; mirror that locally
				state.charIndex = 0;
			} else {
				state.charIndex++;
				// Advance to next sentence when current one is complete
				if (state.charIndex >= currentSentence.length) {
					state.sentenceIndex++;
					state.charIndex = 0;
				}
			}
		}, INTERVAL_MS);
	});
}

function startChaosPhase() {
	console.log("[Phase 3] Injecting Chaos (Random Reconnects)...");

	setInterval(() => {
		if (!gameActive) return;

		// Avoid host (index 0) to prevent host-migration contamination
		const targetIndex = Math.floor(Math.random() * (NUM_PLAYERS - 1)) + 1;
		const targetSocket = sockets[targetIndex];

		if (targetSocket?.connected) {
			targetSocket.disconnect();
			metrics.reconnects++;
			setTimeout(() => targetSocket.connect(), 200);
		}
	}, 5000);
}

function printTelemetry() {
	setInterval(() => {
		if (!gameActive) return;
		console.log(
			`[Telemetry] Emitted: ${metrics.emittedChars} | Acked: ${metrics.ackedChars} | Reconnects: ${metrics.reconnects} | Errors: ${metrics.errors}`,
		);
	}, 5000);
}

async function run() {
	try {
		console.log("[Phase 1] Bootstrapping Sockets...");

		const hostSocket = await createSocket("HostPlayer", true);
		sockets.push(hostSocket);
		console.log(`Host connected. Room: ${roomCode}`);

		if (!roomCode) throw new Error("Failed to generate room code");

		const clientPromises: Promise<Socket>[] = [];
		for (let i = 1; i < NUM_PLAYERS; i++) {
			clientPromises.push(createSocket(`Player_${i}`, false));
		}

		const clientSockets = await Promise.all(clientPromises);
		sockets.push(...clientSockets);
		console.log(`All ${NUM_PLAYERS} sockets connected and joined.`);

		await new Promise((resolve) => setTimeout(resolve, 2000));

		sockets[0].emit("start_game", { roomCode }, (res: ServerResponse) => {
			if (!res?.success) throw new Error(`start_game failed: ${res?.error}`);
			console.log("[Phase 1] Countdown started, waiting for game_start...");
		});

		// game_start payload contains the actual sentences — use them
		sockets[0].on("game_start", (_data) => {
			// data.firstSentence is a word array; full sentences come from countdown_start
			startAssaultPhase();
			startChaosPhase();
			printTelemetry();
		});

		// countdown_start delivers all sentences as word arrays
		sockets[0].on(
			"countdown_start",
			(data: {
				sentences: string[][];
				startTime: number;
				duration: number;
			}) => {
				if (data?.sentences && Array.isArray(data.sentences)) {
					sentences = buildFlatSentences(data.sentences);
					console.log(
						`[Phase 1] Got ${sentences.length} sentences from server. First: "${sentences[0]?.substring(0, 40)}..."`,
					);
				}
			},
		);

		sockets[0].on(
			"game_ended",
			(data: {
				reason: string;
				winnerId: string | null;
				finalStats: Record<string, unknown>;
			}) => {
				gameActive = false;
				console.log(
					`\n[DONE] Game ended. Reason: ${data?.reason} | Winner: ${data?.winnerId ?? "none"}`,
				);
				console.log(
					`[Final Telemetry] Emitted: ${metrics.emittedChars} | Acked: ${metrics.ackedChars} | Reconnects: ${metrics.reconnects} | Errors: ${metrics.errors}`,
				);
				sockets.forEach((s) => {
					s.disconnect();
				});
				process.exit(0);
			},
		);
	} catch (err) {
		console.error("Fatal Test Error:", err);
		process.exit(1);
	}
}

run();
