"""FastAPI 应用 — REST API 路由定义。

路由路径与核心实体关系：

```
/api/projects                    → Project CRUD
/api/projects/:pid/resources     → Resource 上传/浏览/删除 (SHA1 去重)
/api/projects/:pid/chains        → Chain CRUD (operations 存 JSON 文件)
/api/projects/:pid/chains/:cid/
  execute     → 全量执行 (所有资源)
  export      → ZIP 下载
/api/presets                     → Preset CRUD
```
"""

import hashlib
import json
import shutil
import urllib.parse
from contextlib import asynccontextmanager
from pathlib import Path

import cv2
from loguru import logger
from studio.config import DATA_DIR
from database import (
    add_resource,
    count_resources_by_sha1,
    init_db,
)
from database import (
    create_chain as db_create_chain,
)
from database import (
    create_project as db_create_project,
)
from database import (
    delete_chain as db_delete_chain,
)
from database import (
    delete_project as db_delete_project,
)
from database import (
    delete_resource as db_delete_resource,
)
from database import (
    get_chain as db_get_chain,
)
from database import (
    get_project as db_get_project,
)
from database import (
    get_resource as db_get_resource,
)
from database import (
    list_chains as db_list_chains,
)
from database import (
    list_projects as db_list_projects,
)
from database import (
    list_resources as db_list_resources,
)
from database import (
    update_chain as db_update_chain,
)

from engine import (
    execute_and_preview,
    execute_chain,
    load_image,
    save_image,
)
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from studio.config import THUMB_CACHE_DIR
from studio.models import (
    ChainCreate,
    ChainUpdate,
    ExecuteBody,
    ExportBody,
    PresetCreate,
    PresetUpdate,
    ProjectCreate,
    new_id,
    now,
    slugify,
)

logger.add(
    DATA_DIR / "logs" / "app.log",
    rotation="1 MB",
    retention=3,
    level="INFO",
    format="{time:YYYY-MM-DD HH:mm:ss} | {level:<7} | {message}",
)

PRESETS_DIR = DATA_DIR / "presets"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """应用启动时创建数据目录并初始化数据库表。"""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "logs").mkdir(parents=True, exist_ok=True)
    THUMB_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    init_db()
    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _project_dir(pid: str, slug: str) -> Path:
    """返回项目的文件系统存储路径。"""
    return DATA_DIR / "projects" / f"{pid}-{slug}"


def _generate_thumbnail(src: str | Path, sha1: str):
    """为资源生成 200px 缩略图。"""
    img = load_image(Path(src))
    h, w = img.shape[:2]
    scale = 200 / max(h, w) if max(h, w) > 200 else 1.0
    if scale < 1:
        img = cv2.resize(img, (int(w * scale), int(h * scale)))
    save_image(img, THUMB_CACHE_DIR / f"{sha1}.jpg")


# --- Project routes ---


@app.get("/api/projects")
def list_projects():
    """列出所有项目，按创建时间倒序。"""
    return db_list_projects()


@app.post("/api/projects")
def create_project(data: ProjectCreate):
    """创建新项目（生成 ID + slug + 文件系统目录）。"""
    pid = new_id()
    slug = slugify(data.title)
    ts = now()
    (DATA_DIR / "projects" / f"{pid}-{slug}" / "resources" / "original").mkdir(
        parents=True, exist_ok=True
    )
    return db_create_project(pid, slug, data.title, ts)


@app.delete("/api/projects/{pid}")
def delete_project(pid: str):
    """删除项目及其文件系统目录。"""
    p = db_get_project(pid)
    if not p:
        raise HTTPException(404, "Project not found")
    ok = db_delete_project(pid)
    proj_dir = _project_dir(pid, p["slug"])
    if proj_dir.exists():
        shutil.rmtree(proj_dir)
    return {"deleted": ok}


# --- Resource routes ---


@app.get("/api/projects/{pid}/resources")
def list_resources(pid: str):
    """列出项目下所有资源，按导入时间倒序。"""
    return db_list_resources(pid)


