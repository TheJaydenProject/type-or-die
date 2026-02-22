import type {
	ClientToServerEvents,
	ServerToClientEvents,
	SocketData,
} from "@typeordie/shared";
import type { Socket } from "socket.io";
import { verifySessionToken } from "./auth.js";

type TypedSocket = Socket<
	ClientToServerEvents,
	ServerToClientEvents,
	Record<string, never>,
	SocketData
>;

export interface VerifiedSession {
	playerId: string;
	roomCode: string;
}

/**
 * Re-validates the JWT stored in socket.data on every privilege-escalating action.
 * Prevents promotion or host actions using stale or manipulated socket.data
 * from a prior session or a race-condition reconnect.
 */
export function requireValidSession(
	socket: TypedSocket,
): VerifiedSession | null {
	const { token, playerId, roomCode } = socket.data;

	if (!token || !playerId || !roomCode) return null;

	const session = verifySessionToken(token);
	if (
		!session ||
		session.playerId !== playerId ||
		session.roomCode !== roomCode
	) {
		console.warn(
			`[SECURITY] Session re-validation failed: playerId=${playerId}, roomCode=${roomCode}`,
		);
		return null;
	}

	return session;
}
