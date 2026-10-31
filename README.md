# Contentops CLI · S0–S6

内容运营后台的 Java CLI。目前已实现 **Mock 数据驱动的四个查询命令与单条审核、标签新增、组合处理**。真实 HTTP 尚未实现。产品合同见 [docs/02](docs/02-第一阶段MVP与CLI产品方案.md)，实施顺序见 [docs/03](docs/03-Java技术架构与实施方案.md)。以下描述当前 48 小时原型，未将完整两周 MVP 的功能标为已完成。

任务二已使用新 Mock 副本实际完成：[操作记录](docs/06-实际操作记录.md) · [原始命令与证据](evidence/task2/README.md)。本次从 132 条 pending 的实际第一页选取 ct_000004，经零写入预览后完成一次 approve 并新增“悬疑”，新 JVM 核查历史仅增加一条；这是演示性操作，不代表真实业务合规结论。

任务三专项设计已完成：[Agent 批量处理方案](docs/07-Agent批量处理方案.md)。推荐冻结 ID、人工审批和轻量账本后逐条复用 CLI；批次执行器仍未实现，也未执行 100 条。

## 从 GitHub 获取并运行

安装 Git、JDK 21 和 Maven 3.9.x（开发验收版本为 3.9.4），确认 `java -version`、`mvn -version` 可用且 Maven 使用 JDK 21。以下命令在 PowerShell 7 中执行：

```powershell
git clone https://github.com/DMoon22222/contentops-cli.git
cd contentops-cli
mvn -B -ntp verify
if ($LASTEXITCODE -ne 0) { throw '构建或测试失败，请先检查 Maven 输出' }
java -jar ./target/contentops.jar --help

# 新建独立 Mock 状态目录，进行只读查询
$env:CONTENTOPS_STATE_DIR = Join-Path $PWD ('.contentops/try-' + [guid]::NewGuid())
java -jar ./target/contentops.jar --env mock --output json content list --review-status pending --page 1
```

首次构建需要联网下载 Maven 依赖；构建后的 JAR 包含运行依赖和 Mock seed，可离线运行，无须后台服务、账号或 API Key。源码、测试、Maven 配置、启动/验证脚本、原始接口和虚构样例、设计文档、HTML Demo 及其引用的实测证据均在仓库中。`target/` 产物由构建生成，Maven 缓存、个人配置、运行中的 Mock 状态、重复附件 ZIP、提交包和 AI 会话记录不上传。本仓库是可运行项目源码发布，试炼最终交付状态仍以 [交付清单](docs/04-交付物规划与验收清单.md) 为准。

## 离线 HTML Demo

直接双击 [demo/index.html](demo/index.html)，保留整个 `demo/` 目录。不需要 Java、Node、服务、网络或 CDN。页面保留三个入口：**产品方案 → CLI 交互体验 → 技术设计与演进**。

产品首页先展示已实现的内容查询、内容审核和标签维护，再用任务二案例说明效果；当前 Mock 原型、完整两周 MVP 待补齐项及未来 Agent 扩展分组呈现。点击“打开 CLI 交互体验”即可进入第二部分。

第二部分现在是可输入命令的浏览器终端。输入后按 Enter 或点击“运行”；↑↓ 浏览历史，`help` 查看七条命令及参数，`clear` 只清屏。快捷按钮只填入命令，不会自动执行。“复制”复制当前输入或最近一条命令。右侧摘要随当前模拟状态更新。

推荐在**网页输入框**中依次体验（以下短命令不代表 Windows 已安装 `contentops` 启动器）：

```text
content list --review-status pending
content get ct_000004
content process ct_000004 --action approve --reason "网页模拟决定" --add 悬疑
content process ct_000004 --action approve --reason "网页模拟决定" --add 悬疑 --execute --yes
content get ct_000004 --output json
content history ct_000004
```

写命令默认预览；只有 `--execute --yes` 同时出现才修改网页内存。模拟器使用原始 seed 的完整 300 条内容、25 个标签，初始 pending=132。刷新或点击“重置数据”恢复初始数据；有模拟修改时需再确认重置，命令历史与业务数据分开管理。不使用 localStorage/sessionStorage，不读写 Java 状态目录。JSON 标记 `environment=browser`、`source=browser_simulator`，其中退出码是模拟结果，不是 JVM 进程码。

网页新生成的模拟结果与真实记录分开。“查看真实 Java CLI 运行记录”保留任务二的独立 Mock 实测（新增“悬疑”）和 S5 故障/恢复记录（新增“轻松”）；它们不随网页操作或重置改变。Agent 仍是未来设计，未实现批次执行器。网页不调用 JAR、不连接 API，也不模拟生产网络故障。真正运行 Java CLI 仍使用下文的 `java -jar ./target/contentops.jar ...`，网页还保留了独立的 JAR 命令参考。

