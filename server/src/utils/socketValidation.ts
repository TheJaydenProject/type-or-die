export const CONSTANTS = {
	COUNTDOWN_DURATION: 3000,
	DISCONNECT_GRACE_PERIOD: 30000,
	GAME_DURATION_TIMEOUT: 20000,
	MAX_NICKNAME_LENGTH: 20,
	ROULETTE_ANIMATION_MS: 5000,
	MAX_STRIKES: 3,
	INITIAL_ROULETTE_ODDS: 6,
	MIN_ROULETTE_ODDS: 2,
} as const;

const SAFE_USER_ERRORS = new Set([
	"Room not found",
	"Room full",
	"Only host can start game",
	"Only host can reset game",
	"Only host can request replay",
	"Only host can change settings",
	"Invalid room code",
	"Invalid nickname",
	"Invalid settings",
	"Invalid sentence count",
	"Rate limit exceeded. Please wait.",
	"Session expired or invalid",
	"Player is already active or dead",
	"Grace period expired",
	"Invalid session",
	"Room mismatch",
	"No session found",
	"Not in a room",
	"Need at least 1 player",
	"Insufficient sentences in pool",
	"Invalid data format",
	"Invalid player ID",
	"Invalid sentence index",
	"Invalid character index",
]);

export function safeErrorMessage(err: unknown): string {
	if (err instanceof Error && SAFE_USER_ERRORS.has(err.message)) {
		return err.message;
	}
	return "An internal error occurred";
}

type ValidationType =
	| "roomCode"
	| "playerId"
	| "targetPlayerId"
	| "nickname"
	| "sentenceIndex"
	| "charIndex";

export function validateInput(type: ValidationType, data: unknown): void {
	if (!data || typeof data !== "object") {
		throw new Error("Invalid data format");
	}

	const d = data as Record<string, unknown>;

	switch (type) {
		case "roomCode":
			if (
				!d.roomCode ||
				typeof d.roomCode !== "string" ||
				d.roomCode.length !== 6
			) {
				throw new Error("Invalid room code");
			}
			break;
		case "playerId":
			if (
				!d.playerId ||
				typeof d.playerId !== "string" ||
				!/^[a-f0-9-]{36}$/.test(d.playerId)
			) {
				throw new Error("Invalid player ID");
			}
			break;
		case "targetPlayerId":
			if (
				!d.targetPlayerId ||
				typeof d.targetPlayerId !== "string" ||
				!/^[a-f0-9-]{36}$/.test(d.targetPlayerId)
			) {
				throw new Error("Invalid target player ID");
			}
			break;
		case "nickname":
			if (!d.nickname || typeof d.nickname !== "string" || !d.nickname.trim()) {
				throw new Error("Invalid nickname");
			}
			break;
		case "sentenceIndex":
			if (typeof d.sentenceIndex !== "number" || d.sentenceIndex < 0) {
				throw new Error("Invalid sentence index");
			}
			break;
		case "charIndex":
			if (typeof d.charIndex !== "number" || d.charIndex < 0) {
				throw new Error("Invalid character index");
			}
			break;
	}
}
