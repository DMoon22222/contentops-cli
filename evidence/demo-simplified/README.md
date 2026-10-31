# HTML 精简版：改动与验证

入口：[demo/index.html](../../demo/index.html)。本地基线为 `77d329242fef593879dfe4eea378a810a784a735`，开始时 master 干净。本轮只改展示、测试和导航说明，未运行 Java、审核或标签写入，未打包、上传、push 或发送邮件。

## 阅读方式的变化

- **产品方案**：只讲用途、三项能力、资源约束、五段研发安排和当前完成情况，移除每日排期大表和重复限制说明。
- **CLI 功能演示**：七条命令直接可见。选择后显示用途、完整示例、复制及简短说明；写命令可切换预览/执行示例，独立 review、tags update 明确标“命令示例”。
- **真实案例**：直接并排显示 ct_000004 操作前后状态、三项原标签保留、新增悬疑、历史 0→1，不再通过五步向导才能看到结果。实际命令始终可见，过程、完整 JSON 和退出码按需展开。
- **异常**：主视图先说“审核完成，标签未改”“无法确认是否写入”及处理方法；五种 S5 故障、磁盘核查、计数和独立标签修复收进“研发验证详情”。
- **技术与 Agent**：简图、五个简短问题和一段批次演进。技术说明与 Agent 方案均为原生 HTML 展开区，点击仍停留在 HTML 中；完整原稿统一放进“原始资料（Markdown）”，所有链接明确标为“原始 Markdown 文档”。没有新建文档网站或引入渲染框架。

术语尽量换为中文业务表达；CLI、Mock 首次出现有中文说明。移除重复按钮和切换动画，保持正文 16px、代码 14px，保留深色工作台。

## 默认内容确实减少

在同一离线 Chrome、1440×1000 下，实际打开上轮 Git 前端和当前版本，比较 main 的默认 `innerText`（去空白，关闭的 details 不计）：

| 页面 | 上轮 | 本轮 |
|---|---:|---:|
| 产品方案 | 653 | 431 |
| 功能演示 | 1339 | 794 |
| 技术设计 | 926 | 508 |

合计约减少 **41%**。这些是字符数，包含命令、标签和局部滚动内容，不是阅读时间或用户研究结论。本轮三个页面默认都没有展开的 JSON、结果状态面板或表格。

实际结果：[reading-comparison.json](reading-comparison.json)。[compare-reading.cjs](compare-reading.cjs) 可复验；它只读 Git 中的旧前端，将对照文件写到忽略的 `.contentops/demo-simplified-qa/baseline/`，不改分支或业务状态。

## 实际验收

使用现有本地 Playwright + Chrome，无新增依赖。当前没有 Browser 插件/技能；本机 Playwright 可直接验证 file://，无需搭服务器。浏览器为全新临时上下文，断网后打开本地文件，不使用个人资料。

```powershell
node --check demo/app.js
node --check demo/data.js
node --check evidence/demo/verify.cjs
node evidence/demo/verify.cjs --playwright-module <已有 playwright 包的绝对目录>
# 可选阅读对照；需 Git 中存在上一提交
node evidence/demo-simplified/compare-reading.cjs <已有 playwright 包的绝对目录>
```

打开页面不需要 Node 或 Playwright。已配置标准模块路径时，两个脚本都可省略包目录参数。

[browser-results.json](browser-results.json)：实际退出 0，**624 项组合断言通过**；Chrome 156.0.8078.74、Playwright 1.64.0-alpha-1790635538000，准确时间见 JSON。零页面异常、零控制台警告/错误，请求仅四个 file 本地资源。

覆盖内容包括：

- 三导航、首期范围与阶段安排；七条命令默认可见，五步向导已移除。
- 每条完整命令的实际剪贴板读回；三个写命令的预览/执行示例；独立模板没有编造结果。
- 案例前后状态、标签和历史正确，实际执行命令与证据一致；预览两步未发送，执行两步确认并核对。
- 全部十份任务二记录及五种 S5 故障逐份核对完整 JSON、stderr 和实际退出码；独立标签修复不重复审核，原 partial 保持不变。
- “技术说明”“Agent 方案”实际展开 HTML 标题/段落，URL 不变、不打开 .md；所有原始 Markdown 链接都有显式标签，默认隐藏。
- **77 个**本地来源链接目标存在，并验证上一版全部 70 个来源路径仍在。
- 1440、1366、1024、390px 的三页面、七命令和五故障无页面级横向溢出；代码不小于 14px，正文 16px。另在视觉参考原尺寸 1435×1096 检查。
- 键盘选择、Tab、跳过导航、焦点恢复、原生折叠、剪贴板兼容与手动 Ctrl+C 降级均可用。

