"""Renderer regression and content/link integrity; no browser or Java writes."""
import importlib.util
from html.parser import HTMLParser
import json
from pathlib import Path
import sys
import shutil
import unittest
import uuid
from urllib.parse import unquote, urlsplit

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("review_docs", Path(__file__).with_name("render-docs.py"))
renderer = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = renderer
spec.loader.exec_module(renderer)


class Page(HTMLParser):
    def __init__(self, value):
        super().__init__(convert_charrefs=True)
        self.elements = []
        self.ids = []
        self.codes = []
        self.headings = []
        self.text = []
        self._code = None
        self._heading = None
        self.feed(value)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        self.elements.append((tag, attrs))
        if "id" in attrs:
            self.ids.append(attrs["id"])
        if tag == "pre":
            self._code = ""
        if tag in {"h1", "h2", "h3", "h4", "h5", "h6"}:
            self._heading = [tag, ""]

    def handle_endtag(self, tag):
        if tag == "pre":
            self.codes.append(self._code)
            self._code = None
        if self._heading and tag == self._heading[0]:
            self.headings.append(self._heading)
            self._heading = None

    def handle_data(self, value):
        self.text.append(value)
        if self._code is not None:
            self._code += value
        if self._heading:
            self._heading[1] += value


class RendererTest(unittest.TestCase):
    def setUp(self):
        self.test_base = (renderer.ROOT / ".contentops/demo-docs-tests").resolve()
        self.root = self.test_base / uuid.uuid4().hex
        self.root.mkdir(parents=True)
        (self.root / "docs").mkdir()
        (self.root / "proof.txt").write_text("proof", encoding="utf-8")
        self.docs = (renderer.Document("docs/a.md", "a.html", "测试", True),
                     renderer.Document("docs/b.md", "b.html", "测试"))
        self.write("# 测试标题\n\n## 1. 子章节\n\n正文 **重点** 与 `代码`。\n\n### English heading\n\n> 引用\n\n1. 顺序一\n2. 顺序二\n\n- 无序\n\n| 参数 | 值 |\n| --- | ---: |\n| page | 20 |\n\n```json\n{\"正文\": \"<script>literal</script>\"}\n```\n")

    def tearDown(self):
        # Delete only this test's verified UUID directory within the workspace.
        self.assertTrue(self.root.resolve().is_relative_to(self.test_base))
        self.assertEqual(self.root.parent, self.test_base)
        shutil.rmtree(self.root)

    def write(self, text):
        (self.root / "docs/a.md").write_text(text, encoding="utf-8")
        (self.root / "docs/b.md").write_text("# 第二份\n\n## 章节 B\n", encoding="utf-8")
        self.engine = renderer.ReviewRenderer(self.root, self.docs)

    def test_commonmark_and_table_structure(self):
        page = Page(self.engine.content(self.docs[0]))
        tags = [t for t, _ in page.elements]
        for tag in ("h1", "h2", "h3", "strong", "code", "ol", "ul", "blockquote", "table", "thead", "tbody", "pre"):
            self.assertIn(tag, tags)
        self.assertIn(("td", {"class": "align-right"}), page.elements)
        self.assertFalse(any("style" in a for _, a in page.elements))

    def test_code_is_escaped_without_losing_text(self):
        page = Page(self.engine.content(self.docs[0]))
        self.assertEqual(page.codes, ['{"正文": "<script>literal</script>"}\n'])
        self.assertNotIn("script", [t for t, _ in page.elements])

    def test_duplicate_and_chinese_heading_ids(self):
        self.write("# 标题\n\n## 测试\n\n## 测试\n\n## constructor\n\n## English heading!\n")
        page = Page(self.engine.content(self.docs[0]))
        self.assertEqual(page.ids, ["section-标题", "section-测试", "section-测试-1", "section-constructor", "section-english-heading"])

    def test_same_document_anchor(self):
        self.assertEqual(self.engine.rewrite_link("#1-子章节", "docs/a.md")[0], "#section-1-%E5%AD%90%E7%AB%A0%E8%8A%82")

    def test_cross_document_anchor(self):
        self.assertEqual(unquote(self.engine.rewrite_link("b.md#章节-b", "docs/a.md")[0]), "b.html#section-章节-b")

    def test_code_and_evidence_rebased_to_source(self):
        self.assertEqual(self.engine.rewrite_link("../proof.txt", "docs/a.md")[0], "../../proof.txt")

    def test_raw_unselected_markdown_is_labeled(self):
        (self.root / "extra.md").write_text("# 原稿", encoding="utf-8")
        self.write("# 标题\n\n[原稿](../extra.md)\n")
        self.assertIn('class="raw-link"', self.engine.content(self.docs[0]))

    def test_dangerous_destinations_rejected(self):
        for href in ("javascript:alert(1)", "data:text/html,test", "file:///C:/secret", "//evil.example/a", "../../../outside", "../a%00b", "..\\secret"):
            with self.subTest(href=href):
                self.assertIsNone(self.engine.rewrite_link(href, "docs/a.md")[0])

    def test_no_html_script_or_remote_image_execution(self):
        self.write('# 标题\n\n<script>alert(1)</script>\n\n<iframe src="https://evil.invalid"></iframe>\n\n![远程图](https://evil.invalid/a.png)\n\n[危险](javascript:alert(1))\n')
        page = Page(self.engine.page(self.docs[0]))
        self.assertFalse(set(t for t, _ in page.elements) & {"script", "img", "iframe", "object", "style"})
        self.assertIn("<script>alert(1)</script>", "".join(page.text))
        self.assertFalse(any(a.get("href", "").startswith("javascript:") for _, a in page.elements))

    def test_explicit_external_links_remain_hyperlinks(self):
        self.assertEqual(self.engine.rewrite_link("https://example.invalid/docs#x", "docs/a.md")[0], "https://example.invalid/docs#x")

    def test_toc_and_history_note_once(self):
        page = self.engine.page(self.docs[0])
        self.assertEqual(page.count('class="stage-note"'), 1)
        self.assertIn('aria-label="章节目录"', page)
        self.assertIn("#section-1-子章节", page)
        self.assertIn("原始 Markdown 文件", page)
        self.assertNotIn('class="stage-note"', self.engine.page(self.docs[1]))

    def test_render_deterministic_and_source_unchanged(self):
        before = (self.root / "docs/a.md").read_bytes()
        self.assertEqual(self.engine.page(self.docs[0]), self.engine.page(self.docs[0]))
        self.assertEqual((self.root / "docs/a.md").read_bytes(), before)

    def test_build_check_detects_stale_output(self):
        out = self.root / "demo/docs"
        self.engine.build(out)
        self.engine.build(out, check=True)
        (out / "a.html").write_text("stale", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "stale"):
            self.engine.build(out, check=True)

    def test_all_real_documents_preserve_headings_and_every_code_block(self):
        engine = renderer.ReviewRenderer()
        for doc in renderer.DOCUMENTS:
            with self.subTest(source=doc.source):
                page = Page(engine.content(doc))
                expected = engine.prepared[doc.source]
                self.assertEqual([text for tag, text in page.headings], [h["title"] for h in expected["headings"]])
                self.assertEqual(page.codes, [t.content for t in expected["tokens"] if t.type in {"fence", "code_block"}])
                self.assertEqual(sum(tag == "table" for tag, _ in page.elements), sum(t.type == "table_open" for t in expected["tokens"]))
                self.assertEqual(len(page.ids), len(set(page.ids)))
                # Every inline leaf (including every table cell and paragraph)
                # occurs in order in rendered text. No summarization or clipping.
                rendered = " ".join("".join(page.text).split())
                offset = 0
                for token in expected["tokens"]:
                    if token.type == "inline":
                        text = " ".join(renderer.inline_text(token.children).split())
                        if text:
                            found = rendered.find(text, offset)
                            self.assertGreaterEqual(found, 0, (doc.source, text))
                            offset = found + len(text)

    def test_every_real_local_link_and_fragment_resolves(self):
        engine = renderer.ReviewRenderer()
        for doc in renderer.DOCUMENTS:
            page = Page(engine.content(doc))
            for tag, attrs in page.elements:
                if tag != "a":
                    continue
                href = attrs["href"]
                parsed = urlsplit(href)
                if parsed.scheme:
                    continue
                with self.subTest(source=doc.source, href=href):
                    target = next((d for d in renderer.DOCUMENTS if d.filename == parsed.path), None)
                    if target:
                        target_ids = Page(engine.page(target)).ids
                    elif not parsed.path:
                        target_ids = Page(engine.page(doc)).ids
                    else:
                        dest = (renderer.OUT / unquote(parsed.path)).resolve()
                        self.assertTrue(dest.exists(), str(dest))
                        target_ids = Page(dest.read_text(encoding="utf-8")).ids if dest.suffix == ".html" else []
                    if parsed.fragment:
                        self.assertIn(unquote(parsed.fragment), target_ids)


if __name__ == "__main__":
    unittest.main(verbosity=2)
