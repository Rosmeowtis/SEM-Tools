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
    iterations: int = 1


class InvertParams(BaseModel):
    pass


class FormatParams(BaseModel):
    type: Literal["png", "jpg", "webp"] = "png"
    quality: int = 85


class AutoThresholdParams(BaseModel):
    algorithm: Literal["left_peak", "right_peak", "otsu"] = "left_peak"
    offset: int = 0


class TophatParams(BaseModel):
    ksize: int = 81


class DistanceTransformParams(BaseModel):
    distance_type: Literal["L1", "L2", "C"] = "L2"
    mask_size: int = 3


class WatershedParams(BaseModel):
    seed_thresh: float = 0.5
    bg_iterations: int = 3
    bg_ksize: int = 3


class CentroidMarkersParams(BaseModel):
    cross_size: int = 5
    cross_thickness: int = 1


class SamplePointsParams(BaseModel):
    quantity: int = 100
    algorithm: Literal["halton", "jittered_grid", "regular_grid", "sunflower", "sunflower_lattice"] = "halton"
    cross_size: int = 5
    cross_thickness: int = 1
    seed: int = 0


# --- Operation 基类 ---


class OpBase(BaseModel):
    """所有 Operation 的共享基类，提供统一的属性访问契约供引擎使用。

    子类按是否修改图像分为 MapOpBase（逐图变换）和 ReduceOpBase（跨图聚合）。
    引擎通过 op.kind / op.mode / op.params 访问 operation，无需关心具体子类型。
    """

    kind: str
    mode: Literal["map", "reduce"]
    params: BaseModel


class MapOpBase(OpBase):
    """Map 类 Operation 基类。逐图像独立变换，输出与输入等量的图像。"""

    mode: Literal["map"] = "map"


class ReduceOpBase(OpBase):
    """Reduce 类 Operation 基类。跨图像聚合分析，不产生中间图像。"""

    mode: Literal["reduce"] = "reduce"


# --- Discriminated union of operations ---


class CropOp(MapOpBase):
    kind: Literal["crop"] = "crop"
    params: CropParams = Field(default_factory=CropParams)


class ResizeOp(MapOpBase):
    kind: Literal["resize"] = "resize"
    params: ResizeParams = Field(default_factory=ResizeParams)


class GrayscaleOp(MapOpBase):
    kind: Literal["grayscale"] = "grayscale"
    params: GrayscaleParams = Field(default_factory=GrayscaleParams)


class AnalyzeOp(ReduceOpBase):
    kind: Literal["analyze"] = "analyze"
    params: AnalyzeParams = Field(default_factory=AnalyzeParams)


class BlurOp(MapOpBase):
    kind: Literal["blur"] = "blur"
    params: BlurParams = Field(default_factory=BlurParams)


class ThresholdOp(MapOpBase):
    kind: Literal["threshold"] = "threshold"
    params: ThresholdParams = Field(default_factory=ThresholdParams)


class AutoThresholdOp(MapOpBase):
    kind: Literal["auto_threshold"] = "auto_threshold"
    params: AutoThresholdParams = Field(default_factory=AutoThresholdParams)


class TophatOp(MapOpBase):
    kind: Literal["tophat"] = "tophat"
    params: TophatParams = Field(default_factory=TophatParams)


class DistanceTransformOp(MapOpBase):
    kind: Literal["distance_transform"] = "distance_transform"
    params: DistanceTransformParams = Field(default_factory=DistanceTransformParams)


class WatershedOp(MapOpBase):
    kind: Literal["watershed"] = "watershed"
    params: WatershedParams = Field(default_factory=WatershedParams)


class CentroidMarkersOp(MapOpBase):
    kind: Literal["centroid_markers"] = "centroid_markers"
    params: CentroidMarkersParams = Field(default_factory=CentroidMarkersParams)


class SamplePointsOp(MapOpBase):
    kind: Literal["sample_points"] = "sample_points"
    params: SamplePointsParams = Field(default_factory=SamplePointsParams)


class MorphologyOp(MapOpBase):
    kind: Literal["morphology_ellipse"] = "morphology_ellipse"
    params: MorphologyParams = Field(default_factory=MorphologyParams)


class InvertOp(MapOpBase):
    kind: Literal["invert"] = "invert"
    params: InvertParams = Field(default_factory=InvertParams)


class FormatOp(MapOpBase):
    kind: Literal["format"] = "format"
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
        DistanceTransformOp,
        WatershedOp,
        CentroidMarkersOp,
        SamplePointsOp,
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


class ExecuteBody(BaseModel):
    """执行/预览请求。operations 由前端传入，后端不再从 JSON 文件加载。"""

    operations: list[Operation]


class ExportBody(BaseModel):
    """导出请求。与 execute 同：operations 由前端传入，不再读 chain.json 文件。全量导出，无 rid。"""

    operations: list[Operation]


class PresetCreate(BaseModel):
    """创建预设请求。"""

    name: str
    operations: list[Any] = []
    category: list[str] = []


class PresetUpdate(BaseModel):
    """更新预设请求。"""

    operations: list[Any] | None = None
    category: list[str] | None = None
