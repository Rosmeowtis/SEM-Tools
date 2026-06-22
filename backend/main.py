import hashlib
import json
import shutil
from pathlib import Path

import cv2
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from database import (
    add_resource,
    create_project as db_create_project,
    delete_project as db_delete_project,
    delete_resource as db_delete_resource,
    get_project as db_get_project,
    get_resource as db_get_resource,
    init_db,
    list_projects as db_list_projects,
    list_resources as db_list_resources,
    update_project as db_update_project,
)
from studio.config import DATA_DIR, THUMB_CACHE_DIR
from studio.models import (
    Project,
    ProjectCreate,
    ProjectUpdate,
    ResourceMeta,
    new_id,
    now,
    slugify,
)

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    THUMB_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    init_db()


def _project_dir(pid: str, slug: str) -> Path:
    return DATA_DIR / "projects" / f"{pid}-{slug}"


def _generate_thumbnail(src: str | Path, sha1: str):
    img = cv2.imread(str(src))
    if img is None:
        return
    h, w = img.shape[:2]
    scale = 200 / max(h, w) if max(h, w) > 200 else 1.0
    if scale < 1:
        img = cv2.resize(img, (int(w * scale), int(h * scale)))
    cv2.imwrite(str(THUMB_CACHE_DIR / f"{sha1}.jpg"), img)


# --- Project routes ---

@app.get("/api/projects")
def list_projects():
    return db_list_projects()


@app.post("/api/projects")
def create_project(data: ProjectCreate):
    pid = new_id()
    slug = slugify(data.title)
    ts = now()
    (DATA_DIR / "projects" / f"{pid}-{slug}" / "resources" / "original").mkdir(parents=True, exist_ok=True)
    return db_create_project(pid, slug, data.title, data.note, ts)


@app.get("/api/projects/{pid}")
def get_project(pid: str):
    p = db_get_project(pid)
    if not p:
        raise HTTPException(404, "Project not found")
    return p


@app.patch("/api/projects/{pid}")
def patch_project(pid: str, data: ProjectUpdate):
    p = db_update_project(pid, data.title, data.note, now())
    if not p:
        raise HTTPException(404, "Project not found")
    return p


@app.delete("/api/projects/{pid}")
def delete_project(pid: str):
    p = db_get_project(pid)
    if not p:
        raise HTTPException(404, "Project not found")
    ok = db_delete_project(pid)
    # ponytail: no project.json mirror, just clean filesystem
    proj_dir = _project_dir(pid, p["slug"])
    if proj_dir.exists():
        shutil.rmtree(proj_dir)
    return {"deleted": ok}


# --- Resource routes ---

@app.get("/api/projects/{pid}/resources")
def list_resources(pid: str):
    return db_list_resources(pid)


@app.post("/api/projects/{pid}/resources")
async def upload_resource(pid: str, file: UploadFile = File(...)):
    project = db_get_project(pid)
    if not project:
        raise HTTPException(404, "Project not found")

    content = await file.read()
    sha1 = hashlib.sha1(content).hexdigest()
    ext = Path(file.filename).suffix.lstrip(".") if file.filename else "png"
    ts = now()

    # ponytail: per-project storage, no cross-project dedup
    orig_dir = _project_dir(pid, project["slug"]) / "resources" / "original"
    orig_dir.mkdir(parents=True, exist_ok=True)
    dest = orig_dir / f"{sha1}.{ext}"
    if not dest.exists():
        dest.write_bytes(content)

    _generate_thumbnail(dest, sha1)
    return add_resource(sha1, pid, file.filename or "untitled", ext, len(content), ts)


@app.get("/api/projects/{pid}/resources/{sha1}")
def get_resource(pid: str, sha1: str):
    r = db_get_resource(sha1)
    if not r or r["project_id"] != pid:
        raise HTTPException(404, "Resource not found")
    return r


@app.get("/api/projects/{pid}/resources/{sha1}/thumb")
def get_thumbnail(pid: str, sha1: str):
    r = db_get_resource(sha1)
    if not r or r["project_id"] != pid:
        raise HTTPException(404, "Resource not found")
    thumb = THUMB_CACHE_DIR / f"{sha1}.jpg"
    if not thumb.exists():
        raise HTTPException(404, "Thumbnail not found")
    return FileResponse(thumb, media_type="image/jpeg")


@app.delete("/api/projects/{pid}/resources/{sha1}")
def delete_resource(pid: str, sha1: str):
    project = db_get_project(pid)
    if not project:
        raise HTTPException(404, "Project not found")
    r = db_get_resource(sha1)
    if not r or r["project_id"] != pid:
        raise HTTPException(404, "Resource not found")

    db_delete_resource(sha1)

    orig = (
        _project_dir(pid, project["slug"])
        / "resources" / "original" / f"{sha1}.{r['ext']}"
    )
    if orig.exists():
        orig.unlink()

    thumb = THUMB_CACHE_DIR / f"{sha1}.jpg"
    if thumb.exists():
        thumb.unlink()

    return {"deleted": True}
