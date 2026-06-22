import re
import uuid
from datetime import datetime, timezone
from pydantic import BaseModel


def slugify(text: str) -> str:
    text = re.sub(r"[^\w\s-]", "", text.lower())
    return re.sub(r"[-\s]+", "-", text).strip("-")[:50]


def new_id() -> str:
    return uuid.uuid4().hex[:12]


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


class ProjectCreate(BaseModel):
    title: str
    note: str = ""


class ProjectUpdate(BaseModel):
    title: str | None = None
    note: str | None = None


class Project(BaseModel):
    id: str
    slug: str
    title: str
    note: str
    created_at: str
    updated_at: str


class ResourceMeta(BaseModel):
    sha1: str
    project_id: str
    filename: str
    ext: str
    size: int
    imported_at: str
