# S5 受控故障、跨 JVM 与恢复证据

2026-10-31，起点 master `850877082e83a3f74031aa5b8eddc9f518ddb0b5`，工作区干净。仅验证本地 Mock；所有审核决定均为用户提供的开发演示选择，不是自动合规判断、真实后台联调或任务二正式操作。原题、附件、docs/01–04、AGENTS.md、S0–S2/S3–S4 历史证据未修改。

## 实际运行与索引

| 实际命令 | 结果 | 文件 |
|---|---|---|
| 开发前 `mvn -B -ntp test` | 122 项通过，退出 0 | `validation/baseline-test.*` |
| `mvn -B -ntp '-Dtest=FaultInjectingGatewayTest,AppConfigTest' test` | 30 项通过，退出 0 | `validation/targeted-01.*` |
| `mvn -B -ntp test` | 156 项通过，失败/错误/跳过均 0，退出 0 | `validation/maven-test-01.*` |
| `mvn -B -ntp verify` | 156 项单元/契约 + 36 项独立 JVM 集成，失败/错误/跳过均 0，退出 0 | `validation/maven-verify-01.*` |
| `./scripts/verify-s5.ps1` | 47 次真实 JAR 调用；全部断言通过，退出 0 | `validation/jar-script-01.*`、`summary.json` |
| 再次指定已有证据目录 | **预期拒绝**，脚本退出 1，旧 summary SHA 未变 | `validation/overwrite-guard.*`；这是保护条件的正向验证，不是开发失败 |

最终 192 个不同 JUnit 实例，test/verify 中重复执行的单元测试不重复计数；`validation/test-summary.json` 保存逐类统计，`validation/junit/` 为真实文本报告。环境见 `validation/environment.txt`：JDK 21.0.7、Maven 3.9.4、PowerShell 7.6.5，编译 release 17。

`commands/` 按场景和顺序保存命令的 stdout、stderr、实际进程退出码。完整参数数组、场景环境值和独立状态目录在 `summary.json`；空 stderr 文件表示实际为空。`scenarios/<场景>/` 保存开始/执行后（恢复场景还有恢复后）的快照事实和结果索引。这些是从磁盘读取的选定内容、日志、revision、SHA，不是可用于运行的完整 state.json。完整工作副本仅留在忽略目录 `.contentops/s5-validation/<运行 UUID>/`。

## 每个场景的真实结果

各场景均从独立的新目录开始：ct_000004=pending，原标签恋爱/校园/武侠，历史 0 条。所有场景的真实审核都持久化为 approved，历史均增至 **1 条**。

| 场景 | JSON status / 实际退出码 | review write/verification | tags write/verification | 磁盘标签 | revision |
|---|---|---|---|---|---|
| normal（无故障配置） | succeeded / 0 | acknowledged/matched | acknowledged/matched | 原三项 + 轻松 | 2 |
| tags-reject-before-write | partial / 4 | acknowledged/matched | failed/not_checked | 原三项 | 1 |
| review-commit-response-lost | unknown / 5 | unknown/not_checked | not_sent/not_checked | 原三项 | 1 |
| tags-commit-response-lost | unknown / 5 | acknowledged/matched | unknown/not_checked | 原三项 + 轻松 | 2 |
| review-readback-mismatch | verification_failed / 6 | acknowledged/mismatched | not_sent/not_checked | 原三项 | 1 |
| tags-readback-mismatch | verification_failed / 6 | acknowledged/matched | acknowledged/mismatched | 原三项 + 轻松 | 2 |

计数取自每个故障调用的实际 `MOCK_CALL_COUNTS` warning，不用 revision 推算调用次数。attempt 表示调用包装器，delegate 表示真正进入底层 Mock；不是成功提交次数。

| 故障场景 | 审核 attempt/delegate | 标签 attempt/delegate | 详情调用/详情 delegate | 注入旧视图次数 |
|---|---|---|---|---|
| tags-reject-before-write | 1/1 | 1/0 | 3/3 | 0 |
| review-commit-response-lost | 1/1 | 0/0 | 2/2 | 0 |
| tags-commit-response-lost | 1/1 | 1/1 | 3/3 | 0 |
| review-readback-mismatch | 1/1 | 0/0 | 3/4 | 1 |
| tags-readback-mismatch | 1/1 | 1/1 | 4/5 | 1 |

