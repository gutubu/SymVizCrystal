#!/usr/bin/env python3
"""Inventory commands shipped with a local Olex2 installation.

The script deliberately separates documented console commands from help.xld
entries and Python functions registered for GUI/plugin use.  These sources
describe different layers of Olex2 and should not be merged into one flat list.
"""

from __future__ import annotations

import argparse
import csv
import re
from collections import Counter
from datetime import date
from pathlib import Path

from lxml import html


CATEGORY_ZH = {
    "Changing the Model View": "改变模型视图",
    "Keyboard Shortcuts": "键盘快捷键",
    "Fixed/Refined Parameters": "固定或精修参数",
    "Atom Connectivity Table Manipulation": "原子连接表操作",
    "Symmetry Operations": "对称操作",
    "Disorder Modelling: Constraints and Restraints": "无序建模：约束与限制",
    "Selection Syntax": "选择语法",
    "HKL file Operations": "HKL 文件操作",
    "Customising the Olex2 GUI": "自定义 Olex2 界面",
    "Output: Tables, Reports and Images": "输出：表格、报告与图像",
    "Structure Analysis": "结构分析",
}


def clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", value.replace("\xa0", " ")).strip()


def read_revision(version_file: Path) -> str:
    if not version_file.exists():
        return "unknown"
    return clean_text(version_file.read_text(encoding="utf-8", errors="replace"))


def parse_documented_commands(commands_html: Path) -> list[dict[str, str]]:
    tree = html.parse(str(commands_html))
    records: list[dict[str, str]] = []

    for heading in tree.xpath("//h2"):
        category = clean_text(heading.text_content())
        if category not in CATEGORY_ZH:
            continue

        heading_rows = heading.xpath("ancestor::tr[1]")
        if not heading_rows:
            continue

        for row in heading_rows[0].itersiblings("tr"):
            if row.xpath(".//h1|.//h2"):
                break
            cells = row.xpath("./td")
            if len(cells) != 3:
                continue
            command = clean_text(cells[0].text_content())
            syntax = clean_text(cells[1].text_content())
            description = clean_text(cells[2].text_content())
            if not command:
                continue
            records.append(
                {
                    "category_en": category,
                    "category_zh": CATEGORY_ZH[category],
                    "command": command,
                    "syntax": syntax,
                    "description_en": description,
                }
            )
    return records


HELP_ENTRY_RE = re.compile(r"(?m)^ <(?P<name>[^\s>]+)(?P<attrs>[^\n>]*)")
HELP_TEXT_RE = re.compile(r'\bhelp="([^"]*)"')
CATEGORY_RE = re.compile(r"(?m)^\s+<category[^\n]*\n\s*<([^>\s]+)\s*>")


def parse_help_xld(help_xld: Path) -> list[dict[str, str]]:
    source = help_xld.read_text(encoding="utf-8", errors="replace")
    matches = list(HELP_ENTRY_RE.finditer(source))
    records: list[dict[str, str]] = []
    for index, match in enumerate(matches):
        start = match.start()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(source)
        block = source[start:end]
        help_match = HELP_TEXT_RE.search(match.group("attrs"))
        category_match = CATEGORY_RE.search(block)
        records.append(
            {
                "name": match.group("name"),
                "category": category_match.group(1) if category_match else "",
                "help_en": clean_text(help_match.group(1)) if help_match else "",
            }
        )
    return records


REGISTER_RE = re.compile(r"\b(?:OV|olex)\.registerFunction\(\s*([^,\)]+)([^\n]*)")
NAMESPACE_RE = re.compile(
    r"registerFunction\(\s*[^,]+,\s*[^,]+,\s*(['\"])([^'\"]+)\1"
)


def parse_python_registrations(install_dir: Path) -> list[dict[str, str]]:
    roots = [install_dir / "util", install_dir / "etc" / "scripts"]
    records: list[dict[str, str]] = []
    for root in roots:
        if not root.exists():
            continue
        for source_path in sorted(root.rglob("*.py")):
            source_posix = source_path.as_posix().lower()
            if "/__pycache__/" in source_posix:
                continue
            text = source_path.read_text(encoding="utf-8", errors="replace")
            for line_no, line in enumerate(text.splitlines(), 1):
                stripped = line.lstrip()
                if stripped.startswith("#"):
                    continue
                match = REGISTER_RE.search(line)
                if not match:
                    continue
                expression = clean_text(match.group(1))
                namespace_match = NAMESPACE_RE.search(line)
                namespace = namespace_match.group(2) if namespace_match else ""
                leaf = expression.rsplit(".", 1)[-1]
                callable_name = f"{namespace}.{leaf}" if namespace else expression
                records.append(
                    {
                        "callable": callable_name,
                        "namespace": namespace,
                        "registered_expression": expression,
                        "source_file": str(source_path.relative_to(install_dir)),
                        "line": str(line_no),
                    }
                )
    return records


def write_csv(path: Path, fieldnames: list[str], rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def markdown_escape(value: str) -> str:
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("|", "\\|")
        .replace("\n", " ")
    )


