from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
DATA_DIR = ROOT / "_data"
DB_PATH = DATA_DIR / "studio.db"
THUMB_CACHE_DIR = DATA_DIR / "thumb_cache"
