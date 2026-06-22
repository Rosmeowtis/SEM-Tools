import cv2
import numpy as np


def op_crop(img: np.ndarray, params: dict) -> np.ndarray:
    return img[
        params["y"] : params["y"] + params["h"], params["x"] : params["x"] + params["w"]
    ]


def op_resize(img: np.ndarray, params: dict) -> np.ndarray:
    interp = (
        cv2.INTER_NEAREST if params.get("algorithm") == "nearest" else cv2.INTER_LINEAR
    )
    return cv2.resize(img, (params["w"], params["h"]), interpolation=interp)


def op_grayscale(img: np.ndarray, params: dict) -> np.ndarray:
    if img.ndim == 3:
        return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    return img


def op_blur(img: np.ndarray, params: dict) -> np.ndarray:
    k = params.get("ksize", 3)
    if k % 2 == 0:
        k += 1
    return cv2.GaussianBlur(img, (k, k), 0)


def op_threshold(img: np.ndarray, params: dict) -> np.ndarray:
    t = params.get("threshold", 127)
    gray = img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    _, binary = cv2.threshold(gray, t, 255, cv2.THRESH_BINARY)
    return binary


def op_morphology_ellipse(img: np.ndarray, params: dict) -> np.ndarray:
    t = cv2.MORPH_OPEN if params.get("type") == "open" else cv2.MORPH_CLOSE
    k = params.get("ksize", 3)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    return cv2.morphologyEx(img, t, kernel)


def op_invert(img: np.ndarray, params: dict) -> np.ndarray:
    return cv2.bitwise_not(img)


def op_format(img: np.ndarray, params: dict) -> np.ndarray:
    return img


def op_auto_threshold(img: np.ndarray, params: dict) -> np.ndarray:
    gray = img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    hist = cv2.calcHist([gray], [0], None, [256], [0, 256]).flatten().astype(np.float32)
    peak = int(np.argmax(hist))
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


# --- Reduce (analyze) operations ---


def reduce_porosity_init(params: dict) -> dict:
    return {"total_white": 0.0, "total_pixels": 0, "per_image": []}


def reduce_porosity_accumulate(state: dict, img: np.ndarray, rid: str) -> dict:
    gray = img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    _, binary = cv2.threshold(gray, 127, 255, cv2.THRESH_BINARY)
    white = np.sum(binary == 255)
    total = binary.size
    state["total_white"] += float(white)
    state["total_pixels"] += int(total)
    state["per_image"].append({"rid": rid, "porosity": float(white / total)})
    return state


def reduce_porosity_finalize(state: dict) -> dict:
    overall = (
        state["total_white"] / state["total_pixels"] if state["total_pixels"] else 0
    )
    return {"overall": overall, "per_image": state["per_image"]}


def reduce_statistics_init(params: dict) -> dict:
    return {"values": []}


def reduce_statistics_accumulate(state: dict, img: np.ndarray, rid: str) -> dict:
    gray = img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    state["values"].extend(gray.ravel().tolist())
    return state


def reduce_statistics_finalize(state: dict) -> dict:
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


def reduce_distribution_init(params: dict) -> dict:
    return {"particle_areas": [], "equiv_diameters": []}


def reduce_distribution_accumulate(state: dict, img: np.ndarray, rid: str) -> dict:
    gray = img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    _, binary = cv2.threshold(gray, 127, 255, cv2.THRESH_BINARY)
    num_labels, _, stats, _ = cv2.connectedComponentsWithStats(binary, connectivity=8)
    areas = stats[1:, cv2.CC_STAT_AREA].tolist()
    state["particle_areas"].extend(areas)
    state["equiv_diameters"].extend([2 * np.sqrt(a / np.pi) for a in areas])
    return state


def reduce_distribution_finalize(state: dict) -> dict:
    return {
        "particle_areas": state["particle_areas"],
        "equiv_diameters": state["equiv_diameters"],
    }


def reduce_porosity_format(state: dict) -> str:
    lines = [
        # header
        "name\tporosity",
        # first line: overall
        f"overall\t{state['overall'] * 100:.2f}%",
    ]
    for item in state["per_image"]:
        lines.append(f"{item['rid']}\t{item['porosity'] * 100:.2f}%")
    return "\n".join(lines)


def reduce_statistics_format(state: dict) -> str:
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


def reduce_distribution_format(state: dict) -> str:
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
    t = op["params"].get("type", "porosity")
    entry = _REDUCE_TYPES.get(t)
    return entry["init"](op["params"]) if entry else {}


def reduce_accumulate(op: dict, state: dict, img: np.ndarray, rid: str) -> dict:
    t = op["params"].get("type", "porosity")
    entry = _REDUCE_TYPES.get(t)
    return entry["accumulate"](state, img, rid) if entry else state


def reduce_finalize(op: dict, state: dict) -> dict:
    t = op["params"].get("type", "porosity")
    entry = _REDUCE_TYPES.get(t)
    return entry["finalize"](state) if entry else {}


def reduce_format(op: dict, state: dict) -> str:
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
}


def apply_map_op(img: np.ndarray, op: dict) -> np.ndarray:
    fn = _MAP_OPS.get(op["kind"])
    return fn(img, op["params"]) if fn else img
