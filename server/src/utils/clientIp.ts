import type { IncomingHttpHeaders } from "node:http";

interface HasHandshake {
	handshake: { address: string; headers: IncomingHttpHeaders };
}

// handshake.address is nginx's container IP, which would put every visitor in one
// rate-limit bucket. nginx (client/nginx.conf) sets X-Real-IP to the visitor's IP
// from Cloudflare's CF-Connecting-IP. The backend publishes no port, so only nginx
// can reach it and outsiders cannot forge this header.
export function getClientIp(socket: HasHandshake): string {
	const realIp = socket.handshake.headers["x-real-ip"];
	if (typeof realIp === "string" && realIp.length > 0) return realIp;
	return socket.handshake.address;
}
