# S6：离线 HTML Demo 验收记录

## 查看方式与范围

双击 [demo/index.html](../../demo/index.html)。页面由 HTML、CSS、交互 `app.js` 和证据快照 `data.js` 四文件组成；把数据单独保存，避免将原始输出散落在 UI 逻辑中。没有构建步骤、运行时 npm 依赖、CDN、外部字体、图片或 `fetch`，不需要启动服务器。请保留 demo 目录的四个文件。

本轮只做展示层和验证，没有运行审核/标签命令、修改 Java、变更原始材料或任务二/S5 证据。没有打包、上传、push 或发邮件。

| 页面模块 | 可检查内容 / 交互 | 事实来源与边界 |
|---|---|---|
| 产品概览 | 单条范围、两周与 48h、人工/脚本/Agent | docs/02、03、04、07；实现状态按当前 README 与 Java 命令定义核对 |
| 命令手册 | 七个入口、参数、API、复制、JSON / 结果结构 | 任务二原始命令；独立 review、tags update 预览明确为未执行模板，不编造运行信封 |
| 任务二回放 | 五步切换、第一页 20 行、完整详情、前后快照、JSON | 初始 pending 132，ct_000004 位于实际第二行；原标签 3 个，新增“悬疑”；最终 approved、历史 1、pending 131、revision 2 |
| 异常结果 | 五种故障切换、步骤/退出码、观测与磁盘对照、独立修复 | S5 独立场景新增“轻松”；保留 partial/4、unknown/5、verification_failed/6，不把后续目标状态改报原调用成功 |
| Agent 方案 | 现有/未来/上游限制切换、批次流程 | docs/07 摘录；未实现执行器、审批/计划绑定、账本或 batch/resume，未执行 100 条 |

## 数据提取与可追溯性

[export-data.cjs](export-data.cjs) 只读取既有证据，导出 10 份任务二记录、5 个 S5 场景及相应普通核查/独立修复记录，生成 `demo/data.js`。它不启动 Java、不读取或写入工作 state。28 份 stdout 均保留原文及解析对象，附对应 stderr、真实退出码、命令和来源路径；磁盘事实来自既有验证文件。

[source-hashes.json](source-hashes.json) 记录 101 个被引用源文件的 SHA-256；验证脚本逐个校验，并对内嵌 stdout 与原文、退出码与文件做一致性检查。JSON 折叠区是全部字段的格式化视图，原始 stdout 另有本地链接；没有删减字段后冒充完整输出。页面显示的环境变量说明区分故障与恢复，复制命令本身不设置故障。

重导出只需已安装 Node（**打开页面不需要 Node**）：

```powershell
node evidence/demo/export-data.cjs
node --check demo/app.js
node --check demo/data.js
node --check evidence/demo/verify.cjs
```

## 实际浏览器验证

测试路径：本地文件打开 → 切换命令/任务步骤/故障/Agent → 展开并解析 JSON → 复制与手动降级 → 检查状态和来源链接 → 窄屏回归。

- 实测时间：2026-10-31 18:39:47，UTC+8，详见 [browser-results.json](browser-results.json) 的 UTC 时间。
- 环境：Windows、本机 Chrome **156.0.8078.74**、已有 Playwright **1.64.0-alpha-1790635538000**；无头、独立临时上下文，`setOffline(true)` 后直接导航 `file:///F:/AI_TESTEXAM/demo/index.html`。未访问个人浏览器资料。
- Browser 插件/其技能不在当前会话中。MCP Playwright 的 file 协议导航明确被工具阻止，改用本机已存在的 Playwright + Chrome；没有安装依赖或搭建 HTTP 服务器。
- 实际执行：`node evidence/demo/verify.cjs --playwright-module <本机已有 playwright 包目录>`，进程退出 **0**。脚本也支持标准 `require('playwright')`；复验需自行提供已安装包与 Chrome，不把机器缓存路径写成项目运行依赖。
- **407 项数据、链接和浏览器断言全部通过**；这不是 JUnit 数量，也不是本轮 Java 重测结果。

| 检查 | 实测结果 |
|---|---|
| 页面身份、非空、错误覆盖层 | 正确标题 / file URL、主内容存在、无框架错误覆盖层 |
| 离线与控制台 | 仅 index.html、style.css、data.js、app.js 的 file 请求；0 控制台警告/错误，0 页面异常 |
| 七个命令 | 全部切换成功，复制内容与各自 data-copy 一致，模板注明未执行 |
| 任务二 | 五步状态正确，20 行及第二行 ID 正确；前后快照 pending/3 标签与 approved/4 标签匹配 |
| JSON / stderr / 退出码 | 展开可解析、全部字段与源对象一致；进程码独立取自原始文件 |
| 五种 S5 故障 | 每项整体状态、退出码、步骤、磁盘 revision 与证据一致 |
| 独立标签恢复 | succeeded/0，仅 tags 步骤；返回原部分失败视图仍是 partial/4 |
| 复制 | 原生剪贴板写入后实际读回一致；强制禁用 Clipboard API 后兼容复制成功；再强制禁用 execCommand 后显示完整已选文本与 Ctrl+C 提示 |
| 键盘 | Enter 激活、重渲染后保留控制焦点、Tab 移至下一控制；原生按钮/链接/select/summary，存在跳到主内容入口 |
| 链接 | 遍历各步骤、命令、故障、修复后的 70 个唯一相对来源链接，全部目标存在 |
| 响应布局 | 1440×1000、1366×768、1024×768、390×844；全部命令、全部故障和五个模块无 document 横向溢出，主标题可见 |
| 原始材料与状态 | [protection-result.json](protection-result.json)：原有 548 个文件仅 README 按计划修改，无意外改动；任务二业务 state SHA 前后相同 |