“技术说明”和“Agent 方案”保留简短说明；完整方案默认打开预先排版的 [HTML 文档目录](demo/docs/index.html)。重点入口为 [产品方案](demo/docs/02-product-plan.html)、[技术架构](demo/docs/03-architecture.html)、[实际操作记录](demo/docs/06-operation-record.html)、[Agent 批量方案](demo/docs/07-agent-plan.html) 和 [运行说明](demo/docs/readme.html)。共 11 份阅读版，另包括 01/04、任务二/S5 证据索引、原题和附件说明；不转换全部历史日志。原始 Markdown 保留在根目录、`docs/` 及证据原位置，网页资料区的原稿链接明确标为“原始 Markdown 文件”。历史设计阅读页有阶段提示，未修改原文来覆盖过去的状态。

阅读版使用真正的标题、表格、目录锚点和代码块；表格与长代码可横向滚动。跨文档链接优先指向对应 HTML，代码和证据链接按源位置重算。Mermaid 围栏保留完整源码，不联网加载图表库。真实记录继续保留完整 JSON、stderr、实际退出码及来源链接。若要在 PowerShell 中试用真正的写命令，先按下文设置新的独立状态目录。

只有维护者重新生成阅读版时需要 Python 3.12 和锁定的构建依赖（当前环境已有 markdown-it-py 4.2.0 / mdurl 0.1.2）；首次安装需要可用包源。打开生成 HTML 不需要这些工具：

```powershell
python -m pip install -r scripts/requirements-docs.txt
python scripts/render-docs.py
python scripts/render-docs.py --check
python scripts/test-render-docs.py
```

源文件映射与 SHA 见 [manifest.json](demo/docs/manifest.json)。修改源 Markdown、转换脚本或模板后重新生成；`--check` 只检测生成件是否过期。转换关闭原生 HTML、禁用自动图片加载，阅读页无 JavaScript/CDN。当前首页与文档阅读验收见 [demo-docs](evidence/demo-docs/README.md)。

本轮实现和实际验证见 [Playground 验收记录](evidence/demo-playground/README.md)，包括独立 JavaScript 引擎测试与真实浏览器操作。历史 [精简版](evidence/demo-simplified/README.md)、[571 项评审版](evidence/demo-review/README.md)、[407 项 S6 原版](evidence/demo/README.md)及截图未覆盖。`evidence/demo/verify.cjs` 的新结果写入 `evidence/demo-playground/`。Java、原始材料、`demo/data.js`、任务二/S5 工作副本与证据不变；`demo/seed.js` 是另外导出的只读模拟器输入。

## 构建与运行

在项目根目录使用 JDK 21、Maven 3.9.x、PowerShell 7：

```powershell
mvn -B -ntp test
mvn -B -ntp verify
java -jar ./target/contentops.jar --help
```

编译目标为 Java 17，Shade 产物为 `target/contentops.jar`。当前实际运行验收使用 Temurin 21.0.7、Maven 3.9.4、Windows 11 和 PowerShell 7.6.5；尚未在 Java 17 JVM 或 Windows PowerShell 5.1 上验收。

依赖固定为 Picocli 4.7.7、Jackson BOM 2.21.8、JUnit Jupiter 5.13.4。没有 Spring Boot、数据库或 Mock HTTP 服务器。`.mvn/maven.config` 将 Maven 缓存放到忽略目录 `.contentops/m2`，解决本机全局缓存的写权限问题；请从项目根目录构建，首次构建需要下载依赖。

## 查询命令

为试用指定独立的绝对状态目录，避免读取已有演示状态：

```powershell
$env:CONTENTOPS_STATE_DIR = Join-Path $PWD ('.contentops/try-' + [guid]::NewGuid())

java -jar ./target/contentops.jar --env mock content list --review-status pending --page 1
java -jar ./target/contentops.jar --env mock content list --content-id ct_000004 --review-status pending
java -jar ./target/contentops.jar --env mock content get ct_000004
java -jar ./target/contentops.jar --env mock content history ct_000003
java -jar ./target/contentops.jar --env mock tags list --status active
java -jar ./target/contentops.jar --env mock tags list --status all
```

列表固定每页 20 条，筛选条件按 AND 组合；越界空页保留真实匹配总数。历史按时间倒序显示，不重写原始历史。标签默认只显示 active，`all` 包含 deprecated；`--status deprecated` 不在本阶段参数范围内。

