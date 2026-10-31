# CLI Playground：实现与实际验证

入口：[demo/index.html](../../demo/index.html) → **CLI 交互体验**。本地起点为 master / `3629a28c459afa6b3aac7c25e926c6511378b897`，开始时干净。本轮没有运行 Java、真实审核/标签写入、HTTP 或批次执行；没有打包、push、上传或发邮件。

## 实现范围

| 文件 | 职责 |
|---|---|
| demo/cli-engine.js | 轻量 tokenizer/参数校验、DemoCliEngine、七条命令、内存状态与文本输出；同时供独立测试使用 |
| demo/playground.js | 输入、Enter/运行、↑↓ 历史、快捷填入、复制/降级、输出滚动、摘要、清屏与重置确认；动态输入/输出用 textContent |
| demo/seed.js | 原始 Mock 的独立只读导出，保留全部字段；与旧证据 data.js 分开 |
| demo/index.html、app.js、style.css | 加载三个新资源、第二部分终端、真实证据折叠入口和局部样式；产品/技术页仅必要导航文字调整 |
| README.md、evidence/demo/verify.cjs | 使用说明与新界面回归；结果只写本目录，不覆盖历史报告 |

没有新增前端工程、运行依赖或后端。浏览器直接以 file:// 打开，全部资源本地加载，不使用 fetch 或持久化存储。

### 输入语法与状态

支持短命令及可选 `contentops` 前缀、普通空白、单/双引号中的中文和空格、引号/反斜线转义、`--name value` / `--name=value`、重复 `--add`。支持当前范围的 `--env mock`、`--output table|json`、`--non-interactive`、help/--help/-h、clear；api 明确拒绝，不回退或联网。

未知命令、未知/不适用参数、重复单值参数、缺必需项、无效枚举和页码均拒绝。没有 Shell：管道、重定向、连接符、变量展开、系统命令和 Java 启动语句不支持；引号内特殊字符只作文字。输入最长 2048 个 UTF-16 单元、最多 128 个 token；显示最近 80 次输出，历史保留 100 条。没有 eval、Function、系统进程或文件权限接口。

一次提交同步完成，后续命令读取更新后的同一份内存。切换主模块保留这份状态；刷新重新初始化。clear 只清屏，数据和输入历史保留。重置还原全部 seed、移除模拟审核记录，保留输入历史；有修改时用页内确认，取消不改数据。快捷按钮仅填入输入框，尤其执行示例不会直接提交。

### 七条业务命令

- list：全部 300 条可查；每页 20、默认 page=1，状态/ID 按 AND 过滤，越界空页保留真实总数。
- get/history：明确 ID，未知内容 read failed/3；详情保留原字段，历史在副本上倒序，不改种子历史。
- tags list：默认 23 个 active，all 为 25 个，含 2 个 deprecated。
- review：仅 pending，approve/reject；reject 理由非空。缺省 approve 理由在计划中为 null、日志中为空串，与 Java 对齐。
- tags update：仅 add；新增项存在且 active；保留全部存量值与顺序，不清洗异常，重复请求项去重。预览始终 previewed；授权执行且无变化时 no_change/skipped。
- process：先校验所有输入和完整标签计划；执行时重读检查 → 单条审核 → 核对审核 → 完整标签更新 → 同时核对最终审核/标签。没有回滚或自动重试。

所有写命令默认只预览，两项授权 `--execute --yes` 缺一即 rejected/2、零写入。标签更新不改审核状态；审核只更新该内容状态并追加对应动作/理由日志，其他 299 条及未使用集合、聚合字段保留。

## 数据与来源边界

[export-seed.cjs](export-seed.cjs) 从原始 `内容运营后台接口数据/mock_data.json` 导出完整数据树，没有用任务二操作后的工作副本初始化。`_note`、内容、创作者、历史、报告、推广位、标签、分类全部保留。[seed-integrity.json](seed-integrity.json) 记录原始 SHA：`44ba17cbe95432547a8fe380f81e0416ae51404957ed0c87de5ced7f8e3939b0`。

引擎构造时深复制 seed，reset 从私有 seed 再复制；读结果与导出视图也不共享可写引用。新增浏览器日志操作人为 **op_browser_demo**。不更新原始 tag usage_count 等聚合字段。

模拟 JSON 使用统一字段 schema_version、invocation_id、environment、command、mode、status、exit_code、content_id、data、error、warnings，另标 `source=browser_simulator`。**environment=browser**，invocation_id 是页面调用序号，不是幂等键。退出码是模拟结果，不是 JVM 进程码；写入步骤的 api_result=null，未伪造后台成功计数。events 仅记录本次内存步骤次序，不是服务端审计。

三类材料分开：

1. [browser-session.json](browser-session.json) 是本轮 Playwright 实际输入产生的**网页模拟**，包含初始详情、零写入预览、默认文本执行和再次查询/历史；一次 process 成功，其余包含拒绝和 no_change 检查。
2. “查看真实 Java CLI 运行记录”保留旧任务二与 S5；JSON 仍 environment=mock。浏览器模拟为 rejected 时，真实案例仍是既有 approved；网页重置不会更改旧记录。
3. Agent 100 条依旧只是技术页的未来设计，没有批次命令或执行器。

