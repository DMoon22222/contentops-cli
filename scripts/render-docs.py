"""Build reviewed Markdown into offline HTML. Never edits source documents."""
from __future__ import annotations

import argparse
from dataclasses import dataclass
import hashlib
import html
from importlib.metadata import version
import json
import os
from pathlib import Path
import re
import unicodedata
from urllib.parse import quote, unquote, urlsplit, urlunsplit

from markdown_it import MarkdownIt

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "demo/docs"


@dataclass(frozen=True)
class Document:
    source: str
    filename: str
    kind: str
    historical: bool = False


DOCUMENTS = (
    Document("docs/01-需求与接口分析.md", "01-requirements.html", "需求与接口", True),
    Document("docs/02-第一阶段MVP与CLI产品方案.md", "02-product-plan.html", "产品评审", True),
    Document("docs/03-Java技术架构与实施方案.md", "03-architecture.html", "技术评审", True),
    Document("docs/04-交付物规划与验收清单.md", "04-delivery-plan.html", "交付计划", True),
    Document("docs/06-实际操作记录.md", "06-operation-record.html", "任务二 · Java Mock 实测"),
    Document("docs/07-Agent批量处理方案.md", "07-agent-plan.html", "任务三 · 未来设计"),
    Document("README.md", "readme.html", "当前实现与运行说明"),
    Document("evidence/task2/README.md", "task2-evidence.html", "任务二 · 原始证据索引"),
    Document("evidence/s5/README.md", "s5-evidence.html", "S5 · 受控故障证据索引"),
    Document("题目：内容运营后台 CLI 化.md", "assignment.html", "原始题目"),
    Document("内容运营后台接口数据/README.md", "attachment-guide.html", "原始附件说明"),
)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def slug(text: str) -> str:
    # Only heading IDs are normalized; Markdown text and code are not rewritten.
    value = "".join(c for c in text.strip().lower()
                    if c in "_-" or not unicodedata.category(c).startswith(("P", "S")))
    return re.sub(r"\s+", "-", value) or "heading"


def inline_text(tokens) -> str:
    return "".join(inline_text(t.children) if t.children else t.content
                   for t in (tokens or []) if t.type not in {"html_inline"})