公共参数 `--env`、`--output table|json`、`--help` 在各级命令可用，默认为 mock/table。`--non-interactive` 可用于脚本；当前原型均不读取 stdin。各级 `--help` 不实例化 Gateway、不创建状态目录、不调用网络。`--env api` 明确返回退出码 2，不会回退 Mock。

Windows 也可用 `./scripts/contentops.cmd` 启动，它传递参数并保留 Java 进程退出码。

## 写命令：默认预览，显式授权后执行

继续使用上面新建的独立 Mock 状态目录。以下是可复现的调用方式；审核决定由人工提供，CLI 不判断内容是否应当通过。

```powershell
# 单独审核：默认预览，reject 必须提供非空理由
java -jar ./target/contentops.jar --env mock content review ct_000004 --action approve --reason '人工给出的演示决定'

# 单独新增标签：计算完整目标数组，可重复 --add，不按逗号拆分
java -jar ./target/contentops.jar --env mock content tags update ct_000004 --add '轻松'

# 组合预览：任何标签校验失败都会在审核提交之前阻断
java -jar ./target/contentops.jar --env mock --output json content process ct_000004 --action approve --reason '演示：人工已给出审核决定' --add '轻松'

# 实际执行：两项授权参数必须同时出现
java -jar ./target/contentops.jar --env mock --output json --non-interactive content process ct_000004 --action approve --reason '演示：人工已给出审核决定' --add '轻松' --execute --yes

# 新 JVM 重新读取持久化结果
java -jar ./target/contentops.jar --env mock --output json content get ct_000004
java -jar ./target/contentops.jar --env mock content history ct_000004
```

所有写命令不带授权参数时只读取、校验并输出计划，`mode=preview/status=previewed`，零业务写入；预览成功不代表执行成功。`--execute` 缺少 `--yes`，或只给 `--yes`，都返回 rejected/2，不等待 stdin。完整两周 MVP 的输入内容 ID 确认尚未实现。

`--action approve|reject` 和 `--reason` 用于 review/process。tags update 只接受 `--add` 和执行授权；不接受没有实现用途的 reason、remove/set。未知参数、重复的单值参数以及 `--apply/--force/--dry-run` 均拒绝，不静默忽略。

业务约束属于 CLI：只审核 pending；reject 必须有理由；只对真正新增的标签要求存在且 active。保留存量废弃/未知标签并给出警告，原有标签顺序和数据不被自动清洗。已存在标签的独立执行返回 `no_change`、tags=skipped/matched，不发 PUT。默认预览即使目标无变化也返回 previewed。

process 按“全部校验/计划 → 授权 → 重读并检查 → 单 item 审核 → 计数检查及回读 → 检查标签未变化 → 全数组 PUT → 最终回读”执行。标签不变时只跳过标签写入。两项 API 各提交一次完整本地快照，**没有联合事务、回滚或自动重试**。GET 与写入之间仍有竞争窗口，没有服务端版本控制，不能宣称并发安全。

审核成功但标签失败时，用独立标签命令重新计划和修复；不要重做 process 来重复审核。Mock 新日志的操作人固定为 `op_mock_cli`，时间取注入的 Clock；这是本地模拟身份，不是真实认证身份。creators 的计数、tags.usage_count 等原始聚合字段保持原值。

## 脚本读取结果

```powershell
$raw = & java -jar ./target/contentops.jar --env mock --output json content get ct_000004
$cliExit = $LASTEXITCODE
$result = $raw | ConvertFrom-Json
if ($cliExit -ne 0 -or $result.exit_code -ne $cliExit -or
    $result.environment -ne 'mock' -or $result.mode -ne 'read' -or
    $result.status -ne 'succeeded') {
    throw 'CLI 未确认读取成功，请检查 error 与 stderr'
}
$result.data
```

stdout 在 JSON 模式下只有一个 UTF-8 信封对象，诊断走 stderr。业务数据位于 `data`；详情包含 OpenAPI 中的完整 12 字段，中文正文和 emoji 保留。解析失败时无法确定的 command/mode 等字段允许为 null，不伪造执行上下文。不要使用 `2>&1` 将错误文本混入 JSON。

写入结果在 `data` 中保留 plan、steps、observed。步骤分别记录 write（not_sent/acknowledged/failed/unknown/skipped）和 verification（not_checked/matched/mismatched/unavailable）。observed 是最近成功读取的状态；回读失败时保留旧观测，不用计划目标填充。收到合规写入响应仍须回读匹配；result 接受 schema 规定的字符串，不只接受示例值 ok。

