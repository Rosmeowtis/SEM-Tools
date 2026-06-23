"""SQLite 数据库 CRUD 操作。

使用 sqlite3 原生驱动，row_factory = sqlite3.Row 返回字典化行。
所有操作函数自动打开/关闭连接（短连接模式，适合 SQLite WAL）。
"""

import json
import sqlite3
from studio.config import DB_PATH


def get_db() -> sqlite3.Connection:
    """获取 SQLite 连接（启用外键约束，行工厂为 dict-like Row）。"""
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


CREATE_RESOURCES_SQL = """
CREATE TABLE IF NOT EXISTS resources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sha1 TEXT NOT NULL,
    project_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    ext TEXT NOT NULL,
    size INTEGER NOT NULL,
    imported_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
"""


def init_db():
    """初始化数据库表结构。幂等操作（CREATE TABLE IF NOT EXISTS）。

    - projects: 项目主表
    - resources: 资源表，外键关联 projects，级联删除
    - chains: 处理链表，外键关联 projects，级联删除
    """
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
        """
    )
    # resources 表先不创建 — 需要检测旧 schema 做迁移
    cur = conn.execute("PRAGMA table_info(resources)")
    cols = {row[1] for row in cur.fetchall()}
    if "id" not in cols:
        # 旧 schema：sha1 为主键 → 迁移到新 schema
        if cols:  # 表存在但无 id 列
            conn.executescript("ALTER TABLE resources RENAME TO _resources_old")
        conn.executescript(CREATE_RESOURCES_SQL)
        if cols:
            conn.executescript(
                """
                INSERT INTO resources (sha1, project_id, filename, ext, size, imported_at)
                    SELECT sha1, project_id, filename, ext, size, imported_at FROM _resources_old;
                DROP TABLE _resources_old;
                """
            )
    else:
        conn.executescript(CREATE_RESOURCES_SQL)
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS chains (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            name TEXT NOT NULL,
            resource_ids_json TEXT DEFAULT '[]',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        """
    )
    conn.commit()
    conn.close()


# --- Project CRUD ---


def list_projects() -> list[dict]:
    """查询全部项目，按创建时间倒序。"""
    conn = get_db()
    rows = conn.execute("SELECT * FROM projects ORDER BY created_at DESC").fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_project(pid: str) -> dict | None:
    """按 ID 查询单个项目，不存在返回 None。"""
    conn = get_db()
    row = conn.execute("SELECT * FROM projects WHERE id = ?", (pid,)).fetchone()
    conn.close()
    return dict(row) if row else None


def create_project(pid: str, slug: str, title: str, note: str, ts: str) -> dict:
    """创建项目并返回新记录。"""
    conn = get_db()
    conn.execute(
        "INSERT INTO projects (id, slug, title, note, created_at, updated_at) VALUES (?,?,?,?,?,?)",
        (pid, slug, title, note, ts, ts),
    )
    conn.commit()
    conn.close()
    return {
        "id": pid,
        "slug": slug,
        "title": title,
        "note": note,
        "created_at": ts,
        "updated_at": ts,
    }


def update_project(
    pid: str, title: str | None, note: str | None, ts: str
) -> dict | None:
    """更新项目标题/备注。返回更新后的记录，不存在返回 None。

    若 title 不为 None 则重新生成 slug。
    """
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
    return {
        "id": pid,
        "slug": new_slug,
        "title": new_title,
        "note": new_note,
        "created_at": existing["created_at"],
        "updated_at": ts,
    }


def delete_project(pid: str) -> bool:
    """删除项目及关联资源/链。返回是否实际删除。"""
    conn = get_db()
    cur = conn.execute("DELETE FROM projects WHERE id = ?", (pid,))
    conn.commit()
    conn.close()
    return cur.rowcount > 0


# --- Resource CRUD ---


