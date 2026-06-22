import cv2
import numpy as np
from pathlib import Path


def apply_map_op(img: np.ndarray, op: dict) -> np.ndarray:
    kind = op["kind"]
    params = op["params"]
    if kind == "crop":
        x, y, w, h = params["x"], params["y"], params["w"], params["h"]
        return img[y:y+h, x:x+w]
    elif kind == "resize":
        interp = cv2.INTER_NEAREST if params.get("algorithm") == "nearest" else cv2.INTER_LINEAR
        return cv2.resize(img, (params["w"], params["h"]), interpolation=interp)
    elif kind == "grayscale":
        if len(img.shape) == 3:
            return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        return img
    return img


def render_preview(image_path: Path, operations: list[dict], cache_path: Path):
    img = cv2.imread(str(image_path))
    if img is None:
        raise ValueError(f"Cannot load {image_path}")
    for op in operations:
        if op.get("mode") == "map":
            img = apply_map_op(img, op)
    h, w = img.shape[:2]
    scale = 200 / max(h, w) if max(h, w) > 200 else 1.0
    if scale < 1:
        img = cv2.resize(img, (int(w * scale), int(h * scale)))
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(cache_path), img)
    del img
