import crypto from "node:crypto";
import { createClient } from "redis";
import pg from "pg";

const { Pool } = pg;

export class RoomStore {
  constructor({ redisUrl = "", databaseUrl = "" } = {}) {
    this.redisUrl = redisUrl;
    this.databaseUrl = databaseUrl;
    this.memory = new Map();
    this.redis = null;
    this.redisLock = null;
    this.db = null;
    this.localLocks = new Map();
  }

  async connect() {
    if (this.redisUrl) {
      this.redis = createClient({ url: this.redisUrl });
      this.redisLock = this.redis.duplicate();

      this.redis.on("error", error => console.error("Redis data client error", error));
      this.redisLock.on("error", error => console.error("Redis lock client error", error));

      await Promise.all([
        this.redis.connect(),
        this.redisLock.connect(),
      ]);
    }

    if (this.databaseUrl) {
      this.db = new Pool({
        connectionString: this.databaseUrl,
        ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
        max: 6,
        idleTimeoutMillis: 30_000,
      });
      await this.db.query(`
        CREATE TABLE IF NOT EXISTS mafia_rooms (
          code VARCHAR(12) PRIMARY KEY,
          state JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await this.db.query(`CREATE INDEX IF NOT EXISTS mafia_rooms_updated_idx ON mafia_rooms(updated_at)`);
    }
  }

  key(code) { return `mafia:room:${code}`; }

  async withRoomLock(code, operation, { waitMs = 20_000, leaseMs = 60_000 } = {}) {
    const normalizedCode = String(code || "").trim().toUpperCase();
    if (!normalizedCode) throw new Error("INVALID_ROOM_CODE");

    // Always serialize mutations for the same room inside this Node process first.
    // This prevents two commands from the same server from racing while Redis is
    // under heavy load. Redis is then used as a second, distributed lock layer.
    const previous = this.localLocks.get(normalizedCode) || Promise.resolve();
    let releaseCurrent;
    const currentGate = new Promise(resolve => { releaseCurrent = resolve; });
    const queued = previous.then(() => currentGate);
    this.localLocks.set(normalizedCode, queued);

    await previous;

    try {
      if (this.redisLock) {
        const lockKey = `mafia:lock:${normalizedCode}`;
        const token = crypto.randomUUID();
        const deadline = Date.now() + waitMs;
        let acquired = false;

        while (Date.now() < deadline) {
          const reply = await this.redisLock.set(lockKey, token, { NX: true, PX: leaseMs });
          if (reply) {
            acquired = true;
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 35));
        }

        if (!acquired) throw new Error("ROOM_BUSY");

        try {
          return await operation();
        } finally {
          try {
            await this.redisLock.eval(
              `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
              { keys: [lockKey], arguments: [token] },
            );
          } catch (error) {
            console.error("Redis room lock release error", error);
          }
        }
      }

      // PostgreSQL advisory locks protect mutations across multiple Node processes
      // when Redis is not configured.
      if (this.db) {
        const client = await this.db.connect();
        const lockName = `mafia:${normalizedCode}`;
        try {
          await client.query("SELECT pg_advisory_lock(hashtext($1))", [lockName]);
          return await operation();
        } finally {
          try {
            await client.query("SELECT pg_advisory_unlock(hashtext($1))", [lockName]);
          } finally {
            client.release();
          }
        }
      }

      return await operation();
    } finally {
      releaseCurrent();
      if (this.localLocks.get(normalizedCode) === queued) {
        this.localLocks.delete(normalizedCode);
      }
    }
  }

  async get(code) {
    if (this.redis) {
      const raw = await this.redis.get(this.key(code));
      if (raw) return JSON.parse(raw);
    }

    if (this.db) {
      const result = await this.db.query("SELECT state FROM mafia_rooms WHERE code = $1", [code]);
      if (result.rows[0]?.state) {
        const room = result.rows[0].state;
        if (this.redis) await this.redis.set(this.key(code), JSON.stringify(room), { EX: 60 * 60 * 12 });
        return room;
      }
    }

    return structuredClone(this.memory.get(code) || null);
  }

  async set(room) {
    const cloned = structuredClone(room);
    this.memory.set(room.code, cloned);
    if (this.redis) await this.redis.set(this.key(room.code), JSON.stringify(room), { EX: 60 * 60 * 12 });
    if (this.db) {
      await this.db.query(
        `INSERT INTO mafia_rooms(code, state, updated_at) VALUES($1, $2::jsonb, NOW())
         ON CONFLICT(code) DO UPDATE SET state = EXCLUDED.state, updated_at = NOW()`,
        [room.code, JSON.stringify(room)],
      );
    }
    return room;
  }

  async delete(code) {
    this.memory.delete(code);
    if (this.redis) await this.redis.del(this.key(code));
    if (this.db) await this.db.query("DELETE FROM mafia_rooms WHERE code = $1", [code]);
  }
}