截图为实际浏览器结果（不是生成图）：[桌面预览](desktop-task2.png)、[未知结果](desktop-unknown.png)、[笔记本](laptop-task2.png)、[窄屏完整页](narrow-task2.png)、[视觉参考原尺寸](concept-size-task2.png)。

### 排查与修正记录

1. MCP Playwright 拒绝 file 协议；转向本机已有浏览器自动化，保留真正 file:// 离线验收要求。
2. 首次本地 Chrome 启动在沙箱内报 `spawn EPERM`；通过工具审批后启动同一无头离线测试，没有降低浏览器断网条件。原始启动诊断留在本地忽略目录 `.contentops/demo-qa/`，上述事实不冒充页面缺陷。
3. 首次页面测试通过前 179 项后，导航断言过早读取 hashchange 更新前的 aria-current；原始失败见 [navigation-race-before-fix.json](navigation-race-before-fix.json)。测试增加等待当前导航项更新，299 项通过；补齐动态链接、窄屏与数据断言后最终 407 项通过。没有跳过失败项。
4. 复核展示时补充故障环境变量说明、命令结果结构表和 active 标签摘要，避免复制故障命令时误以为命令本身会设置注入。补充后重新执行完整脚本通过。

## 视觉参考与实现核对

使用内置 imagegen 生成一张 **1505×1045** 的 UI 参考，只用于设计；生成图未嵌入页面，也不作为测试证据或业务事实。选用参考在本机 `.contentops/demo-qa/visual-concept.png`（忽略、不随交付包），原始输出为 `C:/Users/15614/.codex/generated_images/01a19030-a39c-7a62-b74b-8b0803522f98/exec-1457d03f-5abd-49d4-86a8-8f76bdc02d38.png`。

生成 brief：中文 contentops 离线 CLI 工作台；左侧五模块、顶部范围说明、五步轨道、命令/结果与内容快照双栏；深灰蓝背景、青绿状态色、无衬线中文与等宽代码、28px 标题、克制边框；任务二 previewed、两步 not_sent、ct_000004 原三标签与新增悬疑。无营销大图或运行输入框。生成图内的示意 JSON、日期不是事实来源，全部以真实证据替换。

已使用 `view_image` 在同一核对轮查看选用参考和最新原尺寸浏览器截图，并另查桌面故障与窄屏。依据如下：

| 对照点 | 参考与最终核对 / 有意调整 |
|---|---|
| 布局 | 保留左导航、横向五步、双栏命令/内容；移动端转为顶部导航与单列，不展示参考图的手机装饰 inset |
| 色彩 | 背景 #10151d、面板 #171f29、边线 #2a3848、强调 #63d6b1；无背景图片或渐变依赖，异常另有文字和退出码 |
| 字号与控制 | 桌面标题 28px、窄屏 24px；正文 14px，代码 12–13px；按钮、轨道和侧栏分别指定字号及选中/焦点样式 |
| 容器与间距 | 210px 侧栏、32px 主边距、18px 栏间距、8px 面板圆角；真实说明增加了纵向高度，最终变化条可随页面滚动阅读 |
| 文案校对 | 保留“内容运营 CLI 演示台”“一次审核，看清每一步。”、五导航/五步、复制命令；增加来源标签、只回放声明和校验说明，属于用户要求的真实边界说明 |
| 数据 / 图标 | 命令使用可复制的真实 JAR 调用，不采用参考图的 shell 续行或示意 JSON；导航改数字，减少装饰与图标字体依赖；没有伪造实测日期 |
| 状态与响应 | 桌面与窄屏均可辨认选中步骤、pending、写入/核对状态；长 JSON 换行且内部滚动，表格可局部滚动 |

视觉结构已按选用参考核对；上述有意差异服务于真实证据与离线约束。未发现阻塞阅读的遮挡、裁切或页面溢出。

## 尚未覆盖及后续

本轮实测只覆盖此 Windows Chrome；Edge、Firefox、Safari、Windows 高对比模式和屏幕阅读器未独立验收。剪贴板权限拒绝分支通过测试覆盖进行受控强制，不能声称已在每一种浏览器权限配置中实测。Markdown 链接由浏览器决定显示/下载，不提供额外渲染器。

本轮未改核心 Java，因此未运行 Maven 或再次操作 Mock。下一轮仍需补 05 统一运行/查看说明、完整 AI 会话核对与脱敏、最终交付交叉检查及新目录解压复现；最终打包/发送尚未执行。
