"""图像处理操作实现。

每个操作是一个独立函数，接收 `np.ndarray` 和 `params: dict`，
返回处理后的 `np.ndarray`。函数通过 _MAP_OPS 字典注册，
由 apply_map_op 统一调度。

Reduce 操作（跨图聚合）按 init/accumulate/finalize 三阶段协议实现，
通过 _REDUCE_TYPES 注册，由 reduce_init / reduce_accumulate / reduce_finalize
统一调度。

格式化（format）输出也通过 reduce_format 调度。
"""

import cv2
import numpy as np


def op_crop(img: np.ndarray, params: dict) -> np.ndarray:
    """裁剪图像。

    Args:
        img: 输入图像 (BGR 或灰度)。
        params: {"x", "y", "w", "h"} — 裁剪矩形位置与尺寸。

    Returns:
        裁剪后的子图（视图或副本）。
    """
    return img[
        params["y"] : params["y"] + params["h"], params["x"] : params["x"] + params["w"]
    ]


def op_resize(img: np.ndarray, params: dict) -> np.ndarray:
    """缩放图像至指定尺寸。

    Args:
        img: 输入图像。
        params: {"w", "h", "algorithm"} — 目标宽高 + 插值算法 ("nearest" / "bilinear")。

    Returns:
        缩放后的图像。
    """
    interp = (
        cv2.INTER_NEAREST if params.get("algorithm") == "nearest" else cv2.INTER_LINEAR
    )
    return cv2.resize(img, (params["w"], params["h"]), interpolation=interp)


def op_grayscale(img: np.ndarray, params: dict) -> np.ndarray:
    """将彩色图像转为灰度图。若已是灰度图则原样返回。

    Args:
        img: 输入图像（BGR 或灰度）。
        params: 无。

    Returns:
        单通道灰度图。
    """
    if img.ndim == 3:
        return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    return img


def op_blur(img: np.ndarray, params: dict) -> np.ndarray:
    """高斯模糊。

    Args:
        img: 输入图像。
        params: {"ksize"} — 高斯核大小（自动取奇数）。

    Returns:
        模糊后的图像。
    """
    k = params.get("ksize", 3)
    if k % 2 == 0:
        k += 1
    return cv2.GaussianBlur(img, (k, k), 0)


def op_threshold(img: np.ndarray, params: dict) -> np.ndarray:
    """固定阈值二值化。彩色图先转灰度。

    Args:
        img: 输入图像。
        params: {"threshold"} — 阈值（0-255）。

    Returns:
        二值图像（0 / 255）。
    """
    t = params.get("threshold", 127)
    gray = img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    _, binary = cv2.threshold(gray, t, 255, cv2.THRESH_BINARY)
    return binary


def op_morphology_ellipse(img: np.ndarray, params: dict) -> np.ndarray:
    """椭圆结构元素的形态学开/闭运算。

    Args:
        img: 输入图像。
        params: {"type": "open" | "close", "ksize"} — 运算类型 + 核直径。

    Returns:
        形态学运算后的图像。
    """
    t = cv2.MORPH_OPEN if params.get("type") == "open" else cv2.MORPH_CLOSE
    k = params.get("ksize", 3)
    it = params.get("iterations", 1)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    return cv2.morphologyEx(img, t, kernel, iterations=it)


def op_invert(img: np.ndarray, params: dict) -> np.ndarray:
    """按位取反（颜色反转）。

    Args:
        img: 输入图像。
        params: 无。

    Returns:
        取反后的图像。
    """
    return cv2.bitwise_not(img)


def op_format(img: np.ndarray, params: dict) -> np.ndarray:
    """格式标记操作。运行时不修改像素，仅作为输出格式指示。

    Args:
        img: 输入图像。
        params: {"type", "quality"} — 输出格式与质量。

    Returns:
        原图不变。
    """
    return img


def op_auto_threshold(img: np.ndarray, params: dict) -> np.ndarray:
    """自动阈值二值化：单峰左/右最大距离点 + 大津法。

    Args:
        img: 输入图像。
        params: {"algorithm", "offset"} — 阈值算法 + 偏移修正。

    Returns:
        二值图像（0 / 255）。
    """
    gray = img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    algorithm = params.get("algorithm", "left_peak")

    if algorithm == "otsu":
        ret, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
        offset = params.get("offset", 0)
        if offset:
            ret = max(0, min(255, ret + offset))
            _, binary = cv2.threshold(gray, ret, 255, cv2.THRESH_BINARY)
        return binary

    hist = cv2.calcHist([gray], [0], None, [256], [0, 256]).flatten().astype(np.float32)
    peak = int(np.argmax(hist))

    if algorithm == "right_peak":
        right = 255
        for i in range(255, peak, -1):
            if hist[i] > 0:
                right = i
                break
        max_dist = -1.0
        best_thresh = right
        for i in range(peak + 1, right + 1):
            dist = abs(
                (right - peak) * (hist[i] - hist[peak])
                - (i - peak) * (hist[right] - hist[peak])
            )
            if dist > max_dist:
                max_dist = dist
                best_thresh = i
    else:
        left = 0
        for i in range(peak):
            if hist[i] > 0:
                left = i
                break
        max_dist = -1.0
        best_thresh = left
        for i in range(left, peak):
            dist = abs(
                (peak - left) * (hist[i] - hist[left])
                - (i - left) * (hist[peak] - hist[left])
            )
            if dist > max_dist:
                max_dist = dist
                best_thresh = i

    offset = params.get("offset", 0)
    final_thresh = max(0, min(255, best_thresh + offset))
    _, binary = cv2.threshold(gray, final_thresh, 255, cv2.THRESH_BINARY)
    return binary


