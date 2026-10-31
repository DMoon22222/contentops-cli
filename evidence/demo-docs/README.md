# 首页与文档阅读体验验证

本轮起点 master / `b81ca8f47b08d9a8d766c2708cc4b4890161e5e0`，工作区干净。仅调整首页、文档阅读与资料导航；不运行 Java、不修改原始附件、docs/01–07、Playground 引擎、任务二/S5 或历史网页证据。未打包、push、上传、发邮件或整理 AI 对话。

## 首页与阅读方案

首页从资源约束开场改为“项目是什么 → 三项已实现能力 → 当前用法 → 任务二案例与 Playground 入口 → 当前/两周/Agent 范围 → 十日计划”。案例使用既有 Java Mock 证据；两周时间轴沿用 docs/02 第 9.1 节，不重新估算。尚缺 HTTP、remove/set、人工确认、keyword/tag 等 P0 筛选及完整验收，不把后续 Agent 加入十日承诺。

调整前标题为“用命令完成内容查询、审核和标签维护。”，先显示 1 名后端 / 2 周 / 6 项 API，再解释为什么开发 CLI。调整后标题为“内容运营后台 CLI 工具”，三张能力卡片首先出现，示例和体验按钮在桌面/笔记本首屏可见；资源约束与十日时间轴放在后面。主导航仍只有三个，第二部分未重做。

