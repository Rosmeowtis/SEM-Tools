import cv2
import numpy as np


def op_crop(img: np.ndarray, params: dict) -> np.ndarray:
    return img[params["y"]:params["y"]+params["h"], params["x"]:params["x"]+params["w"]]


def op_resize(img: np.ndarray, params: dict) -> np.ndarray:
    interp = cv2.INTER_NEAREST if params.get("algorithm") == "nearest" else cv2.INTER_LINEAR
    return cv2.resize(img, (params["w"], params["h"]), interpolation=interp)


def op_grayscale(img: np.ndarray, params: dict) -> np.ndarray:
    if img.ndim == 3:
        return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    return img


def op_blur(img: np.ndarray, params: dict) -> np.ndarray:
    k = params.get("ksize", 3)
    if k % 2 == 0: k += 1
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
        dist = abs((peak - left) * (hist[i] - hist[left]) - (i - left) * (hist[peak] - hist[left]))
        if dist > max_dist:
            max_dist = dist
            best_thresh = i
    offset = params.get("offset", 0)
    final_thresh = max(0, min(255, best_thresh + offset))
    _, binary = cv2.threshold(gray, final_thresh, 255, cv2.THRESH_BINARY)
    return binary


_MAP_OPS: dict[str, callable] = {
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