def write_markdown(
    path: Path,
    install_dir: Path,
    revision: str,
    documented: list[dict[str, str]],
    help_entries: list[dict[str, str]],
    registrations: list[dict[str, str]],
) -> None:
    category_counts = Counter(item["category_en"] for item in documented)
    shortcut_count = category_counts.get("Keyboard Shortcuts", 0)
    console_count = len(documented) - shortcut_count
    unique_console_names = sorted(
        {
            item["command"].casefold(): item["command"]
            for item in documented
            if item["category_en"] != "Keyboard Shortcuts"
        }.values(),
        key=str.casefold,
    )
    unique_callables = len({item["callable"].casefold() for item in registrations})

    lines = [
        "# Olex2 1.5 本机内置指令清单",
        "",
        f"- 安装目录：`{install_dir}`",
        f"- 版本标识：`{revision}`",
        f"- 盘点日期：{date.today().isoformat()}",
        f"- 官方 Commands.html 表项：{len(documented)}（控制台/操作项 {console_count}、去重名称 {len(unique_console_names)}，键盘快捷键 {shortcut_count}）",
        f"- help.xld 顶层条目：{len(help_entries)}",
        f"- Python 注册记录：{len(registrations)}（去重后的可调用名称 {unique_callables}）",
        "",
        "## 范围说明",
        "",
        "下面的主表来自本机安装包自带的 `etc/documentation/Commands.html`，是最适合作为用户控制台指令参考的清单。",
        "`help.xld` 还混合了命令、快捷键、表达式函数和界面宏；Python 注册项则大量用于 GUI 与插件内部调用，不能全部视为日常控制台命令。二者分别保存在 CSV 中，避免混淆。",
        "动态加载的第三方插件可能在 Olex2 启动后继续注册命令，因此静态安装文件盘点不能替代特定运行会话中的 `help`、`lstFun` 与 `lstMac` 输出。",
        "",
        "## 汇总",
        "",
        "| 类别 | 表项数 |",
        "|---|---:|",
    ]
    for category_en, category_zh in CATEGORY_ZH.items():
        lines.append(f"| {category_zh}（{category_en}） | {category_counts.get(category_en, 0)} |")

    lines.extend(
        [
            "",
            "## 控制台指令名称速览",
            "",
            ", ".join(f"`{name}`" for name in unique_console_names),
        ]
    )

    for category_en, category_zh in CATEGORY_ZH.items():
        category_rows = [item for item in documented if item["category_en"] == category_en]
        if not category_rows:
            continue
        lines.extend(
            [
                "",
                f"## {category_zh}",
                "",
                "| 指令/按键 | 语法 | 安装包自带说明（英文） |",
                "|---|---|---|",
            ]
        )
        for item in category_rows:
            lines.append(
                "| {command} | {syntax} | {description} |".format(
                    command=markdown_escape(item["command"]),
                    syntax=markdown_escape(item["syntax"]),
                    description=markdown_escape(item["description_en"]),
                )
            )

    lines.extend(
        [
            "",
            f"## help.xld 内置帮助索引（{len(help_entries)} 项）",
            "",
            "该索引混合了控制台命令、快捷键、表达式函数和界面宏；名称按本机文件原样保留。",
            "",
            "| 名称 | 类别 | 内置帮助（英文） |",
            "|---|---|---|",
        ]
    )
    for item in help_entries:
        lines.append(
            "| {name} | {category} | {help_text} |".format(
                name=markdown_escape(item["name"]),
                category=markdown_escape(item["category"]),
                help_text=markdown_escape(item["help_en"]),
            )
        )

    lines.extend(
        [
            "",
            "## 附加清单",
            "",
            "- `Olex2-1.5-help-xld.csv`：内置帮助索引中的全部顶层条目。",
            "- `Olex2-1.5-python-registered-callables.csv`：安装目录 Python 文件中的全部 `registerFunction` 注册记录，包含命名空间、源文件和行号。",
            "- `Olex2-1.5-documented-commands.csv`：主表的机器可读版本。",
            "",
        ]
    )
    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--install-dir",
        type=Path,
        default=Path(r"C:\Program Files\Olex2-1.5"),
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("reports") / "olex2",
    )
    args = parser.parse_args()

    install_dir = args.install_dir.resolve()
    output_dir = args.output_dir.resolve()
    commands_html = install_dir / "etc" / "documentation" / "Commands.html"
    help_xld = install_dir / "help.xld"
    if not commands_html.exists() or not help_xld.exists():
        raise SystemExit(f"Olex2 command sources not found under {install_dir}")

    documented = parse_documented_commands(commands_html)
    help_entries = parse_help_xld(help_xld)
    registrations = parse_python_registrations(install_dir)
    revision = read_revision(install_dir / "version.txt")

    write_csv(
        output_dir / "Olex2-1.5-documented-commands.csv",
        ["category_en", "category_zh", "command", "syntax", "description_en"],
        documented,
    )
    write_csv(
        output_dir / "Olex2-1.5-help-xld.csv",
        ["name", "category", "help_en"],
        help_entries,
    )
    write_csv(
        output_dir / "Olex2-1.5-python-registered-callables.csv",
        ["callable", "namespace", "registered_expression", "source_file", "line"],
        registrations,
    )
    write_markdown(
        output_dir / "Olex2-1.5-内置指令清单.md",
        install_dir,
        revision,
        documented,
        help_entries,
        registrations,
    )
    print(
        f"documented={len(documented)} help={len(help_entries)} "
        f"python_registrations={len(registrations)} output={output_dir}"
    )


if __name__ == "__main__":
    main()