def op_tophat(img: np.ndarray, params: dict) -> np.ndarray:
    """顶帽变换（Top-hat）：大核形态学开运算消除不均匀光照。

    1. 大核椭圆开运算提取图像背景照明场。
    2. 原图减背景，保留高频细节，消除低频光照不均匀。

    Args:
        img: 输入图像。
        params: {"ksize"} — 结构元素直径，默认 81。

    Returns:
        校正后的灰度图。
    """
    k = params.get("ksize", 81)
    if k % 2 == 0:
        k += 1
    gray = img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    background = cv2.morphologyEx(gray, cv2.MORPH_OPEN, kernel)
    return cv2.subtract(gray, background)


# --- Reduce (analyze) operations ---


def reduce_porosity_init(params: dict) -> dict:
    """孔隙率分析 - 初始化累加器。

    Returns:
        {"total_white", "total_pixels", "per_image"}。
    """
    return {"total_white": 0.0, "total_pixels": 0, "per_image": []}


def reduce_porosity_accumulate(
    state: dict, img: np.ndarray, rid: str, filename: str = ""
) -> dict:
    """孔隙率分析 - 累积单张图像的白色像素占比。

    Args:
        state: 当前累加状态。
        img: 当前图像。
        rid: 资源标识。
        filename: 原始文件名（用于人类可读输出）。

    Returns:
        更新后的累加状态。
    """
    gray = img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    _, binary = cv2.threshold(gray, 127, 255, cv2.THRESH_BINARY)
    white = np.sum(binary == 255)
    total = binary.size
    state["total_white"] += float(white)
    state["total_pixels"] += int(total)
    state["per_image"].append(
        {"name": filename or rid, "porosity": float(white / total)}
    )
    return state


def reduce_porosity_finalize(state: dict) -> dict:
    """孔隙率分析 - 输出最终结果。

    Returns:
        {"overall": 总体孔隙率, "per_image": 逐文件明细}。
    """
    overall = (
        state["total_white"] / state["total_pixels"] if state["total_pixels"] else 0
    )
    return {"overall": overall, "per_image": state["per_image"]}


def reduce_porosity_format(state: dict) -> str:
    """孔隙率结果格式化为 TAB 分隔文本，百分数保留两位小数。

    Returns:
        形如 "name\\tporosity\\noverall\\t42.35%\\n" 的字符串。
    """
    lines = [
        "name\tporosity",
        f"overall\t{state['overall'] * 100:.2f}%",
    ]
    for item in state["per_image"]:
        lines.append(f"{item['name']}\t{item['porosity'] * 100:.2f}%")
    return "\n".join(lines)


def reduce_statistics_init(params: dict) -> dict:
    """灰度统计 - 初始化累加器。

    Returns:
        {"values"} — 用于汇聚所有像素值。
    """
    return {"values": []}


def reduce_statistics_accumulate(
    state: dict, img: np.ndarray, rid: str, filename: str = ""
) -> dict:
    """灰度统计 - 累积单张图像的全部像素值。

    Args:
        state: 当前累加状态。
        img: 当前图像。
        rid: 资源标识（未使用）。
        filename: 文件名（未使用）。

    Returns:
        更新后的累加状态。
    """
    gray = img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    state["values"].extend(gray.ravel().tolist())
    return state


def reduce_statistics_finalize(state: dict) -> dict:
    """灰度统计 - 输出统计量。

    Returns:
        {"count", "mean", "std", "min", "max", "p50", "p95", "p99"}。
    """
    arr = np.array(state["values"]) if state["values"] else np.array([0])
    return {
        "count": int(len(arr)),
        "mean": float(arr.mean()),
        "std": float(arr.std()),
        "min": float(arr.min()),
        "max": float(arr.max()),
        "p50": float(np.percentile(arr, 50)),
        "p95": float(np.percentile(arr, 95)),
        "p99": float(np.percentile(arr, 99)),
    }