@app.post("/api/projects/{pid}/resources")
async def upload_resource(pid: str, file: UploadFile = File(...)):
    """上传图片资源。

    以 SHA1 去重存储，自动生成缩略图。同名冲突靠哈希消除。
    """
    project = db_get_project(pid)
    if not project:
        raise HTTPException(404, "Project not found")

    content = await file.read()
    sha1 = hashlib.sha1(content).hexdigest()
    ext = Path(file.filename).suffix.lstrip(".") if file.filename else "png"
    ts = now()

    existing = db_get_resource(sha1, pid)
    if existing:
        return existing

    orig_dir = _project_dir(pid, project["slug"]) / "resources" / "original"
    orig_dir.mkdir(parents=True, exist_ok=True)
    dest = orig_dir / f"{sha1}.{ext}"
    if not dest.exists():
        dest.write_bytes(content)

    _generate_thumbnail(dest, sha1)
    return add_resource(sha1, pid, file.filename or "untitled", ext, len(content), ts)


@app.get("/api/projects/{pid}/resources/{sha1}")
def get_resource(pid: str, sha1: str):
    """获取单个资源元数据。"""
    r = db_get_resource(sha1, pid)
    if not r:
        raise HTTPException(404, "Resource not found")
    return r


@app.get("/api/projects/{pid}/resources/{sha1}/thumb")
def get_thumbnail(pid: str, sha1: str):
    """获取资源缩略图（200px JPEG）。"""
    r = db_get_resource(sha1, pid)
    if not r:
        raise HTTPException(404, "Resource not found")
    thumb = THUMB_CACHE_DIR / f"{sha1}.jpg"
    if not thumb.exists():
        raise HTTPException(404, "Thumbnail not found")
    return FileResponse(thumb, media_type="image/jpeg")


@app.get("/api/projects/{pid}/resources/{sha1}/full")
def get_full_resource(pid: str, sha1: str):
    """获取资源原尺寸图。"""
    r = db_get_resource(sha1, pid)
    if not r:
        raise HTTPException(404, "Resource not found")
    project = db_get_project(pid)
    if not project:
        raise HTTPException(404, "Project not found")
    orig = (
        _project_dir(pid, project["slug"])
        / "resources"
        / "original"
        / f"{sha1}.{r['ext']}"
    )
    if not orig.exists():
        raise HTTPException(404, "Original file not found")
    ext = r["ext"].lower()
    mt = {
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "png": "image/png",
        "webp": "image/webp",
        "tif": "image/tiff",
        "tiff": "image/tiff",
        "bmp": "image/bmp",
    }.get(ext, "application/octet-stream")
    return FileResponse(orig, media_type=mt)


@app.delete("/api/projects/{pid}/resources/{sha1}")
def delete_resource(pid: str, sha1: str):
    """删除资源（数据库记录 + 原始文件 + 缩略图缓存）。"""
    project = db_get_project(pid)
    if not project:
        raise HTTPException(404, "Project not found")
    r = db_get_resource(sha1, pid)
    if not r:
        raise HTTPException(404, "Resource not found")

    db_delete_resource(sha1, pid)

    # 仅当无其他项目引用该 SHA1 时才删除磁盘文件
    if count_resources_by_sha1(sha1) == 0:
        orig = (
            _project_dir(pid, project["slug"])
            / "resources"
            / "original"
            / f"{sha1}.{r['ext']}"
        )
        if orig.exists():
            orig.unlink()
        thumb = THUMB_CACHE_DIR / f"{sha1}.jpg"
        if thumb.exists():
            thumb.unlink()

    return {"deleted": True}


# --- Chain routes ---


def _chain_file(pid: str, slug: str, cid: str) -> Path:
    """返回链的 operation JSON 文件路径。"""
    return DATA_DIR / "projects" / f"{pid}-{slug}" / "chains" / f"{cid}.json"


