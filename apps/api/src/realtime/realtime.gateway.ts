import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';
import type { RealtimeEvent } from '@hll/shared';

@WebSocketGateway({
  cors: { origin: process.env.WEB_PUBLIC_URL ?? 'http://localhost:3000', credentials: true },
})
export class RealtimeGateway {
  @WebSocketServer()
  server!: Server;

  /** Broadcast a real-time event to all connected dashboard clients. */
  emit(event: RealtimeEvent) {
    this.server.emit(event.type, event);
  }
}