class ReviewRenderer:
    def __init__(self, root: Path = ROOT, documents=DOCUMENTS):
        self.root = root.resolve()
        self.documents = tuple(documents)
        self.by_path = {(self.root / d.source).resolve(): d for d in documents}
        self.md = MarkdownIt("js-default", {"html": False, "linkify": False,
                                             "typographer": False})
        # Raw HTML is escaped by the parser. Markdown images become text links,
        # so even an external image cannot initiate an automatic network request.
        self.md.add_render_rule("image", self.render_image)
        self.md.add_render_rule("table_open", self.table_open)
        self.md.add_render_rule("table_close", self.table_close)
        self.prepared = {}
        for doc in self.documents:
            source = self.root / doc.source
            raw = source.read_bytes()
            tokens = self.md.parse(raw.decode("utf-8-sig"))
            headings, aliases, seen = [], {}, {}
            for i, token in enumerate(tokens):
                if token.type != "heading_open":
                    continue
                title = inline_text(tokens[i + 1].children)
                base = slug(title)
                number = seen.get(base, 0)
                seen[base] = number + 1
                legacy = base + (f"-{number}" if number else "")
                anchor = "section-" + legacy  # Prevent document/DOM-name collisions.
                token.attrSet("id", anchor)
                aliases[legacy] = anchor
                aliases[anchor] = anchor
                aliases.setdefault(title, anchor)
                headings.append({"level": int(token.tag[1:]), "title": title, "id": anchor})
            self.prepared[doc.source] = {"raw": raw, "tokens": tokens,
                                         "headings": headings, "aliases": aliases}

    @staticmethod
    def table_open(renderer, tokens, idx, options, env):
        return '<div class="table-scroll" tabindex="0" role="region" aria-label="可横向滚动的文档表格"><table>\n'

    @staticmethod
    def table_close(renderer, tokens, idx, options, env):
        return "</table></div>\n"

    @staticmethod
    def render_image(renderer, tokens, idx, options, env):
        token = tokens[idx]
        label = inline_text(token.children) or "图片"
        return '<span class="image-reference">[图片：' + html.escape(label) + "]</span>"

    def relative(self, path: Path) -> str:
        return quote(Path(os.path.relpath(path, self.root / "demo/docs")).as_posix(), safe="/-._~")

    def rewrite_link(self, href: str, source: str) -> tuple[str | None, bool]:
        # Accept explicit web links, not active schemes, network-path URLs or
        # absolute filesystem URLs. Relative destinations must stay in this repo.
        parsed = urlsplit(href)
        if parsed.scheme:
            return (href, False) if parsed.scheme.lower() in {"https", "http", "mailto"} else (None, False)
        if parsed.netloc or "\\" in href or any(ord(c) < 32 for c in unquote(href)):
            return None, False
        source_path = self.root / source
        target = (source_path.parent / unquote(parsed.path)).resolve() if parsed.path else source_path.resolve()
        if not target.is_relative_to(self.root):
            return None, False
        mapped = self.by_path.get(target)
        fragment = unquote(parsed.fragment)
        if mapped:
            if fragment:
                aliases = self.prepared[mapped.source]["aliases"]
                fragment = aliases.get(fragment, aliases.get(slug(fragment), fragment))
            dest = "" if not parsed.path and source == mapped.source else mapped.filename
        else:
            dest = self.relative(target)
        return urlunsplit(("", "", dest, parsed.query, quote(fragment, safe="-._~"))), target.suffix.lower() == ".md" and not mapped

    def content(self, doc: Document) -> str:
        # Reparse per render, so link rewriting never mutates reusable tokens.
        prepared = self.prepared[doc.source]
        tokens = self.md.parse(prepared["raw"].decode("utf-8-sig"))
        headings = iter(prepared["headings"])
        for token in tokens:
            if token.type == "heading_open":
                token.attrSet("id", next(headings)["id"])
            if token.type in {"th_open", "td_open"} and token.attrGet("style"):
                alignment = token.attrGet("style").removeprefix("text-align:")
                token.attrs.pop("style", None)
                if alignment in {"left", "center", "right"}:
                    token.attrSet("class", "align-" + alignment)
            for child in token.children or []:
                if child.type == "link_open":
                    href, raw = self.rewrite_link(child.attrGet("href") or "", doc.source)
                    if href is None:
                        child.attrSet("href", "#document-top")
                        child.attrSet("title", "已禁用不安全链接")
                        child.attrSet("class", "disabled-link")
                    else:
                        child.attrSet("href", href)
                        if raw:
                            child.attrSet("class", "raw-link")
                            child.attrSet("title", "原始 Markdown 文件（不属于本轮阅读版范围）")
                        elif urlsplit(href).scheme:
                            child.attrSet("rel", "noreferrer noopener")
        return self.md.renderer.render(tokens, self.md.options, {})

    def page(self, doc: Document) -> str:
        prepared = self.prepared[doc.source]
        title = prepared["headings"][0]["title"] if prepared["headings"] else Path(doc.source).stem
        toc = "\n".join(f'<li class="toc-level-{h["level"]}"><a href="#{h["id"]}">{html.escape(h["title"])}</a></li>'
                        for h in prepared["headings"] if h["level"] in {2, 3})
        if not toc:
            toc = '<li><a href="#document-top">正文</a></li>'
        notice = ('<p class="stage-note">本文保留对应阶段的设计与决策记录；当前实现情况请以<a href="../index.html#product">产品概览</a>和<a href="readme.html">README</a>为准。</p>' if doc.historical else "")
        return f'''<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'">
  <meta name="source-sha256" content="{digest(prepared['raw'])}">
  <title>{html.escape(title)} · ContentOps 文档</title>
  <link rel="stylesheet" href="reading.css">
</head>
<body id="document-top">
  <a class="skip-link" href="#document-body">跳至正文</a>
  <header class="reading-header"><a href="../index.html#product">← 返回主 Demo</a><span>ContentOps CLI / 评审文档</span><a href="index.html">全部阅读文档</a></header>
  <div class="reading-layout">
    <aside class="reading-toc"><details open><summary>章节目录</summary><nav aria-label="章节目录"><ul>{toc}</ul></nav></details></aside>
    <main id="document-body" tabindex="-1">
      <div class="document-meta"><span>{html.escape(doc.kind)}</span><a href="{self.relative(self.root / doc.source)}">原始 Markdown 文件</a></div>
{notice}
      <article class="markdown-body">{self.content(doc)}</article>
      <footer><a href="#document-top">返回顶部 ↑</a><span>静态阅读版 · 正文来源 {html.escape(doc.source)}</span></footer>
    </main>
  </div>
</body>
</html>
'''

    def build(self, output: Path = OUT, check: bool = False) -> dict:
        files = {}
        manifest = {"generator": "scripts/render-docs.py", "markdown_it_py": version("markdown-it-py"),
                    "mdurl": version("mdurl"), "documents": []}
        for doc in self.documents:
            page = self.page(doc)
            files[doc.filename] = page
            p = self.prepared[doc.source]
            tokens = p["tokens"]
            manifest["documents"].append({"source": doc.source, "html": doc.filename, "kind": doc.kind,
                "historical": doc.historical, "source_sha256": digest(p["raw"]), "html_sha256": digest(page.encode("utf-8")),
                "headings": p["headings"], "tables": sum(t.type == "table_open" for t in tokens),
                "code_blocks": sum(t.type in {"fence", "code_block"} for t in tokens)})
        items = "\n".join(f'<li><a href="{d.filename}">{html.escape(self.prepared[d.source]["headings"][0]["title"])}</a><span>{html.escape(d.kind)}</span></li>' for d in self.documents)
        files["index.html"] = f'''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'"><title>评审文档 · ContentOps CLI</title><link rel="stylesheet" href="reading.css"></head><body><header class="reading-header"><a href="../index.html#product">← 返回主 Demo</a><span>ContentOps CLI / 文档</span></header><main class="document-index"><h1>评审文档</h1><p>先看产品概览和运行说明，再按需阅读设计、操作与原始依据。正文由源 Markdown 预生成；无需构建即可离线打开。</p><ul>{items}</ul></main></body></html>
'''
        files["links.js"] = "// Generated by scripts/render-docs.py; source-to-reading-page mapping.\nwindow.REVIEW_DOCUMENTS = " + json.dumps({d.source: d.filename for d in self.documents}, ensure_ascii=False, indent=2) + ";\n"
        files["manifest.json"] = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
        for name, text in files.items():
            data = text.encode("utf-8")
            dest = output / name
            if check:
                if not dest.exists() or dest.read_bytes() != data:
                    raise ValueError(f"Generated file is missing or stale: {dest}")
            else:
                output.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(data)
        return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Verify committed output without writing")
    args = parser.parse_args()
    for package, pinned in (("markdown-it-py", "4.2.0"), ("mdurl", "0.1.2")):
        if version(package) != pinned:
            parser.error(f"Expected {package}=={pinned}; use scripts/requirements-docs.txt")
    result = ReviewRenderer().build(check=args.check)
    print(f"{'CHECK' if args.check else 'BUILD'}: {len(result['documents'])} documents; source Markdown unchanged")


if __name__ == "__main__":
    main()
