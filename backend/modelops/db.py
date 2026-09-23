"""Small SQLite document repository with indexed request/run relations."""

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path


def dumps(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


class Database:
    TABLES = {"models", "datasets", "runs", "requests"}

    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA user_version=1")
            for name in self.TABLES:
                conn.execute(f"CREATE TABLE IF NOT EXISTS {name} (id TEXT PRIMARY KEY, data TEXT NOT NULL)")
            conn.execute("CREATE INDEX IF NOT EXISTS request_run ON requests(json_extract(data,'$.run_id'))")
            conn.execute(
                "CREATE INDEX IF NOT EXISTS request_created ON requests(json_extract(data,'$.created_at'))"
            )

    @contextmanager
    def connect(self):
        conn = sqlite3.connect(self.path, timeout=10)
        try:
            conn.execute("PRAGMA busy_timeout=10000")
            yield conn
            conn.commit()
        except BaseException:
            conn.rollback()
            raise
        finally:
            conn.close()

    def table(self, table):
        if table not in self.TABLES:
            raise ValueError("Unknown table")
        return table

    def get(self, table, key):
        with self.connect() as conn:
            row = conn.execute(f"SELECT data FROM {self.table(table)} WHERE id=?", (key,)).fetchone()
        return json.loads(row[0]) if row else None

    def put(self, table, value):
        with self.connect() as conn:
            conn.execute(
                f"INSERT INTO {self.table(table)}(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
                (value["id"], dumps(value)),
            )
        return value

    def all(self, table):
        with self.connect() as conn:
            rows = conn.execute(f"SELECT data FROM {self.table(table)} ORDER BY rowid DESC").fetchall()
        return [json.loads(row[0]) for row in rows]

    def delete(self, table, key):
        with self.connect() as conn:
            conn.execute(f"DELETE FROM {self.table(table)} WHERE id=?", (key,))

    def requests(self, *, run_id=None, model_id=None, status=None, limit=None):
        clauses, params = [], []
        for field, value in [("run_id", run_id), ("model_id", model_id), ("status", status)]:
            if value:
                clauses.append(f"json_extract(data,'$.{field}')=?")
                params.append(value)
        sql = "SELECT data FROM requests"
        if clauses:
            sql += " WHERE " + " AND ".join(clauses)
        sql += " ORDER BY rowid DESC"
        if limit is not None:
            sql += " LIMIT ?"
            params.append(limit)
        with self.connect() as conn:
            return [json.loads(row[0]) for row in conn.execute(sql, params).fetchall()]

    def set_default(self, model_id):
        with self.connect() as conn:
            for row in conn.execute("SELECT data FROM models").fetchall():
                model = json.loads(row[0])
                model["is_default"] = model["id"] == model_id
                conn.execute("UPDATE models SET data=? WHERE id=?", (dumps(model), model["id"]))