def list_resources(pid: str) -> list[dict]:
    """查询项目下所有资源，按导入时间倒序。"""
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM resources WHERE project_id = ? ORDER BY imported_at DESC",
        (pid,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_resource(sha1: str, pid: str) -> dict | None:
    """按 SHA1 + 项目 ID 查询单个资源（返回最新的）。"""
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM resources WHERE sha1 = ? AND project_id = ? ORDER BY id DESC LIMIT 1",
        (sha1, pid),
    ).fetchone()
    conn.close()
    return dict(row) if row else None


def add_resource(
    sha1: str, pid: str, filename: str, ext: str, size: int, ts: str
) -> dict:
    """记录新资源到数据库，返回含自增 id 的记录。"""
    conn = get_db()
    cur = conn.execute(
        "INSERT INTO resources (sha1, project_id, filename, ext, size, imported_at) VALUES (?,?,?,?,?,?)",
        (sha1, pid, filename, ext, size, ts),
    )
    rid = cur.lastrowid
    conn.commit()
    conn.close()
    return {
        "id": rid,
        "sha1": sha1,
        "project_id": pid,
        "filename": filename,
        "ext": ext,
        "size": size,
        "imported_at": ts,
    }


def delete_resource(sha1: str, pid: str) -> bool:
    """删除项目下的资源记录。返回是否实际删除。"""
    conn = get_db()
    cur = conn.execute(
        "DELETE FROM resources WHERE sha1 = ? AND project_id = ?", (sha1, pid)
    )
    conn.commit()
    conn.close()
    return cur.rowcount > 0


def count_resources_by_sha1(sha1: str) -> int:
    """查询跨项目有多少条记录引用该 SHA1（用于判断是否可删磁盘文件）。"""
    conn = get_db()
    row = conn.execute(
        "SELECT COUNT(*) AS cnt FROM resources WHERE sha1 = ?", (sha1,)
    ).fetchone()
    conn.close()
    return row["cnt"]


# --- Chain CRUD ---


def get_chain(pid: str, cid: str) -> dict | None:
    """按项目 ID + 链 ID 查询链记录。"""
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM chains WHERE id = ? AND project_id = ?", (cid, pid)
    ).fetchone()
    conn.close()
    return dict(row) if row else None


def list_chains(pid: str) -> list[dict]:
    """查询项目下所有链，按创建时间倒序。"""
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM chains WHERE project_id = ? ORDER BY created_at DESC", (pid,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def create_chain(
    pid: str, cid: str, name: str, resource_ids: list[str], ts: str
) -> dict:
    """创建新链记录（resource_ids 以 JSON 串存储）。"""
    conn = get_db()
    conn.execute(
        "INSERT INTO chains (id, project_id, name, resource_ids_json, created_at, updated_at) VALUES (?,?,?,?,?,?)",
        (cid, pid, name, json.dumps(resource_ids), ts, ts),
    )
    conn.commit()
    conn.close()
    return {
        "id": cid,
        "project_id": pid,
        "name": name,
        "resource_ids": resource_ids,
        "created_at": ts,
        "updated_at": ts,
    }


def update_chain(
    cid: str, name: str | None, resource_ids_json: str | None, ts: str
) -> dict | None:
    """更新链名称或资源绑定。返回更新后的记录，不存在返回 None。"""
    conn = get_db()
    existing = conn.execute("SELECT * FROM chains WHERE id = ?", (cid,)).fetchone()
    if not existing:
        conn.close()
        return None
    new_name = name if name is not None else existing["name"]
    new_rids = (
        resource_ids_json
        if resource_ids_json is not None
        else existing["resource_ids_json"]
    )
    conn.execute(
        "UPDATE chains SET name=?, resource_ids_json=?, updated_at=? WHERE id=?",
        (new_name, new_rids, ts, cid),
    )
    conn.commit()
    conn.close()
    return {
        **dict(existing),
        "name": new_name,
        "resource_ids": json.loads(new_rids),
        "updated_at": ts,
    }


def delete_chain(pid: str, cid: str) -> bool:
    """删除链记录。返回是否实际删除。"""
    conn = get_db()
    cur = conn.execute("DELETE FROM chains WHERE id = ? AND project_id = ?", (cid, pid))
    conn.commit()
    conn.close()
    return cur.rowcount > 0
