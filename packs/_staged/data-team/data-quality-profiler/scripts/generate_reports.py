#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Deterministic four-file report generator for the data-quality-profiler skill.

Consumes a strictly-validated results.json (never a DB, never credentials) and
emits exactly four fixed deliverables:

    数据字典.xlsx              (openpyxl, one sheet per table)
    业务统计结果.xlsx          (openpyxl, sheets per domain + embedded charts)
    整体数据质量分析报告.docx  (python-docx + matplotlib PNGs)
    各表体检明细.docx          (python-docx, per-table 5-dim score-bar PNG + table)

Hermetic: JSON-only input, writes only under --outdir, refuses paths inside a
repo root containing `.git`. Post-write verify_outputs() checks each file:
exists, >1KB, openable by the producing library, first 4KB free of NUL-byte
padding. Auto-re-emits missing/corrupt files up to 3 times; raises RuntimeError
listing still-bad files so the AI surfaces failure (never silently ships 2/4).

results.json strict schema (validated fail-fast by load_and_validate):

    {
      "schema_version": "1.0",
      "database": {"type": "MySQL|PostgreSQL", "name": str},
      "tables": [
        {
          "name": str, "row_count": int, "comment": str,
          "columns": [{"name": str, "type": str, "nullable": bool, "comment": str}],
          "scores": {"完整性": int, "唯一性": int, "有效性": int, "一致性": int, "及时性": int},
          "findings": [{"severity": "red|yellow|green", "metric": str, "desc": str, "so_what": str}]
        }
      ],
      "relations": [{"from": str, "to": str, "confidence": float, "evidence": str}],
      "business_stats": {
        "member_axis": [{"label": str, "value": int}],
        "channel_axis": [{"channel": str, "count": int, "gmv": float}],
        "monthly_trend": [{"month": str, "orders": int}]
      },
      "overall": {"tables_inspected": int, "red_count": int, "yellow_count": int, "green_count": int, "summary": str}
    }

Usage:
    python scripts/generate_reports.py --input results.json --outdir ./reports