@app.get("/api/projects/{pid}/chains")
def list_chains(pid: str):
    """列出项目下所有链（含 operations 列表）。"""
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
    """创建新链（可选从 Preset 初始化 operations）。"""
    p = db_get_project(pid)
    if not p:
        raise HTTPException(404, "Project not found")
    cid = new_id()
    ts = now()
    chain = db_create_chain(pid, cid, data.name, data.resource_ids, ts)
    (DATA_DIR / "projects" / f"{pid}-{p['slug']}" / "chains").mkdir(
        parents=True, exist_ok=True
    )

    if data.from_preset:
        preset_path = PRESETS_DIR / f"{data.from_preset}.json"
        if preset_path.exists():
            preset = json.loads(preset_path.read_text())
            ops = preset.get("operations", [])
            _chain_file(pid, p["slug"], cid).write_text(json.dumps(ops))
            chain["operations"] = ops
            return chain

    _chain_file(pid, p["slug"], cid).write_text("[]")
    chain["operations"] = []
    return chain


@app.get("/api/projects/{pid}/chains/{cid}")
def get_chain(pid: str, cid: str):
    """获取单个链详情（含 operations + resource_ids）。"""
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
    """更新链名称 / operations / resource_ids，清除预览缓存。"""
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

    # 清除该 Chain 预览缓存
    for f in THUMB_CACHE_DIR.glob("preview-*.jpg"):
        f.unlink()

    return chain


@app.delete("/api/projects/{pid}/chains/{cid}")
def delete_chain(pid: str, cid: str):
    """删除链（数据库 + operation 文件）。"""
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


# --- Export route ---


@app.post("/api/projects/{pid}/chains/{cid}/export")
async def export_chain(pid: str, cid: str, body: ExportBody):
    """导出处理结果为 ZIP 包。

    operations 由前端传入，与 execute 同源。
    chain.json 仅作持久化保存，不再参与导出。
    全量导出链绑定的全部资源。
    """
    logger.info("export start chain={}/{}", pid, cid)
    p = db_get_project(pid)
    if not p:
        raise HTTPException(404, "Project not found")
    chain = db_get_chain(pid, cid)
    if not chain:
        raise HTTPException(404, "Chain not found")

    operations = body.operations

    resource_ids = json.loads(chain["resource_ids_json"])
    if not resource_ids:
        raise HTTPException(400, "No resources found")

    resource_paths = []
    for rid in resource_ids:
        r = db_get_resource(rid, pid)
        if r:
            orig = (
                _project_dir(pid, p["slug"])
                / "resources"
                / "original"
                / f"{rid}.{r['ext']}"
            )
            if orig.exists():
                resource_paths.append((rid, r["filename"], orig))

    if not resource_paths:
        raise HTTPException(400, "No resources found")

    export_dir = _project_dir(pid, p["slug"]) / "output"
    try:
        buf = execute_chain(resource_paths, operations, export_dir)
    except Exception:
        logger.exception("export failed chain={}/{} resources={} ops={}",
                         pid, cid, len(resource_paths), len(operations))
        raise HTTPException(500, "Export failed")

    logger.info("export done chain={}/{} resources={} ops={}", pid, cid, len(resource_paths), len(operations))
    name = chain.get("name", "export")
    safe_name = urllib.parse.quote(f"{name}.zip")
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{safe_name}"},
    )


# --- Execute route ---