def reduce_statistics_format(state: dict) -> str:
    """灰度统计结果格式化为 TAB 分隔文本。

    Returns:
        形如 "count\\t100\\nmean\\t128.53\\n..." 的字符串。
    """
    return "\n".join(
        [
            f"count\t{state['count']}",
            f"mean\t{state['mean']:.4f}",
            f"std\t{state['std']:.4f}",
            f"min\t{state['min']:.4f}",
            f"max\t{state['max']:.4f}",
            f"p50\t{state['p50']:.4f}",
            f"p95\t{state['p95']:.4f}",
            f"p99\t{state['p99']:.4f}",
        ]
    )


def reduce_distribution_init(params: dict) -> dict:
    """粒径分布 - 初始化累加器。

    Returns:
        {"particle_areas", "equiv_diameters"}。
    """
    return {"particle_areas": [], "equiv_diameters": []}


def reduce_distribution_accumulate(
    state: dict, img: np.ndarray, rid: str, filename: str = ""
) -> dict:
    """粒径分布 - 累积单张图像的连通域信息。

    Args:
        state: 当前累加状态。
        img: 当前图像。
        rid: 资源标识（未使用）。
        filename: 文件名（未使用）。

    Returns:
        更新后的累加状态。
    """
    gray = img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    _, binary = cv2.threshold(gray, 127, 255, cv2.THRESH_BINARY)
    num_labels, _, stats, _ = cv2.connectedComponentsWithStats(binary, connectivity=8)
    areas = stats[1:, cv2.CC_STAT_AREA].tolist()
    state["particle_areas"].extend(areas)
    state["equiv_diameters"].extend([2 * np.sqrt(a / np.pi) for a in areas])
    return state


def reduce_distribution_finalize(state: dict) -> dict:
    """粒径分布 - 输出粒子面积与等效直径列表。

    Returns:
        {"particle_areas": [...], "equiv_diameters": [...]}。
    """
    return {
        "particle_areas": state["particle_areas"],
        "equiv_diameters": state["equiv_diameters"],
    }


def reduce_distribution_format(state: dict) -> str:
    """粒径分布结果格式化为 TAB 分隔文本。

    Returns:
        形如 "index\\tarea\\tdiameter\\n0\\t100\\t11.28\\n..." 的字符串。
    """
    areas = state.get("particle_areas", [])
    diameters = state.get("equiv_diameters", [])
    if not areas:
        return "index\tarea\tdiameter\n(no particles)"
    lines = ["index\tarea\tdiameter"]
    for i, (a, d) in enumerate(zip(areas, diameters)):
        lines.append(f"{i}\t{a}\t{d:.4f}")
    return "\n".join(lines)


_REDUCE_TYPES: dict[str, dict] = {
    "porosity": {
        "init": reduce_porosity_init,
        "accumulate": reduce_porosity_accumulate,
        "finalize": reduce_porosity_finalize,
        "format": reduce_porosity_format,
    },
    "statistics": {
        "init": reduce_statistics_init,
        "accumulate": reduce_statistics_accumulate,
        "finalize": reduce_statistics_finalize,
        "format": reduce_statistics_format,
    },
    "distribution": {
        "init": reduce_distribution_init,
        "accumulate": reduce_distribution_accumulate,
        "finalize": reduce_distribution_finalize,
        "format": reduce_distribution_format,
    },
}


def reduce_init(op: dict) -> dict:
    """按 op 的 params.type 创建对应的 reduce 累加器。"""
    t = op["params"].get("type", "porosity")
    entry = _REDUCE_TYPES.get(t)
    return entry["init"](op["params"]) if entry else {}


def reduce_accumulate(
    op: dict, state: dict, img: np.ndarray, rid: str, filename: str = ""
) -> dict:
    """按 op 的 params.type 将当前图像累入状态。"""
    t = op["params"].get("type", "porosity")
    entry = _REDUCE_TYPES.get(t)
    return entry["accumulate"](state, img, rid, filename) if entry else state


def reduce_finalize(op: dict, state: dict) -> dict:
    """按 op 的 params.type 完成聚合，返回最终结果。"""
    t = op["params"].get("type", "porosity")
    entry = _REDUCE_TYPES.get(t)
    return entry["finalize"](state) if entry else {}


def reduce_format(op: dict, state: dict) -> str:
    """按 op 的 params.type 将最终结果格式化为可读文本（TAB 分隔）。"""
    t = op["params"].get("type", "porosity")
    entry = _REDUCE_TYPES.get(t)
    return entry["format"](state) if entry else ""


_MAP_OPS: dict[str, callable] = {  # ty:ignore[invalid-type-form]
    "crop": op_crop,
    "resize": op_resize,
    "grayscale": op_grayscale,
    "blur": op_blur,
    "threshold": op_threshold,
    "morphology_ellipse": op_morphology_ellipse,
    "invert": op_invert,
    "format": op_format,
    "auto_threshold": op_auto_threshold,
    "tophat": op_tophat,
}


def apply_map_op(img: np.ndarray, op: dict) -> np.ndarray:
    """通过 op.kind 查找对应的 map 函数并调用。"""
    fn = _MAP_OPS.get(op["kind"])
    return fn(img, op["params"]) if fn else img
