import type {
	ClientToServerEvents,
	ServerToClientEvents,
	SocketData,
} from "@typeordie/shared";
import type { Server, Socket } from "socket.io";
import { setupConnectionHandlers } from "./connectionHandlers.js";
import { setupGameFlowHandlers } from "./gameFlowHandlers.js";
import { setupPlayerActionHandlers } from "./playerActionHandlers.js";
import { setupRoomLifecycleHandlers } from "./roomLifecycleHandlers.js";

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

export default function setupSocketHandlers(io: TypedServer) {
	io.on("connection", (socket) => {
		// Socket.io's generic inference loses the typed overloads without this cast
		const typedSocket = socket as TypedSocket;

		setupRoomLifecycleHandlers(io, typedSocket);
		setupGameFlowHandlers(io, typedSocket);
		setupPlayerActionHandlers(io, typedSocket);
		setupConnectionHandlers(io, typedSocket);
	});

	return io;
}
