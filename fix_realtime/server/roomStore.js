import { createClient } from "redis";
import pg from "pg";

const { Pool } = pg;

export class RoomStore {
  constructor({ redisUrl = "", databaseUrl = "" } = {}) {
    this.redisUrl = redisUrl;
    this.databaseUrl = databaseUrl;
    this.memory = new Map();
    this.redis = null;
    this.db = null;
  }

  async connect() {
    if (this.redisUrl) {
      this.redis = createClient({ url: this.redisUrl });
      this.redis.on("error", error => console.error("Redis error", error));
      await this.redis.connect();
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
      void this.db.query(
        `INSERT INTO mafia_rooms(code, state, updated_at) VALUES($1, $2::jsonb, NOW())
         ON CONFLICT(code) DO UPDATE SET state = EXCLUDED.state, updated_at = NOW()`,
        [room.code, JSON.stringify(room)],
      ).catch(error => console.error("Postgres persistence error", error));
    }
    return room;
  }

  async delete(code) {
    this.memory.delete(code);
    if (this.redis) await this.redis.del(this.key(code));
    if (this.db) await this.db.query("DELETE FROM mafia_rooms WHERE code = $1", [code]);
  }
}