"""
import argparse
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict, List

import matplotlib
matplotlib.use("Agg")  # headless backend; must be set before pyplot import
import matplotlib.pyplot as plt  # noqa: E402

import openpyxl  # noqa: E402
from openpyxl.chart import BarChart, LineChart, Reference  # noqa: E402
from openpyxl.styles import Font, PatternFill  # noqa: E402

from docx import Document  # noqa: E402
from docx.shared import Inches, Pt  # noqa: E402

# ---------------------------------------------------------------------------
# CJK font handling — try a list, fall back to English labels silently.
# ---------------------------------------------------------------------------
_CJK_FONTS = [
    "Microsoft YaHei", "SimHei", "PingFang SC", "Noto Sans CJK SC",
    "WenQuanYi Zen Hei", "Source Han Sans CN", "Heiti SC", "Arial Unicode MS",
]
_CJK_RESOLVED = False
_CJK_RESOLVED_NAME = None
try:
    import matplotlib.font_manager as fm
    available = {f.name for f in fm.fontManager.ttflist}
    for candidate in _CJK_FONTS:
        if candidate in available:
            plt.rcParams["font.sans-serif"] = [candidate, "DejaVu Sans"]
            plt.rcParams["axes.unicode_minus"] = False
            _CJK_RESOLVED = True
            _CJK_RESOLVED_NAME = candidate
            break
except Exception:
    pass

if not _CJK_RESOLVED:
    # No CJK font found: keep DejaVu Sans; Chinese axis labels may render as
    # boxes. We still emit charts; tables/docs carry the authoritative text.
    plt.rcParams["axes.unicode_minus"] = False


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------

class SchemaError(ValueError):
    """results.json does not match the strict schema."""


class CorruptOutputError(RuntimeError):
    """An emitted file is corrupt (e.g. NUL-byte padded) or unopenable."""


class UnsafePathError(RuntimeError):
    """An output path is unsafe (inside a repo root containing .git)."""


# ---------------------------------------------------------------------------
# Schema validation
# ---------------------------------------------------------------------------

_SCORE_KEYS = ["完整性", "唯一性", "有效性", "一致性", "及时性"]
_SEVERITIES = {"red", "yellow", "green"}


def _require(cond: bool, msg: str) -> None:
    if not cond:
        raise SchemaError(f"results.json schema error: {msg}")


def load_and_validate(path: Path) -> Dict[str, Any]:
    """Load results.json and validate strictly. Fail-fast on any deviation."""
    _require(path.exists() and path.stat().st_size > 0,
             f"results.json missing or empty: {path}")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise SchemaError(f"results.json is not valid JSON: {e}") from e

    _require(isinstance(data, dict), "top-level must be an object")
    _require(data.get("schema_version") == "1.0",
             "schema_version must be '1.0'")
    db = data.get("database")
    _require(isinstance(db, dict) and db.get("type") in ("MySQL", "PostgreSQL")
             and isinstance(db.get("name"), str), "database.{type,name} invalid")

    tables = data.get("tables")
    _require(isinstance(tables, list) and len(tables) >= 1, "tables must be a non-empty list")
    for i, t in enumerate(tables):
        _require(isinstance(t, dict), f"tables[{i}] must be an object")
        _require(isinstance(t.get("name"), str) and t["name"], f"tables[{i}].name required")
        _require(isinstance(t.get("row_count"), int), f"tables[{i}].row_count must be int")
        _require(isinstance(t.get("comment"), str), f"tables[{i}].comment must be str")
        cols = t.get("columns")
        _require(isinstance(cols, list) and len(cols) >= 1,
                 f"tables[{i}].columns must be non-empty list")
        for j, c in enumerate(cols):
            _require(isinstance(c, dict), f"tables[{i}].columns[{j}] must be object")
            _require(isinstance(c.get("name"), str) and c["name"],
                     f"tables[{i}].columns[{j}].name required")
            _require(isinstance(c.get("type"), str), f"tables[{i}].columns[{j}].type required")
            _require("nullable" in c, f"tables[{i}].columns[{j}].nullable required")
            _require(isinstance(c.get("comment"), str), f"tables[{i}].columns[{j}].comment required")
        scores = t.get("scores")
        _require(isinstance(scores, dict), f"tables[{i}].scores must be object")
        for k in _SCORE_KEYS:
            v = scores.get(k)
            _require(isinstance(v, int) and 0 <= v <= 100,
                     f"tables[{i}].scores.{k} must be int 0-100")
        findings = t.get("findings", [])
        _require(isinstance(findings, list), f"tables[{i}].findings must be list")
        for fi, f in enumerate(findings):
            _require(isinstance(f, dict), f"tables[{i}].findings[{fi}] must be object")
            _require(f.get("severity") in _SEVERITIES,
                     f"tables[{i}].findings[{fi}].severity invalid")
            _require(isinstance(f.get("desc"), str),
                     f"tables[{i}].findings[{fi}].desc required")
            _require(isinstance(f.get("so_what"), str),
                     f"tables[{i}].findings[{fi}].so_what required")

    rels = data.get("relations", [])
    _require(isinstance(rels, list), "relations must be a list")
    for ri, r in enumerate(rels):
        _require(isinstance(r, dict), f"relations[{ri}] must be object")
        _require(isinstance(r.get("from"), str) and isinstance(r.get("to"), str),
                 f"relations[{ri}].from/.to required")

    bs = data.get("business_stats", {})
    _require(isinstance(bs, dict), "business_stats must be an object")
    for key in ("member_axis", "channel_axis", "monthly_trend"):
        _require(isinstance(bs.get(key), list), f"business_stats.{key} must be list")

    overall = data.get("overall")
    _require(isinstance(overall, dict), "overall must be an object")
    _require(isinstance(overall.get("summary"), str), "overall.summary must be str")
    return data


# ---------------------------------------------------------------------------
# Safety helpers
# ---------------------------------------------------------------------------

def assert_outdir_safe(outdir: Path) -> None:
    """Refuse to write inside a repo root containing .git."""
    outdir = outdir.resolve()
    cur = outdir
    for _ in range(20):  # bounded walk up
        if (cur / ".git").exists():
            raise UnsafePathError(
                f"outdir {outdir} is inside a repo root ({cur}) containing .git; "
                "refusing to write deliverables there."
            )
        if cur.parent == cur:
            break
        cur = cur.parent


# ---------------------------------------------------------------------------
# NUL-byte detection
# ---------------------------------------------------------------------------

def has_nul_padding(path: Path, window: int = 4096, threshold: int = 256) -> bool:
    """True if the first `window` bytes contain a long run of NUL bytes
    indicative of corrupt/truncated padding. Real ZIP-based .xlsx/.docx files
    contain isolated NUL bytes in their binary structure, so we detect *runs*
    (>= threshold consecutive NUL bytes), not any NUL byte."""
    try:
        with open(path, "rb") as f:
            head = f.read(window)
    except OSError:
        return True
    run = 0
    for b in head:
        if b == 0:
            run += 1
            if run >= threshold:
                return True
        else:
            run = 0
    return False


def assert_no_nul_bytes(path: Path) -> None:
    """Raise CorruptOutputError if path contains NUL-byte padding."""
    if has_nul_padding(path):
        raise CorruptOutputError(f"NUL-byte padding detected in {path}")


# ---------------------------------------------------------------------------
# Builders
# ---------------------------------------------------------------------------

def build_data_dictionary(data: Dict[str, Any], outdir: Path) -> Path:
    path = outdir / "数据字典.xlsx"
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    header_font = Font(bold=True)
    for t in data["tables"]:
        name = t["name"]
        ws = wb.create_sheet(title=name[:31])
        headers = ["字段名", "类型", "可空", "注释", "语义"]
        ws.append(headers)
        for col_idx in range(1, len(headers) + 1):
            ws.cell(row=1, column=col_idx).font = header_font
        for col in t["columns"]:
            ws.append([
                col["name"], col["type"],
                "是" if col["nullable"] else "否",
                col["comment"], col.get("comment", "") or "",
            ])
        ws.append([])
        ws.append(["表注释", t["comment"]])
        ws.append(["行数", t["row_count"]])
    wb.save(path)
    return path


def build_business_stats(data: Dict[str, Any], outdir: Path) -> Path:
    path = outdir / "业务统计结果.xlsx"
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    bs = data.get("business_stats", {})

    # 渠道轴 + 会员轴 sheet
    ws = wb.create_sheet(title="双轴统计")
    ws.append(["渠道轴"])
    ws.append(["渠道", "订单量", "GMV"])
    for col_idx in range(1, 4):
        ws.cell(row=2, column=col_idx).font = Font(bold=True)
    for row in bs.get("channel_axis", []):
        ws.append([row.get("channel", ""), row.get("count", 0), row.get("gmv", 0.0)])
    if bs.get("channel_axis"):
        chart = BarChart()
        chart.type = "col"
        chart.title = "渠道轴-订单量"
        chart.height = 8
        chart.width = 16
        nrows = len(bs["channel_axis"])
        data_ref = Reference(ws, min_col=2, min_row=2, max_row=2 + nrows)
        cats = Reference(ws, min_col=1, min_row=3, max_row=2 + nrows)
        chart.add_data(data_ref, titles_from_data=True)
        chart.set_categories(cats)
        ws.add_chart(chart, "E2")

    ws.append([])
    ws.append(["会员轴"])
    ws.append(["分类", "订单量"])
    member_header_row = ws.max_row
    for col_idx in range(1, 3):
        ws.cell(row=member_header_row, column=col_idx).font = Font(bold=True)
    for row in bs.get("member_axis", []):
        ws.append([row.get("label", ""), row.get("value", 0)])

    # 近24月趋势 sheet
    wt = wb.create_sheet(title="近24月趋势")
    wt.append(["月份", "订单量"])
    for col_idx in range(1, 3):
        wt.cell(row=1, column=col_idx).font = Font(bold=True)
    for row in bs.get("monthly_trend", []):
        wt.append([row.get("month", ""), row.get("orders", 0)])
    if bs.get("monthly_trend"):
        lc = LineChart()
        lc.title = "近24月订单趋势"
        lc.height = 8
        lc.width = 18
        nrows = len(bs["monthly_trend"])
        data_ref = Reference(wt, min_col=2, min_row=1, max_row=1 + nrows)
        cats = Reference(wt, min_col=1, min_row=2, max_row=1 + nrows)
        lc.add_data(data_ref, titles_from_data=True)
        lc.set_categories(cats)
        wt.add_chart(lc, "E2")

    # 总览 sheet
    wo = wb.create_sheet(title="总览", index=0)
    ov = data.get("overall", {})
    wo.append(["整体总览"])
    wo["A1"].font = Font(bold=True, size=14)
    wo.append(["体检表数", ov.get("tables_inspected", "")])
    wo.append(["红灯", ov.get("red_count", "")])
    wo.append(["黄灯", ov.get("yellow_count", "")])
    wo.append(["绿灯", ov.get("green_count", "")])
    wo.append(["小结", ov.get("summary", "")])
    wo.append(["数据库", f"{data['database']['type']} / {data['database']['name']}"])

    wb.save(path)
    return path


def _sev_color(sev: str) -> str:
    return {"red": "#D9534F", "yellow": "#F0AD4E", "green": "#5CB85C"}.get(sev, "#999999")


def render_score_bar(scores: Dict[str, int], out_path: Path, title: str = "五维评分") -> Path:
    fig, ax = plt.subplots(figsize=(7, 3.2))
    keys = list(scores.keys())
    vals = [scores[k] for k in keys]
    colors = ["#5CB85C" if v >= 85 else "#F0AD4E" if v >= 70 else "#D9534F" for v in vals]
    ax.bar(keys, vals, color=colors)
    ax.set_ylim(0, 100)
    ax.set_ylabel("分")
    ax.set_title(title)
    for i, v in enumerate(vals):
        ax.text(i, v + 2, str(v), ha="center", fontsize=10)
    fig.tight_layout()
    fig.savefig(out_path, dpi=120)
    plt.close(fig)
    return out_path


def render_trend_chart(trend: List[Dict[str, Any]], out_path: Path) -> Path:
    fig, ax = plt.subplots(figsize=(7, 3.2))
    months = [r.get("month", "") for r in trend]
    vals = [r.get("orders", 0) for r in trend]
    ax.plot(months, vals, marker="o", color="#337AB7")
    ax.set_title("近24月订单趋势")
    ax.set_ylabel("订单量")
    fig.tight_layout()
    fig.savefig(out_path, dpi=120)
    plt.close(fig)
    return out_path


def render_distribution_chart(axis_data: List[Dict[str, Any]], out_path: Path,
                              title: str = "分布") -> Path:
    fig, ax = plt.subplots(figsize=(7, 3.2))
    labels = [r.get("label") or r.get("channel", "") for r in axis_data]
    vals = [r.get("value") or r.get("count", 0) for r in axis_data]
    ax.bar(labels, vals, color="#5BC0DE")
    ax.set_title(title)
    fig.tight_layout()
    fig.savefig(out_path, dpi=120)
    plt.close(fig)
    return out_path


def build_overall_report(data: Dict[str, Any], outdir: Path) -> Path:
    path = outdir / "整体数据质量分析报告.docx"
    doc = Document()
    ov = data.get("overall", {})

    doc.add_heading("整体数据质量分析报告", level=0)
    doc.add_paragraph(
        f"数据库：{data['database']['type']} / {data['database']['name']}；"
        f"体检表数：{ov.get('tables_inspected', '-')}"
    )

    # 红黄绿总览条
    try:
        bar_path = outdir / "_overview_bar.png"
        fig, ax = plt.subplots(figsize=(7, 1.2))
        counts = [ov.get("red_count", 0), ov.get("yellow_count", 0), ov.get("green_count", 0)]
        labels = ["红灯", "黄灯", "绿灯"]
        colors = ["#D9534F", "#F0AD4E", "#5CB85C"]
        ax.barh(labels, counts, color=colors)
        ax.set_title("红黄绿总览")
        for i, v in enumerate(counts):
            ax.text(v + 0.1, i, str(v), va="center")
        fig.tight_layout()
        fig.savefig(bar_path, dpi=120)
        plt.close(fig)
        doc.add_picture(str(bar_path), width=Inches(5.5))
    except Exception:
        doc.add_paragraph("[红黄绿总览条图表生成失败，见文字版]")
        doc.add_paragraph(
            f"红灯 {ov.get('red_count', '-')}，黄灯 {ov.get('yellow_count', '-')}，"
            f"绿灯 {ov.get('green_count', '-')}"
        )

    # 风险 TOP 条形图
    try:
        risk_path = outdir / "_risk_top.png"
        risks = []
        for t in data["tables"]:
            for fnd in t.get("findings", []):
                if fnd.get("severity") in ("red", "yellow"):
                    risks.append((f"{t['name']}.{fnd['metric']}", fnd.get("desc", "")))
        if risks:
            fig, ax = plt.subplots(figsize=(7, max(2.0, 0.4 * len(risks) + 1)))
            names = [r[0] for r in risks]
            y_pos = list(range(len(names)))
            ax.barh(y_pos, [1] * len(names),
                    color=[_sev_color("red")] * len(names))
            ax.set_yticks(y_pos)
            ax.set_yticklabels(names)
            ax.set_title("风险 TOP")
            ax.set_xticks([])
            fig.tight_layout()
            fig.savefig(risk_path, dpi=120)
            plt.close(fig)
            doc.add_picture(str(risk_path), width=Inches(5.5))
    except Exception:
        doc.add_paragraph("[风险TOP条形图生成失败]")

    doc.add_heading("小结", level=1)
    doc.add_paragraph(ov.get("summary", ""))

    doc.add_heading("定稿表关系图", level=1)
    for r in data.get("relations", []):
        doc.add_paragraph(
            f"{r['from']} → {r['to']}（置信度 {r.get('confidence', '-')}; "
            f"证据：{r.get('evidence', '-')}）"
        )
    if not data.get("relations"):
        doc.add_paragraph("（未确认任何表关系）")

    doc.add_heading("风险清单", level=1)
    for t in data["tables"]:
        for fnd in t.get("findings", []):
            p = doc.add_paragraph()
            r = p.add_run(f"【{t['name']}·{fnd['metric']}·{fnd['severity']}】 {fnd['desc']}")
            r.font.color.rgb = None
            doc.add_paragraph(f"所以呢：{fnd.get('so_what', '')}", style="Intense Quote")

    doc.save(path)
    return path


def build_table_details(data: Dict[str, Any], outdir: Path) -> Path:
    path = outdir / "各表体检明细.docx"
    doc = Document()
    doc.add_heading("各表体检明细", level=0)

    for t in data["tables"]:
        doc.add_heading(f"{t['name']}（{t['comment']}，{t['row_count']} 行）", level=1)
        scores = t.get("scores", {})

        # 5-dim score-bar PNG
        try:
            png = outdir / f"_score_{t['name']}.png"
            render_score_bar(scores, png, title=f"{t['name']} 五维评分")
            doc.add_picture(str(png), width=Inches(5.5))
        except Exception:
            doc.add_paragraph("[五维评分图生成失败，见下表文字版]")

        # scoring table
        table = doc.add_table(rows=1, cols=3)
        hdr = table.rows[0].cells
        hdr[0].text, hdr[1].text, hdr[2].text = "维度", "得分", "灯"
        for k in _SCORE_KEYS:
            v = scores.get(k, 0)
            light = "绿" if v >= 85 else "黄" if v >= 70 else "红"
            row = table.add_row().cells
            row[0].text, row[1].text, row[2].text = k, str(v), light

        doc.add_heading("发现", level=2)
        for fnd in t.get("findings", []):
            doc.add_paragraph(
                f"【{fnd['severity']}】{fnd['metric']}：{fnd['desc']} → 所以呢：{fnd.get('so_what', '')}"
            )
        doc.add_paragraph("")

    doc.save(path)
    return path


# ---------------------------------------------------------------------------
# Verify + re-emit
# ---------------------------------------------------------------------------

def _file_openable(path: Path) -> bool:
    try:
        if path.suffix == ".xlsx":
            openpyxl.load_workbook(path)
        elif path.suffix == ".docx":
            Document(str(path))
        else:
            return False
    except Exception:
        return False
    return True


def verify_outputs(outdir: Path) -> Dict[str, Any]:
    expected = [
        "数据字典.xlsx",
        "业务统计结果.xlsx",
        "整体数据质量分析报告.docx",
        "各表体检明细.docx",
    ]
    files: Dict[str, Dict[str, Any]] = {}
    all_ok = True
    for name in expected:
        fp = outdir / name
        status = {
            "exists": fp.exists(),
            "size_ok": fp.exists() and fp.stat().st_size > 1024,
            "openable": _file_openable(fp) if fp.exists() else False,
            "no_nul": (not has_nul_padding(fp)) if fp.exists() else False,
        }
        status["ok"] = all(status.values())
        files[name] = status
        if not status["ok"]:
            all_ok = False
    return {"ok": all_ok, "files": files}


def re_emit(data: Dict[str, Any], outdir: Path, only: List[str]) -> None:
    builders = {
        "数据字典.xlsx": build_data_dictionary,
        "业务统计结果.xlsx": build_business_stats,
        "整体数据质量分析报告.docx": build_overall_report,
        "各表体检明细.docx": build_table_details,
    }
    for name in only:
        builders[name](data, outdir)


def generate_all(data: Dict[str, Any], outdir: Path) -> None:
    cleanup_chart_artifacts(outdir)  # remove stale _*.png from prior runs
    build_data_dictionary(data, outdir)
    build_business_stats(data, outdir)
    build_overall_report(data, outdir)
    build_table_details(data, outdir)


def cleanup_chart_artifacts(outdir: Path) -> None:
    """Remove intermediate chart PNGs (prefixed with '_') left in the outdir.

    These are working artifacts embedded into .docx files; they should not
    ship alongside the four named deliverables.
    """
    for png in outdir.glob("_*.png"):
        try:
            png.unlink()
        except OSError:
            pass


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main(argv: List[str] = None) -> None:
    parser = argparse.ArgumentParser(description="Deterministic four-file report generator")
    parser.add_argument("--input", required=True, help="path to results.json")
    parser.add_argument("--outdir", required=True, help="output directory")
    args = parser.parse_args(argv)

    inp = Path(args.input).resolve()
    outdir = Path(args.outdir).resolve()
    assert_outdir_safe(outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    data = load_and_validate(inp)

    # Initial generation
    generate_all(data, outdir)

    # verify + retry loop (max 3 re-emit rounds)
    max_rounds = 3
    for _round in range(1, max_rounds + 1):
        report = verify_outputs(outdir)
        if report["ok"]:
            cleanup_chart_artifacts(outdir)  # don't ship intermediate _*.png
            return
        bad = [name for name, st in report["files"].items() if not st["ok"]]
        if _round == max_rounds:
            raise RuntimeError(
                f"generate_reports: {len(bad)} file(s) still failing after "
                f"{max_rounds} re-emit round(s): {bad}. "
                f"Detail: {report}. Aborting — refusing to silently ship partial 4-file set."
            )
        re_emit(data, outdir, bad)


if __name__ == "__main__":
    main()
