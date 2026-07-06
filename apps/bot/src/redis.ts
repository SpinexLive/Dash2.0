import Redis from 'ioredis';

export const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
// Separate connection for subscriptions (ioredis requires a dedicated subscriber).
export const subscriber = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
