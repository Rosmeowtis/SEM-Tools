"""Pydantic 数据模型与工具函数。

定义所有 API 请求/响应模型（Project / Resource / Chain / Preset 等），
以及 Operation 的判别联合类型（Pydantic discriminated union by "kind"）。

也提供 slugify、new_id、now 等基础工具函数。
"""

import re
import uuid
from datetime import datetime, timezone
from typing import Annotated, Any, Union, Literal
from pydantic import BaseModel, Field


def slugify(text: str) -> str:
    """将文本转为 URL 友好的 slug（小写、去符号、连字符）。"""
    text = re.sub(r"[^\w\s-]", "", text.lower())
    return re.sub(r"[-\s]+", "-", text).strip("-")[:50]


def new_id() -> str:
    """生成 12 字符十六进制随机 ID。"""
    return uuid.uuid4().hex[:12]


def now() -> str:
    """返回当前 UTC 时间的 ISO 格式字符串。"""
    return datetime.now(timezone.utc).isoformat()


# --- Request / Response models ---


class ProjectCreate(BaseModel):
    """创建项目请求。"""

    title: str


# --- Operation 参数模型 ---


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


class AutoThresholdParams(BaseModel):
    offset: int = 0


class TophatParams(BaseModel):
    ksize: int = 81


# --- Discriminated union of operations ---


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


class BlurOp(BaseModel):
    kind: Literal["blur"] = "blur"
    mode: Literal["map"] = "map"
    params: BlurParams = Field(default_factory=BlurParams)


class ThresholdOp(BaseModel):
    kind: Literal["threshold"] = "threshold"
    mode: Literal["map"] = "map"
    params: ThresholdParams = Field(default_factory=ThresholdParams)


class AutoThresholdOp(BaseModel):
    kind: Literal["auto_threshold"] = "auto_threshold"
    mode: Literal["map"] = "map"
    params: AutoThresholdParams = Field(default_factory=AutoThresholdParams)


class TophatOp(BaseModel):
    kind: Literal["tophat"] = "tophat"
    mode: Literal["map"] = "map"
    params: TophatParams = Field(default_factory=TophatParams)


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
    Union[
        CropOp,
        ResizeOp,
        GrayscaleOp,
        BlurOp,
        ThresholdOp,
        AutoThresholdOp,
        MorphologyOp,
        InvertOp,
        FormatOp,
        TophatOp,
        AnalyzeOp,
    ],
    Field(discriminator="kind"),
]


# --- Chain & Preset models ---


class ChainCreate(BaseModel):
    """创建处理链请求。"""

    name: str
    resource_ids: list[str] = []
    from_preset: str | None = None


class ChainUpdate(BaseModel):
    """更新处理链请求（字段可选，只更新非 None 字段）。"""

    name: str | None = None
    operations: list[Operation] | None = None
    resource_ids: list[str] | None = None


class PresetCreate(BaseModel):
    """创建预设请求。"""

    name: str
    operations: list[Any] = []
    category: list[str] = []


class PresetUpdate(BaseModel):
    """更新预设请求。"""

    operations: list[Any] | None = None
    category: list[str] | None = None
