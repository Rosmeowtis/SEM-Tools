import re
import uuid
from datetime import datetime, timezone
from typing import Annotated, Union, Literal
from pydantic import BaseModel, Field


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


# --- Operation params ---

class CropParams(BaseModel):
    x: int = 0
    y: int = 0
    w: int = 100
    h: int = 100

class ResizeParams(BaseModel):
    w: int = 256
    h: int = 256
    algorithm: Literal["nearest", "bilinear"] = "bilinear"

class GrayscaleParams(BaseModel):
    pass

class AnalyzeParams(BaseModel):
    type: Literal["porosity", "statistics", "distribution"] = "porosity"


# --- Discriminated union ---

class CropOp(BaseModel):
    kind: Literal["crop"] = "crop"
    mode: Literal["map"] = "map"
    params: CropParams = Field(default_factory=CropParams)

class ResizeOp(BaseModel):
    kind: Literal["resize"] = "resize"
    mode: Literal["map"] = "map"
    params: ResizeParams = Field(default_factory=ResizeParams)

class GrayscaleOp(BaseModel):
    kind: Literal["grayscale"] = "grayscale"
    mode: Literal["map"] = "map"
    params: GrayscaleParams = Field(default_factory=GrayscaleParams)

class AnalyzeOp(BaseModel):
    kind: Literal["analyze"] = "analyze"
    mode: Literal["reduce"] = "reduce"
    params: AnalyzeParams = Field(default_factory=AnalyzeParams)


class BlurParams(BaseModel):
    ksize: int = 3

class ThresholdParams(BaseModel):
    threshold: int = 127

class MorphologyParams(BaseModel):
    type: Literal["open", "close"] = "open"
    ksize: int = 3

class InvertParams(BaseModel):
    pass

class FormatParams(BaseModel):
    type: Literal["png", "jpg", "webp"] = "png"
    quality: int = 85

class BlurOp(BaseModel):
    kind: Literal["blur"] = "blur"
    mode: Literal["map"] = "map"
    params: BlurParams = Field(default_factory=BlurParams)

class ThresholdOp(BaseModel):
    kind: Literal["threshold"] = "threshold"
    mode: Literal["map"] = "map"
    params: ThresholdParams = Field(default_factory=ThresholdParams)

class MorphologyOp(BaseModel):
    kind: Literal["morphology_ellipse"] = "morphology_ellipse"
    mode: Literal["map"] = "map"
    params: MorphologyParams = Field(default_factory=MorphologyParams)

class InvertOp(BaseModel):
    kind: Literal["invert"] = "invert"
    mode: Literal["map"] = "map"
    params: InvertParams = Field(default_factory=InvertParams)

class FormatOp(BaseModel):
    kind: Literal["format"] = "format"
    mode: Literal["map"] = "map"
    params: FormatParams = Field(default_factory=FormatParams)

Operation = Annotated[
    Union[CropOp, ResizeOp, GrayscaleOp, BlurOp, ThresholdOp,
          MorphologyOp, InvertOp, FormatOp, AnalyzeOp],
    Field(discriminator="kind")
]


class ChainCreate(BaseModel):
    name: str
    resource_ids: list[str] = []

class ChainUpdate(BaseModel):
    name: str | None = None
    operations: list[Operation] | None = None
    resource_ids: list[str] | None = None
