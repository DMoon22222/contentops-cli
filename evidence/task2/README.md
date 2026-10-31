# 任务二实际操作证据

操作说明：[docs/06-实际操作记录.md](../../docs/06-实际操作记录.md)。Run ID `a20c72c2-74c1-4130-af99-8d17452424b6`；源码基线 `a726f317e321236107bf9a44480f647bb6ef54ea`，JAR/状态目录与初始声明见 [manifest.json](manifest.json)。

这是本次正式任务二的本地 Mock 操作记录，与 S0～S5 开发验证分开；不是生产审核。审核决定与“悬疑”标签均为已说明限制的流程演示。没有注入故障，18 个实际 CLI 进程均退出 0，仅 commands/13 执行一次写操作。

## 本次结果

实际第一页：132 条 pending 中返回 20 条；ct_000004 在第二项，另用 AND 精确筛选得到 1 条，未虚构列表位置。读取 ct_000002/ct_000004 的完整详情与历史后，选择 ct_000004。active 标签库确认“悬疑”可新增。

预览前后完整详情/历史相同，没有创建业务快照。一次 process 执行得到 succeeded/0，审核与标签均 acknowledged/matched。新 JVM 核查为 approved，原恋爱/校园/武侠保留并新增悬疑；审核历史从 0 增至 1；pending 精确筛选变为 0，总数从 132 减至 131。revision=2。没有异常或第二次审核。

## 文件与原始命令索引

| 编号/目录 | 来源与用途 |
|---|---|
| commands/01、18 | 实际 JAR help/version |
| commands/02、03 | 第一页 pending 表格原文与 JSON 原文 |
| commands/04～07 | 两条候选的详情/历史 |
| commands/08、09 | active 标签库、选中 ID 的 pending 精确匹配 |
| commands/10 | process 预览；stdout JSON，stderr 是未执行提示 |
| commands/11、12 | 预览后独立 get/history，证明未变更 |
| commands/13 | 唯一授权 process 执行；真实 stdout、空 stderr、退出 0 |
| commands/14～17 | 执行后独立 get/history/pending 精确查询/总数查询 |
| before/ | 从原始命令输出提取的详情、历史、标签库；另有选择理由与执行前意图 |
| preview/ | 已读取的预览计划、预览后详情/历史及零写入校验 |
| after/ | 从新 JVM 输出提取的详情/历史/标签，以及磁盘快照元数据 |
| validation/environment.txt | 本轮实际版本信息；没有将 S5 测试标成新运行 |
| validation/execution-plan.json | 对应成功预览的精确执行参数与执行前快照 |
| validation/execution.started/finished.json | 写入前意图标记及实际完成码；中断后禁止盲目重放 |
| validation/result.json | 全部断言、逐条命令/参数、PID/时间、前后业务状态、SHA 与结果 |
| validation/business-diff.json | 只读比较完整业务数据，证明只改审核、标签并追加一条目标历史 |
| validation/protected-before/after.json | 原始材料、源码、旧证据的真实前后哈希 |
| validation/validate.* | 只读校验器的真实 stdout/stderr/退出码；本次为 PASS/空/0 |

每条 commands 记录都有 `.started.json`（完整参数数组、可读命令、状态目录、JAR SHA）、`.stdout.txt`、`.stderr.txt`、`.exit-code.txt`、`.finished.json`（实际 PID/时间/退出码）及 snapshot-before/after 元数据。空文件表示该流实际为空。before/preview/after 为带来源路径的 JSON 摘录，PowerShell 可能规范化时间字符串格式；程序原文始终以 commands/*.stdout.txt 为准。

## 采集、校验与复现边界

本次实际使用 `scripts/record-task2.ps1` 逐条采集。它固定 mock 和 manifest 中的新目录，移除子进程的故障变量，不修改父进程永久配置；不覆盖已有调用名；写入必须匹配成功预览后的执行计划，且只有一次写入机会。初始 SHA 与 S5 已验证 JAR 一致，当前内嵌 seed 也与原始附件字节校验一致。

随后实际运行 `./scripts/validate-task2.ps1 -SaveReports`，没有启动新业务命令。它读取工作副本和原始 stdout，核验 JSON/进程码、完整数据差异、历史增量、独立 PID、执行后读取 SHA 不变，以及材料保护。仅 ct_000004 的 review_status/tags 和对应历史发生业务变化，其他 299 条内容和非本期集合保持不变。

没有重新运行 Maven test/verify，没有新增 Java 功能；S5 的 192 项通过结果是此前事实。本轮新证据是上述 18 次真实 CLI 调用及只读校验。

本机完整可写副本位于 `.contentops/task2/<run-id>/`，不纳入 Git/提交包。不要为了复现而沿用已审核副本或重新运行整份捕获历史；业务复现请按 06 的命令使用新目录。校验脚本在保留本机副本时可只读重跑，不带 SaveReports 不写报告；采集器依赖本开发 Git 工作区，不是普通 CLI 运行的前置条件。

本轮文件名/目录遵循用户最新指定：docs/06-实际操作记录.md 与 evidence/task2；docs/04 中早期规划的其他命名不另建重复副本。未执行异常演示；异常处理证据引用 [S5](../s5/README.md)，不混入本次成功副本。本文件与汇总不是完整 AI 会话导出。

编辑过程说明：更新根 README 阶段措辞时，一次 apply_patch 因仅匹配长段落的前半句而被拒绝，文件未改变；读取整段后已按完整原文修正。该工具结果保留在当前会话中，不是 CLI 失败，也没有因此重跑任何写操作。
