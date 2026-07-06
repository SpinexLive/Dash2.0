'use client';
import { io, Socket } from 'socket.io-client';
import { apiUrl } from './api';

let socket: Socket | null = null;

/** Shared Socket.IO connection to the API realtime gateway. */
export function getSocket(): Socket {
  if (!socket) {
    socket = io(apiUrl, { withCredentials: true, transports: ['websocket'] });
  }
  return socket;
}