@app.post("/api/projects/{pid}/chains/{cid}/execute")
def exec_chain(pid: str, cid: str, body: ExecuteBody):
    """全量执行链：operations 由前端传入，不再从 JSON 文件加载。

    前端通过 execute-thumb/{idx} / execute-full/{idx} 获取图片。
    """
    logger.info("execute start chain={}/{}", pid, cid)
    p = db_get_project(pid)
    if not p:
        raise HTTPException(404, "Project not found")
    chain = db_get_chain(pid, cid)
    if not chain:
        raise HTTPException(404, "Chain not found")

    operations = body.operations

    resource_ids = json.loads(chain["resource_ids_json"])
    if not resource_ids:
        return {"images": [], "analysis": {}}

    resource_paths = []
    for rid in resource_ids:
        r = db_get_resource(rid, pid)
        if r:
            orig = (
                _project_dir(pid, p["slug"])
                / "resources"
                / "original"
                / f"{rid}.{r['ext']}"
            )
            if orig.exists():
                resource_paths.append((rid, r["filename"], orig))

    prefix = f"execute-{pid}-{cid}"
    try:
        result = execute_and_preview(resource_paths, operations, THUMB_CACHE_DIR, prefix)
        logger.info("execute done chain={}/{} resources={} ops={}", pid, cid, len(resource_paths), len(operations))
        return result
    except Exception:
        logger.exception("execute failed chain={}/{} resources={} ops={}",
                         pid, cid, len(resource_paths), len(operations))
        raise HTTPException(500, "Execution failed")


@app.get("/api/projects/{pid}/chains/{cid}/execute-thumb/{idx}")
def exec_thumb(pid: str, cid: str, idx: int):
    """获取执行结果的缩略图（200px JPEG）。"""
    thumb = THUMB_CACHE_DIR / f"execute-{pid}-{cid}-{idx}.jpg"
    if not thumb.exists():
        raise HTTPException(404, "Thumbnail not found")
    return FileResponse(thumb, media_type="image/jpeg")


@app.get("/api/projects/{pid}/chains/{cid}/execute-full/{idx}")
def exec_full(pid: str, cid: str, idx: int):
    """获取执行结果的全尺寸图。"""
    path = THUMB_CACHE_DIR / f"execfull-execute-{pid}-{cid}-{idx}.jpg"
    if not path.exists():
        raise HTTPException(404, "Image not found")
    return FileResponse(path, media_type="image/jpeg")


# --- Preset routes ---


def _preset_path(name: str) -> Path:
    """返回预设的 JSON 文件路径。"""
    return PRESETS_DIR / f"{name}.json"


@app.get("/api/presets")
def list_presets():
    """列出所有预设。"""
    PRESETS_DIR.mkdir(parents=True, exist_ok=True)
    presets = []
    for f in PRESETS_DIR.glob("*.json"):
        data = json.loads(f.read_text())
        data["name"] = f.stem
        presets.append(data)
    return presets


@app.post("/api/presets")
def create_preset(data: PresetCreate):
    """创建新预设（operation 模板）。"""
    PRESETS_DIR.mkdir(parents=True, exist_ok=True)
    path = _preset_path(data.name)
    if path.exists():
        raise HTTPException(409, "Preset already exists")
    path.write_text(
        json.dumps(
            {
                "operations": data.operations,
                "category": data.category,
            },
            indent=2,
        )
    )
    return {"name": data.name, "operations": data.operations, "category": data.category}


@app.patch("/api/presets/{name}")
def update_preset(name: str, data: PresetUpdate):
    """更新预设的 operations 或分类。"""
    path = _preset_path(name)
    if not path.exists():
        raise HTTPException(404, "Preset not found")
    existing = json.loads(path.read_text())
    if data.operations is not None:
        existing["operations"] = data.operations
    if data.category is not None:
        existing["category"] = data.category
    path.write_text(json.dumps(existing, indent=2))
    return {"name": name, **existing}


@app.delete("/api/presets/{name}")
def delete_preset(name: str):
    """删除预设。"""
    path = _preset_path(name)
    if not path.exists():
        raise HTTPException(404, "Preset not found")
    path.unlink()
    return {"deleted": True}


# --- 生产模式：静态文件挂载 ---

_static_dir = Path(__file__).resolve().parent.parent / "static"
if _static_dir.exists():
    app.mount(
        "/studio", StaticFiles(directory=str(_static_dir), html=True), name="static"
    )


# --- 入口点 ---

if __name__ == "__main__":
    import sys

    import uvicorn

    logger.add(sys.stderr, level="DEBUG",
               format="<green>{time:HH:mm:ss}</green> | <level>{level:<7}</level> | <level>{message}</level>")
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
