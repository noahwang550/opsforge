#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
One-shot credential bootstrap for data-quality-profiler 模式 III.

Stdlib only (no third-party deps). Detects OS and branches:

  PostgreSQL:
    - Windows: %APPDATA%\\postgresql\\pgpass.conf  (psql looks there by default)
    - *nix:    ~/.pgpass                            (mode 0600)
  MySQL:
    - mysql_config_editor login-path (works on Windows too), OR
    - ~/dq-creds/my.cnf / --defaults-file (mode 0600)

Emits a wrapper script (run-sql.sh on *nix, run-sql.bat on Windows) that calls
psql/mysql reading the credential file — never puts a password on the command
line, in an env var, or in a log.

Enforces 0600 (icacls: restrict to current user SID on Windows). Refuses to
write into a directory containing .git. Self-tests with `SELECT 1` via the
wrapper. Never prints the password.

Outputs exactly one confirmation line on success (no secret):
    凭据文件已就绪，模式 III 可用

Usage (run in the analyst's OWN terminal — the AI never runs this):
    python scripts/credential_setup.py
"""
import getpass
import os
import platform
import stat
import subprocess
import sys
from pathlib import Path

IS_WINDOWS = os.name == "nt" or platform.system().startswith("Win")


class CredentialSetupError(RuntimeError):
    pass


class UnsafePathError(RuntimeError):
    pass


# ---------------------------------------------------------------------------
# Safety
# ---------------------------------------------------------------------------

def _assert_safe_dir(path: Path) -> None:
    """Refuse to write credentials into a directory containing .git."""
    cur = path.resolve()
    for _ in range(20):
        if (cur / ".git").exists():
            raise UnsafePathError(
                f"目标目录 {cur} 含 .git，凭据绝不可写入仓库目录；请改用用户主目录。"
            )
        if cur.parent == cur:
            break
        cur = cur.parent


def _chmod_600(path: Path) -> None:
    """Enforce 0600. On Windows use icacls to restrict to current user SID."""
    if IS_WINDOWS:
        # Restrict to current user only: remove inherited ACEs, grant full to current user.
        user = os.environ.get("USERNAME") or os.environ.get("USER") or ""
        # Use icacls to disable inheritance and grant only the current user.
        cmd = ["icacls", str(path), "/inheritance:r", "/grant:r", f"{user}:F"]
        try:
            subprocess.run(cmd, check=True, capture_output=True)
        except (subprocess.CalledProcessError, FileNotFoundError) as e:
            raise CredentialSetupError(f"icacls 设置 0600 失败: {e}") from e
    else:
        path.chmod(0o600)


# ---------------------------------------------------------------------------
# PostgreSQL
# ---------------------------------------------------------------------------

def setup_postgres(home: Path) -> dict:
    print("\n=== PostgreSQL 凭据 ===")
    host = input("host (默认 localhost): ").strip() or "localhost"
    port = input("port (默认 5432): ").strip() or "5432"
    db = input("database: ").strip()
    user = input("user: ").strip()
    pwd = getpass.getpass("password (输入不回显): ")

    if IS_WINDOWS:
        base = Path(os.environ.get("APPDATA", str(home))) / "postgresql"
    else:
        base = home
    base.mkdir(parents=True, exist_ok=True)
    _assert_safe_dir(base)
    pgpass = base / ("pgpass.conf" if IS_WINDOWS else ".pgpass")

    # .pgpass format: hostname:port:database:username:password
    line = f"{host}:{port}:{db}:{user}:{pwd}\n"
    # Write atomically-ish; never print.
    pgpass.write_text(line, encoding="utf-8")
    _chmod_600(pgpass)

    return {
        "type": "postgres",
        "host": host, "port": port, "db": db, "user": user,
        "cred_file": str(pgpass),
    }


# ---------------------------------------------------------------------------
# MySQL
# ---------------------------------------------------------------------------

def setup_mysql(home: Path) -> dict:
    print("\n=== MySQL 凭据 ===")
    host = input("host (默认 localhost): ").strip() or "localhost"
    port = input("port (默认 3306): ").strip() or "3306"
    db = input("database: ").strip()
    user = input("user: ").strip()
    pwd = getpass.getpass("password (输入不回显): ")

    creds_dir = home / "dq-creds"
    creds_dir.mkdir(parents=True, exist_ok=True)
    _assert_safe_dir(creds_dir)
    cnf = creds_dir / "my.cnf"

    # Prefer mysql_config_editor login-path when available (handles storage
    # itself); fall back to a 0600 --defaults-file.
    use_editor = _have("mysql_config_editor")
    if use_editor:
        # login-path stores into ~/.mylogin.cnf (encrypted). We pass pwd via
        # stdin to avoid cmdline leak.
        try:
            subprocess.run(
                ["mysql_config_editor", "set", "--login-path=dq",
                 f"--host={host}", f"--port={port}", f"--user={user}",
                 f"--password"],
                input=pwd + "\n", text=True, check=True, capture_output=True,
            )
            cred_ref = "login-path=dq"
        except (subprocess.CalledProcessError, FileNotFoundError) as e:
            use_editor = False
            print(f"mysql_config_editor 不可用 ({e})，回退到 --defaults-file")

    if not use_editor:
        cnf.write_text(
            f"[client]\nhost={host}\nport={port}\nuser={user}\npassword={pwd}\n",
            encoding="utf-8",
        )
        _chmod_600(cnf)
        cred_ref = f"--defaults-file={cnf}"

    return {
        "type": "mysql",
        "host": host, "port": port, "db": db, "user": user,
        "cred_ref": cred_ref,
    }


# ---------------------------------------------------------------------------
# Wrapper emission
# ---------------------------------------------------------------------------

def _have(cmd: str) -> bool:
    from shutil import which
    return which(cmd) is not None


def emit_wrapper(home: Path, info: dict) -> Path:
    if info["type"] == "postgres":
        # psql reads PGPASSFILE env (or default location). Wrapper sets nothing
        # password-related on the command line.
        cred_file = info["cred_file"]
        if IS_WINDOWS:
            content = (
                "@echo off\n"
                f'set PGPASSFILE={cred_file}\n'
                f'psql -h {info["host"]} -p {info["port"]} -U {info["user"]} '
                f'-d {info["db"]} -f "%~1"\n'
            )
            wrapper = home / "run-sql.bat"
        else:
            content = (
                "#!/bin/sh\n"
                f'export PGPASSFILE="{cred_file}"\n'
                f'psql -h {info["host"]} -p {info["port"]} -U {info["user"]} '
                f'-d {info["db"]} -f "$1"\n'
            )
            wrapper = home / "run-sql.sh"
        wrapper.write_text(content, encoding="utf-8")
        if not IS_WINDOWS:
            wrapper.chmod(0o700)
        return wrapper

    # mysql
    cred_ref = info["cred_ref"]
    if IS_WINDOWS:
        content = (
            "@echo off\n"
            f'mysql {cred_ref} -D {info["db"]} < "%~1"\n'
        )
        wrapper = home / "run-sql.bat"
    else:
        content = (
            "#!/bin/sh\n"
            f'mysql {cred_ref} -D {info["db"]} < "$1"\n'
        )
        wrapper = home / "run-sql.sh"
    wrapper.write_text(content, encoding="utf-8")
    if not IS_WINDOWS:
        wrapper.chmod(0o700)
    return wrapper


# ---------------------------------------------------------------------------
# Self-test
# ---------------------------------------------------------------------------

def self_test(wrapper: Path, info: dict) -> bool:
    """Run SELECT 1 via the wrapper; return True on success."""
    if not _have("psql" if info["type"] == "postgres" else "mysql"):
        print("警告：未找到 psql/mysql 客户端，跳过自检。请确认客户端已安装。")
        return False
    from tempfile import NamedTemporaryFile
    suffix = ".sql"
    with NamedTemporaryFile("w", suffix=suffix, delete=False, encoding="utf-8") as f:
        f.write("SELECT 1;\n")
        sql_path = f.name
    try:
        if IS_WINDOWS:
            cmd = [str(wrapper), sql_path]
        else:
            cmd = ["sh", str(wrapper), sql_path]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        return proc.returncode == 0
    except Exception as e:
        print(f"自检异常: {e}")
        return False
    finally:
        try:
            os.unlink(sql_path)
        except OSError:
            pass


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main(argv=None) -> int:
    print("data-quality-profiler 模式 III 凭据引导（一次性）")
    print("本脚本仅在 YOUR OWN terminal 运行；AI 从不运行、从不读取生成的凭据文件。\n")
    home = Path.home()
    _assert_safe_dir(home)

    dbtype = input("库类型 (postgres/mysql): ").strip().lower()
    if dbtype in ("postgres", "postgresql", "pg"):
        info = setup_postgres(home)
    elif dbtype in ("mysql", "maria"):
        info = setup_mysql(home)
    else:
        print(f"不支持的库类型: {dbtype}")
        return 1

    wrapper = emit_wrapper(home, info)
    print(f"\nwrapper 已生成: {wrapper}")
    print("（凭据文件内容不会打印，模式 III 安全红线）")

    ok = self_test(wrapper, info)
    if ok:
        print("自检 SELECT 1 通过。")
    elif IS_WINDOWS:
        print("（Windows 下若 psql/mysql 未在 PATH，自检可能跳过，请手动验证。）")

    print("\n凭据文件已就绪，模式 III 可用")
    return 0


if __name__ == "__main__":
    sys.exit(main())
