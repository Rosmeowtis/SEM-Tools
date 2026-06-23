"""SEM-Tools 绿色打包构建脚本。

在已配置好 uv + bun 的开发环境下运行：
    python scripts/build_portable.py

输出到 SEM-Tools/ 目录，包含嵌入式 Python + 后端源码 + 前端构建产物。
"""

import shutil
import subprocess
import urllib.request
import zipfile
from pathlib import Path

PROJ = "SEM-Tools_v0.1.0"
REPO = Path(__file__).resolve().parent.parent
BUILD = REPO / "SEM-Tools"
PY_VER = "3.13.2"
PY_URL = f"https://www.python.org/ftp/python/{PY_VER}/python-{PY_VER}-embed-amd64.zip"
PYTHON_DIR = BUILD / "python"


def step(msg: str):
    print(f"\n===> {msg}")


def clean():
    step("清理 build 目录")
    if BUILD.exists():
        shutil.rmtree(BUILD)
    BUILD.mkdir(parents=True)

CACHE_DIR = REPO / "_cache"


def download_python():
    step(f"下载 Embedded Python {PY_VER}")
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cached_zip = CACHE_DIR / f"python-{PY_VER}-embed-amd64.zip"

    if cached_zip.exists():
        print(f"  缓存命中: {cached_zip}")
    else:
        print(f"  下载 {PY_URL}")
        urllib.request.urlretrieve(PY_URL, cached_zip)

    with zipfile.ZipFile(cached_zip, "r") as zf:
        zf.extractall(PYTHON_DIR)
    # 启用 site-packages：编辑 ._pth 文件，去掉 import site 的注释
    for pth in PYTHON_DIR.glob("python*._pth"):
        content = pth.read_text(encoding="utf-8")
        content = content.replace("#import site", "import site")
        pth.write_text(content, encoding="utf-8")
    print(f"  → {PYTHON_DIR}")


def install_deps():
    step("安装 Python 依赖（通过 uv）")
    pyproject = REPO / "backend" / "pyproject.toml"
    with open(pyproject, encoding="utf-8") as f:
        import tomllib

        data = tomllib.loads(f.read())
    deps = data["project"]["dependencies"]
    subprocess.run(
        ["uv", "pip", "install", "--python", str(PYTHON_DIR / "python.exe")] + deps,
        check=True,
        capture_output=True,
    )
    print(f"  已安装 {len(deps)} 个包")


def copy_backend():
    step("复制后端源码")
    target = BUILD / "backend"
    shutil.copytree(
        REPO / "backend",
        target,
        ignore=shutil.ignore_patterns(
            ".venv", "__pycache__", "*.pyc", ".python-version"
        ),
    )
    # 删除不需要的文件
    for p in target.rglob("__pycache__"):
        shutil.rmtree(p, ignore_errors=True)


def build_frontend():
    step("构建前端")
    subprocess.run(["bun", "run", "build"], cwd=str(REPO / "frontend"), check=True)
    shutil.copytree(REPO / "frontend" / "dist", BUILD / "static")
    print(f"  → {BUILD / 'static'}")


def create_start_script():
    step("生成 start.bat")
    content = r"""@echo off
cd /d "%~dp0"
echo Starting SEM-Tools...
start "" http://localhost:8765/studio/
python\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8765 --app-dir backend
pause
"""
    (BUILD / "start.bat").write_text(content, encoding="utf-8")
    print(f"  → {BUILD / 'start.bat'}")


def create_readme():
    step("生成 README.txt")
    content = f"""SEM-Tools 便携版
====================

使用方法：
  1. 双击 start.bat 启动服务
  2. 浏览器自动打开 http://localhost:8765/studio/
  3. 关闭 CMD 窗口停止服务

目录结构：
  python/      嵌入式 Python {PY_VER}（无需额外安装）
  backend/     后端服务源码
  static/      前端界面（Web UI）
  _data/       运行时数据（项目/图片/缓存）
  start.bat    启动脚本

注意事项：
  - 首次启动可能略慢（初始化数据库）
  - 如需修改端口，编辑 start.bat 中的 --port 参数
  - 如果 Windows 防火墙提示，请允许访问
"""
    (BUILD / "README.txt").write_text(content, encoding="utf-8")
    print(f"  → {BUILD / 'README.txt'}")


def test_run():
    step("快速验证启动")
    result = subprocess.run(
        [
            str(PYTHON_DIR / "python.exe"),
            "-c",
            "from fastapi import FastAPI; print('FastAPI OK')",
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    print(f"  {result.stdout.strip()}")


def create_zip():
    step("打包 SEM-Tools.zip")
    zip_path = REPO / f"{PROJ}.zip"
    if zip_path.exists():
        zip_path.unlink()
    shutil.make_archive(str(REPO / PROJ), "zip", str(BUILD))
    size_mb = zip_path.stat().st_size / 1024 / 1024
    print(f"  → {zip_path} ({size_mb:.1f} MB)")


def main():
    clean()
    download_python()
    install_deps()
    copy_backend()
    build_frontend()
    create_start_script()
    create_readme()
    test_run()
    create_zip()
    print(f"\n✅ 构建完成！产物在 {BUILD}")
    print("   启动: 双击 start.bat")
    print(
        f"   大小: {sum(f.stat().st_size for f in BUILD.rglob('*') if f.is_file()) / 1024 / 1024:.1f} MB"
    )

if __name__ == "__main__":
    main()