| status / 实际退出码 | 含义及处理 |
|---|---|
| succeeded / 0 | 读取成功，或 mode=execute 的全部必要步骤已获确认且核对匹配 |
| previewed / 0 | 仅预览，未写入 |
| no_change / 0 | 独立标签执行无需 PUT |
| rejected / 2 | 参数、授权或业务前置条件拒绝，尚未写入 |
| failed / 3 | 读取失败，或明确的单项写入失败且无已成功步骤 |
| partial / 4 | 审核已核对成功，标签明确失败或被变化检查阻断 |
| unknown / 5 | 写入异常/响应丢失/计数无法解释；不重发、不继续后续写入 |
| verification_failed / 6 | 写入已获确认，回读不匹配或不可用；不撤销既有写入 |
| failed / 1 | 内部或输出失败，不能当作可信执行结果 |

cancelled/7 保留在模型中，本原型没有交互取消场景。PowerShell 请立即保存 `$LASTEXITCODE`，并同时检查 environment、mode、status、exit_code 和步骤；单看退出 0 或 JSON 可解析不足以证明审核完成。unknown 不因另行读取到目标状态就变为本次操作成功。输出丢失、JVM 中断或截断时也不要自动重放写入。

## Mock 状态与原始材料

- 只读 seed 从原始 `内容运营后台接口数据/mock_data.json` 无过滤打包到 JAR 的 `seed/mock_data.json`；构建和运行不修改附件。
- `CONTENTOPS_STATE_DIR` 必须是独立的绝对目录，默认是用户目录下 `.contentops/mock/v1`。原始附件目录及其子目录禁止用作工作目录。
- 无 `state.json` 时，从只读 seed 创建内存数据视图。读取可能创建目录和 `state.lock` 元数据，**不创建业务快照**。
- 每次读取均加 sidecar 文件锁并重新加载完整快照，没有长期状态缓存。已有 `state.json` 不会被只读命令重写；损坏、重复 JSON 键或 seed/版本不匹配时明确失败，不回退 seed。
- 快照提交顺序：锁内加载 → 完整数据树副本 → 同目录临时文件写入并 `force(true)` → 关闭文件 → 原子替换。保留原始七类数据及 `_note`、未使用字段和已有异常数据。审核单次 API 的状态与日志一起提交；无成功项的批次不新建/重写快照。它不构成审核和标签两个操作的联合事务。
- 提交前实际探测同目录原子创建和替换能力；不支持时拒绝提交，不降级为非原子覆盖。锁等待上限为 2 秒。不承诺硬件断电后的目录项持久性，也没有跨机器/网络盘保证。

当前没有初始化或重置 CLI。需要初始视图时换一个独立状态目录；损坏工作副本应保留排查，不自动删除。Gateway 保留列表审核语义：最多 20 项、重复调用追加日志，不施加 CLI 的 pending/理由政策。标签 Gateway 接收完整数组，不施加 active 校验；CLI 只开放单条 add，不直接暴露底层宽松能力。

## 显式 Mock 故障与恢复

`CONTENTOPS_MOCK_SCENARIO` 只用于本地开发演示。未设置时不创建故障包装器，正常行为不变；设置空串、未知名称或在 api 环境设置该变量均拒绝。关闭时使用 `Remove-Item Env:\CONTENTOPS_MOCK_SCENARIO`，不要用空串代替清除。`--help` 仍然跳过业务配置和 Gateway。

| 场景值 | 注入位置 | process 结果 | 磁盘中的实际结果 |
|---|---|---|---|
| tags-reject-before-write | 标签 delegate 调用前拒绝 | partial/4 | 审核已提交，标签未改 |
| review-commit-response-lost | 审核 delegate 真正提交后抛未知 | unknown/5 | 审核已提交，标签未执行 |
| tags-commit-response-lost | 标签 delegate 真正提交后抛未知 | unknown/5 | 审核及标签均已提交 |
| review-readback-mismatch | 审核成功后的指定内容回读，一次返回旧审核状态 | verification_failed/6 | 审核已提交，标签未执行 |
| tags-readback-mismatch | 标签成功后的回读，一次返回旧标签 | verification_failed/6 | 审核及标签均已提交 |

回读故障由写入事件和内容 ID 标记触发，不按“第几个 GET”猜测。只改变返回视图，不把旧数据写回磁盘。新 JVM 的普通 get 不会凭场景配置自行触发写后故障；核查与恢复仍应先清除故障变量。

临时复现部分失败（只影响当前 PowerShell 进程环境，不修改永久配置；请使用新的状态目录）：

