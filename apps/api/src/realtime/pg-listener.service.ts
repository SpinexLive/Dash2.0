import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Client } from 'pg';
import type { RealtimeEvent } from '@hll/shared';
import { RealtimeGateway } from './realtime.gateway';

/**
 * Listens to PostgreSQL `NOTIFY` events (emitted by DB triggers) and
 * forwards them to connected WebSocket clients. This powers the
 * auto-refresh member list and live roster updates.
 */
@Injectable()
export class PgListenerService implements OnModuleInit, OnModuleDestroy {
  private client?: Client;

  constructor(private readonly gateway: RealtimeGateway) {}

  async onModuleInit() {
    this.client = new Client({ connectionString: process.env.DATABASE_URL });
    await this.client.connect();
    await this.client.query('LISTEN events');

    this.client.on('notification', (msg) => {
      if (!msg.payload) return;
      try {
        const event = JSON.parse(msg.payload) as RealtimeEvent;
        this.gateway.emit(event);
      } catch {
        // ignore malformed payloads
      }
    });
  }

  async onModuleDestroy() {
    await this.client?.end();
  }
}
