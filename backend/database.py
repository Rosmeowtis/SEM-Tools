import sqlite3
from studio.config import DB_PATH


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    conn = get_db()
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            slug TEXT NOT NULL,
            title TEXT NOT NULL,
            note TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS resources (
            sha1 TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            filename TEXT NOT NULL,
            ext TEXT NOT NULL,
            size INTEGER NOT NULL,
            imported_at TEXT NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        """
    )
    conn.commit()
    conn.close()


def list_projects():
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM projects ORDER BY created_at DESC"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_project(pid: str) -> dict | None:
    conn = get_db()
    row = conn.execute("SELECT * FROM projects WHERE id = ?", (pid,)).fetchone()
    conn.close()
    return dict(row) if row else None


def create_project(pid: str, slug: str, title: str, note: str, ts: str) -> dict:
    conn = get_db()
    conn.execute(
        "INSERT INTO projects (id, slug, title, note, created_at, updated_at) VALUES (?,?,?,?,?,?)",
        (pid, slug, title, note, ts, ts),
    )
    conn.commit()
    conn.close()
    return {"id": pid, "slug": slug, "title": title, "note": note, "created_at": ts, "updated_at": ts}


def update_project(pid: str, title: str | None, note: str | None, ts: str) -> dict | None:
    conn = get_db()
    existing = conn.execute("SELECT * FROM projects WHERE id = ?", (pid,)).fetchone()
    if not existing:
        conn.close()
        return None
    new_title = title if title is not None else existing["title"]
    new_note = note if note is not None else existing["note"]
    new_slug = existing["slug"]
    if title is not None:
        from studio.models import slugify
        new_slug = slugify(new_title)
    conn.execute(
        "UPDATE projects SET title=?, note=?, slug=?, updated_at=? WHERE id=?",
        (new_title, new_note, new_slug, ts, pid),
    )
    conn.commit()
    conn.close()
    return {"id": pid, "slug": new_slug, "title": new_title, "note": new_note,
            "created_at": existing["created_at"], "updated_at": ts}


def delete_project(pid: str) -> bool:
    conn = get_db()
    cur = conn.execute("DELETE FROM projects WHERE id = ?", (pid,))
    conn.commit()
    conn.close()
    return cur.rowcount > 0


def list_resources(pid: str) -> list[dict]:
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM resources WHERE project_id = ? ORDER BY imported_at DESC",
        (pid,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_resource(sha1: str) -> dict | None:
    conn = get_db()
    row = conn.execute("SELECT * FROM resources WHERE sha1 = ?", (sha1,)).fetchone()
    conn.close()
    return dict(row) if row else None


def add_resource(sha1: str, pid: str, filename: str, ext: str, size: int, ts: str) -> dict:
    conn = get_db()
    conn.execute(
        "INSERT INTO resources (sha1, project_id, filename, ext, size, imported_at) VALUES (?,?,?,?,?,?)",
        (sha1, pid, filename, ext, size, ts),
    )
    conn.commit()
    conn.close()
    return {"sha1": sha1, "project_id": pid, "filename": filename, "ext": ext, "size": size, "imported_at": ts}


def delete_resource(sha1: str) -> bool:
    conn = get_db()
    cur = conn.execute("DELETE FROM resources WHERE sha1 = ?", (sha1,))
    conn.commit()
    conn.close()
    return cur.rowcount > 0
