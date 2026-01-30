import { Server, Socket } from 'socket.io';
import { 
  ServerToClientEvents, 
  ClientToServerEvents, 
  SocketData 
} from '@typeordie/shared';

// Import your converted TS handlers
// Note: In Node.js ESM with TypeScript, we keep the .js extension in imports
import { setupRoomLifecycleHandlers } from './roomLifecycleHandlers.js';
import { setupGameFlowHandlers } from './gameFlowHandlers.js';
import { setupPlayerActionHandlers } from './playerActionHandlers.js';
import { setupConnectionHandlers } from './connectionHandlers.js';

// Define the Typed IO Server and Socket
type TypedServer = Server<ClientToServerEvents, ServerToClientEvents, {}, SocketData>;
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, {}, SocketData>;

export default function setupSocketHandlers(io: TypedServer) {
  io.on('connection', (socket) => {
    // Cast socket to TypedSocket so the handlers accept it
    // (Socket.io's default type inference sometimes needs this explicit cast)
    const typedSocket = socket as TypedSocket;

    setupRoomLifecycleHandlers(io, typedSocket);
    setupGameFlowHandlers(io, typedSocket);
    setupPlayerActionHandlers(io, typedSocket);
    setupConnectionHandlers(io, typedSocket);
  });

  return io;
}