旧视图捕获额外读取一次详情，所以相应 delegate 读取数多 1。触发依据是成功写入和目标 ID 的待回读标记，不是 GET 次数。默认正常环境不输出计数诊断；正常的 1 POST/1 PUT 顺序及次数由已有 RecordingGateway 测试验证，实际正常 JAR 另有两次快照提交和一条日志证据，不把它们冒充直接计数。

## 独立恢复与未知结果核查

每个场景的 `01`/`02` 为初始详情/历史，`03` 为预览，`04` 为实际 process，`05`/`06` 是清除故障后新 JVM 的详情/历史，`07` 是清除故障后重复 process 的拒绝。JSON、实际进程码和磁盘事实均已自动比较。

- 所有预览未创建业务快照，两个步骤均 not_sent。实际核查均取消场景配置，读到真实 approved 和相应标签；未污染其他案例。
- 两个 response-lost 场景先由真实 JsonMockGateway 持久化，再在返回 Application 前抛 WRITE_UNKNOWN。首次调用只尝试一次审核、最多一次标签。后续独立查询看到已提交值，原输出 SHA 和 unknown 状态仍保持，未自动提升成功。
- 每个场景重新运行 process 均退出 2、REVIEW_NOT_PENDING；工作快照 SHA 不变。单元测试还断言该顺序重复计划不增加写方法调用次数。这是 CLI 的前置保护，非服务端幂等，也不排除并发竞态。
- 部分失败案例额外的 `08` 仅执行独立 tags update，返回 succeeded/0；`09`/`10` 核查标签补齐、审核仍 approved、历史与恢复前完全相同（1 条），revision 从 1 变为 2。恢复结果没有 review 步骤，没有再次审核或回滚。
- 两个回读不匹配案例的旧值仅存在于返回视图。磁盘没有被改回；核对失败保留 acknowledged，标签核对失败时保留审核先前已核对成功的事实。

`scenarios/*/result.json` 保存原调用结果/计数与实际磁盘事实的区别；`protected-files.json` 保存原始材料、设计和旧证据的前后 SHA。脚本显式断言父进程环境变量未改变，不修改用户或系统永久环境变量。

## 实现与测试边界

新增 MockScenario 和 FaultInjectingGateway，在 Main 的 mock 分支装配；AppConfig 拒绝非法场景/任何 api+场景组合。ContentService 只新增通用诊断 supplier，业务计划、执行顺序和状态判定未改。CliRunner 将活动标识与包装器计数合入现有 warnings，参数/授权提前拒绝时也保留合法 Mock 场景标识，未构造 Gateway 时不伪造调用计数。

包装器测试使用真实临时 JsonStateStore，检查 delegate 提交后的状态/日志、单次旧视图、无成功写响应不注入、NONE 无故障和预览零写入。Application 的五场景矩阵同时核对步骤、observed、磁盘事实和次数。独立 JVM 测试覆盖五场景、独立标签恢复、配置拒绝以及两个不同内容先后写入不丢失；原有 28 项进程回归保留。

本轮各次编译/JUnit/脚本验收均通过，没有意外失败或修复需要补造。开发前发现需隔离外部故障环境，因此原有进程测试默认清除该变量，只有场景测试显式设置。脚本在第一次运行前复核了证据覆盖保护和父进程环境隔离。Shade 重复 Manifest 常规告警延续已有构建，JAR 启动验证通过。

未发现需修改 docs/02、03 的产品冲突；调用计数是本地 Mock 诊断，沿用 warnings，不新增业务参数、命令或状态码。没有实现 HTTP、HTML、Agent 批处理、remove/set、resume 或任务二正式演示。真实网络超时/重发、写后读不可用的 HTTP 版本和断电保证仍不在本期声明范围；当前 Mock 正常闭环及本轮要求无已知验收阻塞。完整 AI 原始对话需按交付规划另行保存，本文件不是完整对话记录。
