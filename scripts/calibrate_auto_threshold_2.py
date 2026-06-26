"""auto_threshold_2 参数校准脚本。

对 _data/projects/da0bb2988d70-sample/ 下全部例图跑 baseline（auto_threshold
left_peak）与新版 auto_threshold_2，输出逐图孔隙率与疑似阴影抹除数，
便于目检默认 min_area/tau_R/tau_i 的取舍。只读 _data，不写任何文件。

用法:
    cd backend && uv run python ../scripts/calibrate_auto_threshold_2.py
"""

from __future__ import annotations

import glob
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
from studio.operations import op_auto_threshold, op_auto_threshold_2  # noqa: E402

SAMPLE_DIR = os.environ.get(
    "SEM_SAMPLE_DIR",
    os.path.join(
        os.path.dirname(__file__), "..", "_data", "projects", "da0bb2988d70-sample", "resources", "original"
    ),
)


def _load_gray(path: str) -> np.ndarray:
    img = cv2.imread(path, cv2.IMREAD_COLOR)
    if img is None:
        raise RuntimeError(f"无法读取: {path}")
    return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)


def _porosity(binary: np.ndarray) -> float:
    return float((binary == 255).mean())


def _erased_count(base: np.ndarray, filt: np.ndarray) -> int:
    """baseline 标记为孔隙但被新版抹除的连通域数（近似：8-连通）。"""
    erased = (base == 255) & (filt == 0)
    n, _ = cv2.connectedComponents(erased.astype(np.uint8), connectivity=8)
    return max(0, n - 1)


def main() -> None:
    paths = sorted(glob.glob(os.path.join(SAMPLE_DIR, "*.jpg")))
    if not paths:
        print(f"未找到例图: {SAMPLE_DIR}", file=sys.stderr)
        sys.exit(1)

    # 预处理链与 presets/孔隙率.json 对齐：blur(5) 后再二值化
    print(f"{'file':<14} {'baseline':>10} {'v2':>10} {'erased':>8}")
    print("-" * 46)
    for p in paths:
        gray = _load_gray(p)
        gray = cv2.GaussianBlur(gray, (5, 5), 0)
        base = op_auto_threshold(gray, {"algorithm": "left_peak", "offset": 0})
        filt = op_auto_threshold_2(gray, {"min_area": 50, "tau_R": 2.0, "tau_i": 0.0})
        name = os.path.basename(p)[:14]
        print(f"{name:<14} {_porosity(base)*100:>9.2f}% {_porosity(filt)*100:>9.2f}% {_erased_count(base, filt):>8}")


if __name__ == "__main__":
    main()