624 包含 101 项源 SHA、56 项 stdout/实际退出码比对及浏览器检查，不是 624 个独立业务场景。旧向导和逐日表断言按本轮要求移除，改为验证直接案例、七功能主视图、预览/执行切换及可读 HTML；原始结果、五故障、复制、响应布局覆盖保留。旧 571、407 报告及截图均未覆盖。

首次运行通过前 386 项后，字号检查定位到了命令与折叠 JSON 两个 pre，见 [原始失败](failure-1793457198409.json)。将选择器限定为示例的直接代码区域，仍检查全部七命令和四种宽度，完整回归通过。截图复核还合并了重复的补充说明按钮/标题，去掉造成截图残留高亮的过渡动画，随后重新验证并取图。

## 数据保护与修改文件

[integrity.json](integrity.json) 保存基线 data.js SHA；继续使用原版 101 份来源校验。**data.js 没有修改或重导出**，没有新增运营记录。

[protection-result.json](protection-result.json) 核对原有 579 个文件：只有 README、demo/index.html、demo/app.js、demo/style.css 和 evidence/demo/verify.cjs 五个授权文件变化。Java、题目、附件、docs、任务二/S5 和历史 Demo 证据不变。任务二 state SHA 前后仍为 `0E72B6DFC455B59F87EA7D9FB7C29F379680540DF39056397E15C911C36A8790`。浏览器交互前后 DEMO_DATA 完整对象也相同。

新文件仅为本目录的说明、验证结果、对照脚本与截图。清理了已移除向导的 CSS/交互，未增加前端框架、后端服务或 Markdown 解析依赖。

## 视觉与阅读截图

使用内置 imagegen 生成一张布局参考，位于本地 `F:/AI_TESTEXAM/.contentops/demo-simplified-qa/visual-reference.png`，1435×1096，仅作设计参考，不进入页面或提交包。brief 为：原深色工作台、七行命令与单个示例、直接前后对比、中文业务结果、技术信息折叠。图中示意标题与命令不作数据来源，全部使用真实证据替换。

已用 view_image 对照参考与最新原尺寸截图，并检查桌面、窄屏和展开后的阅读区：

| 核对点 | 最终处理 |
|---|---|
| 布局 | 七条紧凑功能 + 单例面板，案例直接对比，取消步骤轨道；默认选择查询命令，符合先找内容的使用顺序 |
| 文案 | 中文用途和操作建议在前，技术状态只在展开区；顶部保留一次全局演示边界 |
| 字号 | 正文 16、代码 14、标题 30/窄屏 25，没有用缩字来精简 |
| 配色与间距 | 延续 #10151d、#171f29、#63d6b1，减少嵌套卡片，以分隔线组织内容 |
| 真实数据 | 案例标题、原标签和实际执行命令取自附件证据，未使用参考图的示意内容 |
| 阅读入口 | 原生 HTML 段落与标题，原稿仅在明确标注的资料区；不引入新导航或文档站 |
| 响应与焦点 | 窄屏保持可读字号和完整命令，原生焦点清楚，无截图遮挡或页面溢出 |

实际截图：[产品页](desktop-product.png)、[功能与案例](desktop-demo.png)、[技术页](desktop-technical.png)、[笔记本](laptop-demo.png)、[窄屏功能页](narrow-demo.png)、[窄屏技术页](narrow-technical.png)、[窄屏产品页](narrow-product.png)、[参考原尺寸](concept-size-demo.png)、[技术说明展开](readable-technical-notes.png)、[Agent 方案展开](readable-agent-notes.png)。

无阻塞问题。仅在此 Windows Chrome 实测；其他浏览器、屏幕阅读器未独立验收。复制拒绝分支为受控覆盖。没有修改 Java，未重跑 Maven或再次操作 Mock，也未把历史 Java 测试当成本轮结果。
