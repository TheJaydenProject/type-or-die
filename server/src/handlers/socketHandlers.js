import { setupRoomLifecycleHandlers } from './roomLifecycleHandlers.js';
import { setupGameFlowHandlers } from './gameFlowHandlers.js';
import { setupPlayerActionHandlers } from './playerActionHandlers.js';
import { setupConnectionHandlers } from './connectionHandlers.js';

export default function setupSocketHandlers(io) {
  io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);

    setupRoomLifecycleHandlers(io, socket);
    setupGameFlowHandlers(io, socket);
    setupPlayerActionHandlers(io, socket);
    setupConnectionHandlers(io, socket);
  });

  return io;
}
