# S3–S4 实际开发与验证记录

2026-10-31，项目 `F:\AI_TESTEXAM`，起点提交 `5d720b8a0ac3e6c6d08464ddf5edbaabc75806fb`，开发前 master 工作区干净。

本记录是本地 Mock 开发验收，审核决定来自用户提供的人工演示命令。它不代表真实后台联调、自动审核判断、任务二最终操作记录或完整 AI 会话导出。原始附件、docs/01–04、AGENTS.md 和 S0–S2 证据未改动。

## 构建与自动化测试

| 实际运行 | 结果 | 证据 |
|---|---|---|
| 开发前 `mvn -B -ntp test` | 55 项通过；退出 0 | `validation/baseline-test.*` |
| 实现后 `mvn -B -ntp compile` | 退出 0，release 17 | `validation/compile.*` |
| 核心逻辑定向测试 | 76 项通过；退出 0 | `validation/targeted-01.*` |
| `mvn -B -ntp test` | 122 项通过；失败/错误/跳过均 0；退出 0 | `validation/maven-test-01.*` |
| `mvn -B -ntp verify` | 122 项单元/契约 + 28 项独立 JVM 集成；失败/错误/跳过均 0；退出 0 | `validation/maven-verify-01.*` |

最终共 150 个不同测试实例；test 和 verify 中重复执行的单元测试不重复计数。各测试类统计见 `validation/test-summary.json`，原始文本报告见 `validation/junit/`。构建版本和环境见 `validation/environment.txt`；JDK 21.0.7、Maven 3.9.4、PowerShell 7.6.5。

| 必须覆盖的行为 | 已执行的测试 |
|---|---|
| 单 item 审核、approve/reject、理由、状态与日志一起落盘 | `ContentServiceWriteTest`、`JsonMockWriteContractTest`、`CliProcessIT` |
| Gateway 列表上限 20、重复审核追加、无成功项不新建/重写快照 | `JsonMockWriteContractTest`，另保留既有非法请求零写入契约检查 |
| 完整标签数组、存量字段与废弃/未知标签保留、重复输入及 no_change | `TagPlannerTest`、`ContentServiceWriteTest`、真实 JAR 标签执行 |
| 默认预览零写入，已有快照字节不变，授权缺失不等待 stdin | `CliWriteTest`、`CliProcessIT`；下述实际 JAR 证据 |
| process 固定顺序、先校验全部标签再审核、一次只发一个 item | `ContentServiceWriteTest.processUsesExactlyOneReviewItemAndTheDocumentedReadWriteOrder` 等 |
| 审核 0/1、缺失/异常计数、标签失败/未知、回读不匹配/不可用 | 手写 `RecordingGateway` 的 Application 与 CLI runner 测试 |
| JSON 单对象、步骤小写值、进程退出码、跨 JVM 持久化、原始材料 SHA | `CliWriteTest` 与 `CliProcessIT`，沿用 S0–S2 读取/存储回归 |

`RecordingGateway` 是内存受控测试替身。部分失败/未知/核对失败的测试不是“真实 Mock 文件提交后故障”或网络错误证据；真实文件故障与跨 JVM 恢复留到 S5。

## 真正打包的 JAR：17 次独立进程调用

实际运行 `./scripts/verify-s3-s4.ps1`，返回 PASS。逐条命令（含参数数组）、实际 stdout/stderr、进程退出码见 `commands/`；汇总见 `commands/summary.json`。空 stderr 文件表示该流实际为空。

本次专用状态目录在 `.contentops/s3-s4-validation/` 下，具体 UUID 路径见汇总；未使用默认用户状态或后续任务二工作副本。原始完整业务快照留在该被忽略的运行目录，Git 只记录内容详情、历史、快照哈希/修订号和实际输出。

| 阶段与证据前缀 | 实际状态/退出码 |
|---|---|
| `01`–`05` 查询列表、详情、标签、初始历史 | ct_000004 为 pending；标签为恋爱/校园/武侠；历史 0 条；均退出 0 |
| `06` process 预览 | previewed/0；review、tags 均 not_sent/not_checked |
| `07`–`08` 预览后查询 | 详情与初始完全一致；历史仍 0；前后均不存在业务 state.json |
| `09` 只有 execute、`10` 只有 yes | rejected/2；没有创建业务快照，不等待 stdin |
| `11` process，含 execute+yes+non-interactive | succeeded/0；审核响应 1/0，标签响应 result=ok；两步 acknowledged/matched |
| `12`–`14` 新 JVM 重新查询 | approved；恋爱/校园/武侠/轻松；历史恰增 1 条，reason 与人工输入一致，operator_id=op_mock_cli |
| `15` 再次审核 | rejected/2，REVIEW_NOT_PENDING；快照和日志不变 |
| `16` 再次新增轻松 | no_change/0，tags=skipped/matched；快照不变 |
| `17` 最终历史 | 仍为 1 条；退出 0 |

执行后快照 revision=2，审核与标签是两个独立快照提交；没有把 process 合并为一次事务。后续只读、拒绝和 no_change 调用的快照 SHA-256 保持不变。stdout 是真实进程输出，未用预期示例填充。预览提示保存在 stderr，JSON stdout 只包含一个对象。

## 实现取舍与修正记录

- 未发现需要变更命令、业务规则或退出码的产品冲突，docs/02、03 未修改。标签命令仅开放 add，reason 用于审核/组合命令；不支持的 remove/set 等参数明确拒绝。
- 为遵守“审核批次无成功项不提交”，给 `JsonStateStore` 增加 `updateIfChanged`，复用原有锁、完整快照与原子替换流程；原 `update` 行为及已有存储测试保持。成功审核即使状态相同也会追加日志，因此不会被该方法去重。
- 为使选项非法值仍由同一业务校验处理，action 经 Application 严格校验 approve/reject；Picocli 负责必填、重复和语法。结果及退出码保持产品合同，不新增容错值。
- `ReviewItem` 的 null reason 只在 API 请求 DTO 中省略；计划/结果信封仍保留约定 null，不设置全局 NON_NULL。
- S0–S2 中“写命令未开放/写方法未实现”的断言已过期，改为非法 action、未实现参数和非法批次的拒绝检查；原读取、分页、中文、锁、原子替换及文件保护回归保留，并补上新写功能测试。
- 复核 PowerShell 脚本时发现变量名大小写不区分可能令循环变量覆盖 Name 参数，在第一次运行前改为独立名称；没有因此产生覆盖证据的实际运行。
- 本轮所有实际编译/JUnit/JAR 验收均通过，没有构建或测试失败报告需要补造。原始日志完整保留。Shade 的重复 Manifest 常规告警延续上一阶段，实际 JAR 启动测试通过；没有更改依赖版本或全局配置。

## 保留的限制与 S5 后续

当前 Gateway 没有联合事务、幂等键或版本条件；执行前重读只能降低竞态风险。Mock 的操作人和逐项失败规则是明确的本地模拟选择；聚合计数保留来源值，不当作已同步后台统计。

S5 需在新的临时副本补齐：审核/标签真正提交后再丢响应、审核成功后标签明确故障、成功响应后读错/读失败、跨 JVM 的 JSON/退出码与快照对应、不重试计数及独立标签恢复证据。现有手写替身不替代这些持久化场景。尚未实现完整 FaultInjectingGateway、HTTP、HTML、remove/set、人工交互、Agent 批处理与最终交付。