```powershell
$env:CONTENTOPS_STATE_DIR = Join-Path $PWD ('.contentops/fault-try-' + [guid]::NewGuid())
$env:CONTENTOPS_MOCK_SCENARIO = 'tags-reject-before-write'
java -jar ./target/contentops.jar --env mock --output json --non-interactive content process ct_000004 --action approve --reason '人工提供的本地故障演示决定' --add '轻松' --execute --yes
$firstExit = $LASTEXITCODE # 应核对实际 JSON，partial 对应 4

Remove-Item Env:\CONTENTOPS_MOCK_SCENARIO
java -jar ./target/contentops.jar --env mock --output json content get ct_000004
java -jar ./target/contentops.jar --env mock content history ct_000004
java -jar ./target/contentops.jar --env mock --output json content tags update ct_000004 --add '轻松' --execute --yes
$recoveryExit = $LASTEXITCODE
java -jar ./target/contentops.jar --env mock content history ct_000004
```

若当前终端已有状态/场景配置，手工演示前保存并在结束后恢复；下面的自动验证脚本直接为子进程指定变量，不改变调用方配置。切换任何故障场景时都换一个新目录，不能复用已审核内容来假装从 pending 开始。

partial 表示已确认部分完成，因此独立补标签即可；重新执行 process 会被 pending 规则拒绝。unknown 表示本次调用没有获得可信确认，尽管另一个 JVM 可能读到目标值，原结果仍为 unknown；不要盲目重试。verification_failed 保留 acknowledged，表示确认后的视图核对不通过，不能反推“没写入”或自动回滚。这些都是受控本地模拟，未验证真实 HTTP 超时、网络重发或生产一致性。

启用场景时 JSON warnings/诊断 stderr 含 `MOCK_FAULT_ACTIVE scenario=...`。Gateway 已实例化时还含 `MOCK_CALL_COUNTS { ... }`，用于保存本次 JVM 的实际计数：review/tag attempts 为 Application 调用包装器次数，delegate_calls 为实际进入底层 Mock 方法次数；不是成功提交次数。回读故障为了捕获旧视图额外调用一次详情 delegate，所以 delegate_content_reads 可能比 content_reads 多 1。injected_readbacks 应为 1。计数只在本次进程内存在，不是服务端审计或幂等机制；普通默认环境不输出这组诊断。

## 验证与阶段边界

S5 的 `mvn test`：156 项；`mvn verify`：156 项单元/契约测试 + 36 项独立 JVM 集成测试，全部通过，0 失败、0 错误、0 跳过。另有 47 次实际 JAR 调用，覆盖正常基线、五种故障、独立标签恢复、重复审核及配置拒绝，见 [S5 证据](evidence/s5/README.md)。[S3–S4 证据](evidence/s3-s4/README.md) 与 [S0–S2 历史证据](evidence/s0-s2/README.md) 保持不变。

复跑独立 JAR 验证（使用新证据目录；S3–S4 脚本会在专用新 Mock 工作副本执行人工演示审核和标签更新）：

```powershell
./scripts/verify-s0-s2.ps1 -EvidenceDirectory ('evidence/s0-s2/recheck-' + [guid]::NewGuid())
./scripts/verify-s3-s4.ps1 -EvidenceDirectory ('evidence/s3-s4/recheck-' + [guid]::NewGuid())
./scripts/verify-s5.ps1 -EvidenceDirectory ('evidence/s5/recheck-' + [guid]::NewGuid())
```

测试状态统一放在被忽略的 `target/test-state` 下；只读手工验证状态位于 `.contentops/manual-validation`，S3–S4 状态位于 `.contentops/s3-s4-validation`，S5 状态位于 `.contentops/s5-validation`。每个故障采用新子目录，核查/恢复 JVM 清除场景配置，与后续任务二正式演示分开。脚本保存原始 stdout/stderr/进程退出码、步骤、计数、快照 SHA/revision 及内容/日志事实，任一断言失败返回非零；已存在的命令/场景证据会拒绝覆盖。构建缓存、产物、完整运行状态均不纳入 Git。证据是实际开发验证记录，不是任务二正式操作记录，也不替代完整 AI 对话导出。

Java 实施已完成至 S5；任务二正式 Mock 操作记录和任务三设计见页首导航。实际文件提交后丢响应、跨 JVM 的部分失败/核对失败、独立标签恢复与不重试已验证。缺失计数、写后读取不可用等额外分支继续由 RecordingGateway 单元测试覆盖；真实 HTTP 的超时、接收次数与协议行为仍未验证。没有新增自动恢复、resume、幂等键或任务管理；pending 检查只防止顺序重复审核，不消除竞态，也不是服务端强幂等。remove/set、人工交互确认、HTTP、Agent 批次运行系统和最终交付仍未实现。HTML 离线回放现已完成，见页首入口。
