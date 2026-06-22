"""项目路径配置。

通过 __file__ 计算 ROOT 目录，所有运行时数据统一存放于 _data/。
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
DATA_DIR = ROOT / "_data"
DB_PATH = DATA_DIR / "studio.db"
THUMB_CACHE_DIR = DATA_DIR / "thumb_cache"
