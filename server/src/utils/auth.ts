import jwt from "jsonwebtoken";

const _JWT_SECRET = process.env.JWT_SECRET;

if (!_JWT_SECRET || _JWT_SECRET.length < 32) {
	console.error(
		"[FATAL] JWT_SECRET is missing or unsafe (min 32 chars required). Exiting.",
	);
	process.exit(1);
}

const JWT_SECRET: string = _JWT_SECRET;

interface SessionPayload {
	playerId: string;
	roomCode: string;
}

export function generateSessionToken(
	playerId: string,
	roomCode: string,
): string {
	return jwt.sign({ playerId, roomCode }, JWT_SECRET, {
		expiresIn: "24h",
		algorithm: "HS256",
	});
}

export function verifySessionToken(token: string): SessionPayload | null {
	try {
		const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] });
		if (
			typeof decoded === "object" &&
			decoded !== null &&
			typeof (decoded as SessionPayload).playerId === "string" &&
			typeof (decoded as SessionPayload).roomCode === "string"
		) {
			return decoded as SessionPayload;
		}
		return null;
	} catch {
		return null;
	}
}