[integrity.json](integrity.json) 保存旧 data.js SHA；原版 101 份证据来源 SHA 与 28 份 stdout/真实退出码继续校验。[protection-result.json](protection-result.json) 核对起点 596 个文件，只有 README、index/app/style、验证脚本五个授权旧文件变化。Java、原题、OpenAPI、Mock、docs、data.js、任务二/S5 和历史报告/截图均不变。任务二工作状态 SHA 前后仍为 `0E72B6DFC455B59F87EA7D9FB7C29F379680540DF39056397E15C911C36A8790`。

## 实际测试

浏览器/JavaScript 测试使用现有 Node 24.13.0、Playwright 1.64.0-alpha-1790635538000、Chrome 156.0.8078.74。当前没有 Browser 插件/技能，直接用已有本地 Playwright 验证真正的离线 file URL，不起服务器、不安装依赖。

```powershell
# 可选：重导出；不需要在打开页面时执行
node evidence/demo-playground/export-seed.cjs
# 无第三方框架的独立测试；本机 Node 24 支持 none 隔离模式
node --test --test-isolation=none evidence/demo-playground/engine.test.cjs
# 已有 playwright 包；标准模块路径已配置时可省略该参数
node evidence/demo/verify.cjs --playwright-module <playwright 包绝对目录>
```

实际结果：

- **39 项独立测试全部通过**，0 失败/跳过，退出 0：[engine-tests.log](engine-tests.log)、[进程码](engine-tests.exit-code.txt)。覆盖解析、全部 300 条读回、分页 AND、排序、预览/授权、active 校验/存量保留、动作理由、步骤顺序、重复审核、其他字段不变、结果别名隔离、reset、JSON 和受控本地异常。
- **629 项浏览器组合检查全部通过**，退出 0：[browser-results.json](browser-results.json)，精确时间见 JSON。其中仍包含 101 项来源 SHA、56 项原文/真实进程码对比，不等于 629 个独立业务场景。
- 实际用 Enter 和按钮运行；快捷填入不提交；↑↓ 恢复历史和草稿；中文输入法确认不误提交；复制、兼容复制、手动 Ctrl+C 降级有效。
- 输入七条命令，实际验证 preview 不写、授权缺失/未知标签/废弃新增/重复参数/不支持的 Shell 拒绝、process 后 pending132→131、原三标签＋悬疑、history1、重复审核拒绝、标签 no_change。
- clear 后仍可读到修改；取消重置保持数据，确认重置全恢复；跨模块保留状态，刷新恢复初始。连续提交帮助命令验证显示有界；这不是 Agent 批次执行测试。
- XSS 字符串作为理由保留为文字，没有生成 img/script/iframe、没有对话框；用户输入没有变成 HTML、Shell 或脚本。
- 1440×1000、1366×768、1024×768、390×844 均无页面横向溢出，代码不小于 14px，输入框在初始视口内；长 JSON 可滚动，运行后滚动到最新输出、焦点回输入。
- 断网临时浏览器上下文仅加载七个本地资源，零控制台警告/错误、零页面异常；localStorage/sessionStorage 为空，seed 和真实证据对象在交互后完整相同。
- 原有 77 个资料/证据链接全部有效；五类 S5 和独立标签恢复、全部十份任务二记录、七个真实 JAR 命令复制都做了回归。

### 真实排查记录

1. 首次 `node --test` 因沙箱禁止派生测试进程而报 spawn EPERM，保留 [原始输出](engine-tests-initial-spawn-failure.log)。改用当前 Node 的 `--test-isolation=none`，不降低测试断言、不安装工具。
2. 存量标签测试曾假设原 seed 一定包含所需异常组合，出现查找断言失败，见 [原始输出](engine-tests-assumption-failure.log)。核对数据后用显式受控夹具覆盖“已有未知/废弃标签”规则，没有改 seed，也不把夹具当作原始数据事实。
3. 新浏览器脚本语法检查发现两个 previous 局部变量重名，重命名后才开始运行；没有把静态失败当作浏览器通过结果。
4. 截图检查时发现窄屏/笔记本输出区过高，调整局部高度并新增“输入框进入首屏”断言。成功截图改用真实的默认文本执行输出，JSON 仍单独检查完整性。

提交检查时，原始断言失败日志的两行空白被 Git 标为尾随空格；保留日志原文，源码与说明文件单独通过默认 whitespace 检查，日志检查仅忽略这项格式提示。

截图均来自实际页面：[初始终端](desktop-initial.png)、[模拟执行后](desktop-after-execute.png)、[笔记本](laptop-terminal.png)、[窄屏](narrow-terminal.png)。只使用既有深色样式，没有生成或嵌入新的图片资产。

## 近似与限制

这是同步、单页面的内存模拟。写前/写后核对针对本地对象，不提供 Java 文件锁、原子替换、跨 JVM 持久化、真实认证/权限、网络收发、超时、重试或服务器并发保证；解析器也不追求完整 Picocli/PowerShell 兼容。

不提供网络故障注入命令。partial、unknown、verification_failed 的受控网络类似情形看已有 S5 Java Mock 记录；引擎只在自身意外异常时保留已知步骤并报错，不把它们冒充真实 HTTP 响应。API 接入和 Agent 批次仍未实现。

仅在上述 Windows Chrome 实测，其他浏览器和屏幕阅读器未独立验收。没有影响当前评审的已知阻塞问题。本轮停止在 Playground，不进入最终打包或完整 AI 记录整理。
