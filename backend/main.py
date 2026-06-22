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
    create_chain as db_create_chain,
    create_project as db_create_project,
    delete_chain as db_delete_chain,
    delete_project as db_delete_project,
    delete_resource as db_delete_resource,
    get_chain as db_get_chain,
    get_project as db_get_project,
    get_resource as db_get_resource,
    init_db,
    list_chains as db_list_chains,
    list_projects as db_list_projects,
    list_resources as db_list_resources,
    update_chain as db_update_chain,
    update_project as db_update_project,
)
from studio.config import DATA_DIR, THUMB_CACHE_DIR
from studio.models import (
    ChainCreate,
    ChainUpdate,
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


# --- Chain routes ---

def _chain_file(pid: str, slug: str, cid: str) -> Path:
    return DATA_DIR / "projects" / f"{pid}-{slug}" / "chains" / f"{cid}.json"


@app.get("/api/projects/{pid}/chains")
def list_chains(pid: str):
    p = db_get_project(pid)
    if not p:
        raise HTTPException(404, "Project not found")
    chains = db_list_chains(pid)
    for c in chains:
        cf = _chain_file(pid, p["slug"], c["id"])
        if cf.exists():
            c["operations"] = json.loads(cf.read_text())
        else:
            c["operations"] = []
        c["resource_ids"] = json.loads(c["resource_ids_json"])
        del c["resource_ids_json"]
    return chains


@app.post("/api/projects/{pid}/chains")
def create_chain(pid: str, data: ChainCreate):
    p = db_get_project(pid)
    if not p:
        raise HTTPException(404, "Project not found")
    cid = new_id()
    ts = now()
    chain = db_create_chain(pid, cid, data.name, data.resource_ids, ts)
    (DATA_DIR / "projects" / f"{pid}-{p['slug']}" / "chains").mkdir(parents=True, exist_ok=True)
    _chain_file(pid, p["slug"], cid).write_text("[]")
    chain["operations"] = []
    return chain


@app.get("/api/projects/{pid}/chains/{cid}")
def get_chain(pid: str, cid: str):
    p = db_get_project(pid)
    if not p:
        raise HTTPException(404, "Project not found")
    chain = db_get_chain(pid, cid)
    if not chain:
        raise HTTPException(404, "Chain not found")
    cf = _chain_file(pid, p["slug"], cid)
    operations = json.loads(cf.read_text()) if cf.exists() else []
    chain["resource_ids"] = json.loads(chain["resource_ids_json"])
    del chain["resource_ids_json"]
    chain["operations"] = operations
    return chain


@app.patch("/api/projects/{pid}/chains/{cid}")
def patch_chain(pid: str, cid: str, data: ChainUpdate):
    p = db_get_project(pid)
    if not p:
        raise HTTPException(404, "Project not found")
    rids_json = json.dumps(data.resource_ids) if data.resource_ids is not None else None
    chain = db_update_chain(cid, data.name, rids_json, now())
    if not chain:
        raise HTTPException(404, "Chain not found")
    if data.operations is not None:
        _chain_file(pid, p["slug"], cid).write_text(
            json.dumps([op.model_dump(mode="json") for op in data.operations])
        )
    cf = _chain_file(pid, p["slug"], cid)
    operations = json.loads(cf.read_text()) if cf.exists() else []
    chain["operations"] = operations
    return chain


@app.delete("/api/projects/{pid}/chains/{cid}")
def delete_chain(pid: str, cid: str):
    p = db_get_project(pid)
    if not p:
        raise HTTPException(404, "Project not found")
    chain = db_get_chain(pid, cid)
    if not chain:
        raise HTTPException(404, "Chain not found")
    ok = db_delete_chain(pid, cid)
    cf = _chain_file(pid, p["slug"], cid)
    if cf.exists():
        cf.unlink()
    return {"deleted": ok}
