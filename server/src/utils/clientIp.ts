import type { IncomingHttpHeaders } from "node:http";

interface HasHandshake {
	handshake: { address: string; headers: IncomingHttpHeaders };
}

// Every request reaches the backend from Traefik (or nginx behind it), so the
// socket address is a container IP shared by all visitors. Cloudflare sets
// CF-Connecting-IP to the real visitor and overwrites any value a visitor sends,
// and the Traefik routers only admit Cloudflare (typeordie-cf-only), so the header
// cannot be forged. X-Real-IP is a fallback for the nginx path.
export function pickClientIp(
	headers: IncomingHttpHeaders,
	fallback: string,
): string {
	for (const name of ["cf-connecting-ip", "x-real-ip"]) {
		const value = headers[name];
		if (typeof value === "string" && value.length > 0) return value;
	}
	return fallback;
}

export function getClientIp(socket: HasHandshake): string {
	return pickClientIp(socket.handshake.headers, socket.handshake.address);
}
