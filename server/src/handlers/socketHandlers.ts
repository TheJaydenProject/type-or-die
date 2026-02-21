import { Server, Socket } from 'socket.io';
import {
  ServerToClientEvents,
  ClientToServerEvents,
  SocketData
} from '@typeordie/shared';

import { setupRoomLifecycleHandlers } from './roomLifecycleHandlers.js';
import { setupGameFlowHandlers } from './gameFlowHandlers.js';
import { setupPlayerActionHandlers } from './playerActionHandlers.js';
import { setupConnectionHandlers } from './connectionHandlers.js';

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents, {}, SocketData>;
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, {}, SocketData>;

export default function setupSocketHandlers(io: TypedServer) {
  io.on('connection', (socket) => {
    // Socket.io's generic inference loses the typed overloads without this cast
    const typedSocket = socket as TypedSocket;

    setupRoomLifecycleHandlers(io, typedSocket);
    setupGameFlowHandlers(io, typedSocket);
    setupPlayerActionHandlers(io, typedSocket);
    setupConnectionHandlers(io, typedSocket);
  });

  return io;
}
