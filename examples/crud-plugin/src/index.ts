import { DatabaseSync } from "node:sqlite";

import { definePlugin } from "@balance/plugin-runtime";

import type { CrudPluginHandlers } from "../gen/plugin-handlers.js";

type NoteRow = {
  id: string;
  title: string;
  body: string;
  version: number;
};

let database: DatabaseSync | null = null;
const cache = new Map<string, NoteRow>();
let cacheHits = 0;

export default definePlugin<CrudPluginHandlers>({
  init(req, ctx) {
    const dbPath = req.config.dbPath;
    if (!dbPath) {
      return {
        outcome: {
          case: "error",
          value: {
            code: "missing_db_path",
            message: "Init config must include dbPath",
            details: {},
          },
        },
      };
    }

    database = new DatabaseSync(dbPath);
    database.exec(`
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        version INTEGER NOT NULL
      );
    `);

    return {
      outcome: {
        case: "ok",
        value: {
          pluginName: ctx.plugin.id,
          pluginVersion: `${ctx.plugin.version}:${req.environment}`,
        },
      },
    };
  },

  async createNote(req, ctx) {
    const db = requireDatabase();
    const note: NoteRow = {
      id: req.id,
      title: req.title,
      body: req.body,
      version: 1,
    };
    db.prepare(
      "INSERT OR REPLACE INTO notes (id, title, body, version) VALUES (?, ?, ?, ?)",
    ).run(note.id, note.title, note.body, note.version);
    cache.set(note.id, note);
    await ctx.kv.set("last_note_id", note.id);
    await bumpMutationCount(ctx);
    return { outcome: { case: "ok", value: note } };
  },

  async getNote(req) {
    const cached = cache.get(req.id);
    if (cached) {
      cacheHits += 1;
      return { outcome: { case: "ok", value: cached } };
    }

    const db = requireDatabase();
    const row = db.prepare(
      "SELECT id, title, body, version FROM notes WHERE id = ?",
    ).get(req.id) as NoteRow | undefined;

    if (!row) {
      return missingNote(req.id);
    }

    cache.set(row.id, row);
    return { outcome: { case: "ok", value: row } };
  },

  async updateNote(req, ctx) {
    const current = loadNote(req.id, false);
    if (current === null) {
      return missingNote(req.id);
    }

    const next: NoteRow = {
      ...current,
      title: req.title,
      body: req.body,
      version: current.version + 1,
    };

    const db = requireDatabase();
    db.prepare(
      "UPDATE notes SET title = ?, body = ?, version = ? WHERE id = ?",
    ).run(next.title, next.body, next.version, next.id);
    cache.set(next.id, next);
    await ctx.kv.set("last_note_id", next.id);
    await bumpMutationCount(ctx);
    return { outcome: { case: "ok", value: next } };
  },

  async deleteNote(req, ctx) {
    const db = requireDatabase();
    db.prepare("DELETE FROM notes WHERE id = ?").run(req.id);
    cache.delete(req.id);
    await ctx.kv.set("last_deleted_id", req.id);
    await bumpMutationCount(ctx);
    return {
      outcome: {
        case: "ok",
        value: {
          id: req.id,
        },
      },
    };
  },

  async listNotes() {
    const db = requireDatabase();
    const rows = db.prepare(
      "SELECT id, title, body, version FROM notes ORDER BY id ASC",
    ).all() as NoteRow[];

    for (const row of rows) {
      cache.set(row.id, row);
    }

    return {
      outcome: {
        case: "ok",
        value: {
          notes: rows,
          cacheHits,
        },
      },
    };
  },
});

async function bumpMutationCount(ctx: Parameters<CrudPluginHandlers["createNote"]>[1]) {
  const current = (await ctx.kv.get<number>("mutation_count")) ?? 0;
  await ctx.kv.set("mutation_count", current + 1);
}

function requireDatabase(): DatabaseSync {
  if (database === null) {
    throw new Error("Plugin database is not initialized. Call Init first.");
  }
  return database;
}

function loadNote(id: string, countCacheHit = true): NoteRow | null {
  const cached = cache.get(id);
  if (cached) {
    if (countCacheHit) {
      cacheHits += 1;
    }
    return cached;
  }

  const db = requireDatabase();
  const row = db.prepare(
    "SELECT id, title, body, version FROM notes WHERE id = ?",
  ).get(id) as NoteRow | undefined;
  if (!row) {
    return null;
  }
  cache.set(row.id, row);
  return row;
}

function missingNote(id: string) {
  return {
    outcome: {
      case: "error" as const,
      value: {
        code: "not_found",
        message: `Note ${id} was not found`,
        details: { id },
      },
    },
  };
}