`scripts/render-docs.py` 使用本机已有 **markdown-it-py 4.2.0 + mdurl 0.1.2**，版本固定在 `scripts/requirements-docs.txt`。没有手写 Markdown 解析器、CDN、运行时 fetch 或文档服务器。选择依据：[官方使用说明](https://markdown-it-py.readthedocs.io/en/latest/using.html)、[官方安全说明](https://markdown-it-py.readthedocs.io/en/latest/security.html)。采用 js-default、关闭原生 HTML；代码保留原文转义，图片仅显示文字，不自动加载远程资源；链接限制协议和仓库范围，阅读页 CSP 禁止脚本及外部资源。

静态阅读版及准确源文件映射在 `demo/docs/manifest.json`：01、02、03、04、06、07、根 README、任务二/S5 README、原题与附件说明，共 11 份。历史 01–04 顶部仅加一次阶段提示，不修改源文。Mermaid 保留完整围栏源码，不额外引入渲染运行库。目录与标题使用确定性、带前缀的 ID；表格与代码滚动，其他正文受阅读宽度约束。跨 Markdown 优先改为映射的 HTML；JSON、源码、stdout/stderr 和退出码仍回到源位置。未转换的历史 Markdown 链接标注为原稿。

`demo/docs/links.js` 与 manifest 同时生成，主页面据此选择阅读版路径；技术页默认提供七份核心文档阅读入口，原始 Markdown 放在独立折叠区。任务二/S5 来源说明也打开阅读版索引，原始 JSON 等链接不变。`.gitattributes` 仅补充生成页及三个映射 README 的字节保留规则，避免 Windows checkout 换行转换破坏 SHA 和 `--check`；源文件本身未因此改写。`.gitignore` 增加 Python 缓存忽略。

复现（项目根目录，Python 3.12；打开 HTML 本身不需要这些工具）：

```powershell
python -m pip install -r scripts/requirements-docs.txt
python scripts/render-docs.py
python scripts/render-docs.py --check
python scripts/test-render-docs.py
# 使用现有 Playwright 包；标准模块可解析时可省略路径参数
node evidence/demo-docs/verify-docs.cjs --playwright-module <已安装的playwright目录>
node evidence/demo-docs/verify-playground.cjs --playwright-module <已安装的playwright目录>
node --test --test-isolation=none evidence/demo-playground/engine.test.cjs
```

## 实际证据

改动前直接运行原有 Playground 浏览器验证器，只将输出路径转向本目录的 baseline，原验证器及旧报告未改。`baseline/browser-results.json` 为实际 **629 项通过**、77 个链接有效、Chrome 156.0.8078.74、断网 file://；`baseline/exit-code.txt` 为实际 0，截图和模拟会话也单独保存。

本轮实际使用 Python 3.12.4、Node 24.13.0、Playwright 1.64.0-alpha-1790635538000、Chrome 156.0.8078.74。当前 Browser 插件/技能未提供，按用户要求使用已有本地 Playwright + Chrome，没有安装新工具或启动服务器。

| 验证 | 真实结果与证据 |
| --- | --- |
| 生成与确定性 | `python scripts/render-docs.py` 生成 11 份；随后 `--check` 与再次渲染比较通过，无时间戳或随机 ID；映射和源/输出 SHA 在 manifest |
| 转换器单元/完整性 | **15 项通过，退出 0**：[renderer-tests.log](renderer-tests.log)、[进程码](renderer-tests.exit-code.txt)。逐一比对 11 份全文的 inline 文字顺序、241 个标题、91 张表格、69 段围栏/缩进代码；测试危险链接、原生 HTML、图片、中文/重复锚点、原稿标签、确定性及过期检测 |
| 原有引擎回归 | **39 项通过，退出 0**：[engine-tests.log](engine-tests.log)、[进程码](engine-tests.exit-code.txt)，原测试与引擎都未修改 |
| Playground 浏览器回归 | **636 项检查通过，退出 0**：[报告](playground-regression/browser-results.json)、[运行输出](playground-regression/run.log)。复用旧验证逻辑，只有输出目录、原稿标签与 HTML 映射断言适配；仍验证七命令、输入/历史/复制、预览零写、审核后标签、JSON、reset/reload、XSS、任务二/S5 五故障及恢复。84 个界面资料链接有效，原 77 个目标直接保留或映射到阅读版 |
| 首页与文档真实浏览器 | **1285 项检查通过，退出 0**：[报告](browser-results.json)、[运行输出](browser-run.log)、[进程码](browser-run.exit-code.txt)。不等于 1285 个独立业务用例 |

文档浏览器验收确实逐一打开了全部 11 份 HTML，各自检查 **1440×1000、1366×768、1024×768、390×844**。读取真实 DOM 核对层级标题、table/pre 数量、历史提示、原稿入口、无脚本、正文宽度和无整页横向溢出。每份每种宽度实际点击一个目录锚点；复杂表格在 390px 下实际滚动。另实际点击“技术架构”进入阅读页、返回主 Demo、产品方案跳需求分析，以及任务二证据链接打开真实 13-process-execute.stdout.txt。**300 个本地路径/锚点检查通过**，外部超链接仅保留为引用，没有发出外部请求；全部读取资源为 file URL，控制台/页面/对话框错误为 0。

页面 identity、非空、无错误覆盖层、控制台健康、真实交互与截图均通过。没有执行 Java/Maven 或重新审核来取得这些结果。原有文件与正式任务二工作快照的保护核对见 [protection-result.json](protection-result.json)。

## 截图与修复记录

截图均为真实浏览器采集：[首页](product-home.png)、[笔记本首屏](product-laptop.png)、[窄屏首页](product-narrow.png)、[产品方案阅读页](product-plan-reading.png)、[技术复杂表格](architecture-table.png)、[技术伪代码](architecture-code.png)、[窄屏表格](document-narrow.png)。基线与 Playground 回归截图分别留在独立子目录。

1. 首次 Python 测试在系统 Temp 目录创建夹具时遇到 Windows 沙箱权限拒绝，原输出保留在 [renderer-tests-initial-failure.log](renderer-tests-initial-failure.log)。改为 `.contentops/demo-docs-tests/<UUID>` 下创建并验证边界后清理；没有申请扩大文件权限、操作无关路径或跳过断言。
2. 链接测试曾假设同目录 HTML 都来自源文档映射，遗漏生成的 index.html；修复测试分类，真实失败见 [renderer-tests-index-assumption-failure.log](renderer-tests-index-assumption-failure.log)。未因此修改源文档。
3. 文档截图定位器曾把原文 `10.4 ` / `7.4 ` 写为带尾点形式而超时；失败见 [browser-first-run-failure.log](browser-first-run-failure.log) 及 failure JSON。修正定位器，截图改为标题置顶，最终全量检查通过。
4. Markdown 表格的对齐属性在转换时改为 CSS 类，避免严格 CSP 下的 inline-style；原始 HTML 被当文字，图片不自动加载。没有放宽 CSP 来掩盖错误。
5. 暂存检查发现无阶段提示的模板行只含缩进，已修正模板并重新生成/验证。原始测试失败日志中的一行尾随空格保留原文，格式检查只对该日志忽略行尾空白，不修改失败输出。

## 限制与后续

只在上述 Windows Chrome 实测，其他浏览器和屏幕阅读器未独立验收。Mermaid 只展示完整源码，不渲染图；外部参考链接未联网验证。原始 Markdown 的旧阶段措辞、原规划的文件名与未勾选清单保留，用阅读页阶段提示区分历史与当前状态；没有伪造历史完成度。

转换范围之外的历史 Markdown 仍可作为明确标注的原稿打开，没有把全部证据转成网页。阅读页是静态生成件，改源文件后需重跑生成和 --check；当前无需读者安装任何构建工具。最终交付前应整体保留 demo/docs、源文档和引用证据，做解压后路径复核、JAR/说明及 AI 记录完整性审查；本轮不打包、不整理对话或发送产品。当前无影响本轮产品评审的已知阻塞问题。
