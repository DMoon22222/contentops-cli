# 后端可靠性审查：独立证据索引

专项结论：[docs/08-后端可靠性专项审查.md](../../docs/08-后端可靠性专项审查.md)。本轮起点 master / `5647ac60d88b22725f1b1171682fdb556a560566`，工作区干净；仅新增测试、测试辅助工具、文档和本目录证据。没有修改生产 Java/pom/HTML、原始材料、docs/01–07、任务二副本或 S5/HTML 历史记录，没有 push、打包 ZIP、上传或发送。

## 结果与目录

**当前受控串行 Mock 原型未发现需立即修改生产代码的 P0。**本轮复现并保留 P1：并发重复审核、标签丢失更新、标签库时点变化。特征测试通过表示风险稳定存在，不表示已修复或支持并发。HTTP、真实权限、幂等/版本接口仍未实现。

| 位置 | 内容 |
| --- | --- |
| baseline/ | 修改前 Maven test/verify 的 stdout、stderr、实际退出码、起止时间、环境与报告 |
| tests/ | 定向、最终 test/verify 的完整日志与 JUnit XML/TXT；汇总、JAR 内容/哈希观察 |
| scenarios/targeted-unit、targeted-verify、final-test、final-verify | 每次运行分别新建 UUID 场景，保留实际结果、快照摘要、屏障、进程参数/PID/输出/退出码 |
| [scenarios/index.json](scenarios/index.json) | 最终 verify 的 13 项场景与具体 UUID 目录、全部文件和 14 个子 JVM 索引 |
| [findings/results.json](findings/results.json) | 风险等级、实际证据与最小建议；没有待隐藏的失败测试 |
| [findings/protected-files.json](findings/protected-files.json) | 起点 680 个既有文件/任务二 state.json 的前后 SHA，全部相同 |

完整可写业务状态和屏障临时目录在每项测试自己的 `target/test-state/case-*`，由现有 JUnit 临时目录机制隔离/清理。提交的是不可变摘要和运行证据，不提交 state.json、锁、运行目录或 Maven 缓存。事实摘要通过真实 JsonStateStore/磁盘读取，null history 表示初始无该组；不重算原始聚合字段。

单元场景的 *-result.json 是用 ResultModels 包装真实 Application 返回值，command=test.application，仅用于保留步骤事实，**不是 CLI 进程原文或实际退出码**。独立 JVM 的 *.stdout.txt、*.stderr.txt、*.exit-code.txt 才是直接采集的进程证据；两类材料不可混称。

## 实际测试数量

| 运行 | 单元/契约 | 独立 JVM 集成 | 失败/错误/跳过 | 实际退出 |
| --- | ---: | ---: | --- | ---: |
| 开发前 mvn test | 156 | 未执行 | 0/0/0 | 0 |
| 开发前 mvn verify | 156 | 36 | 0/0/0 | 0 |
| 定向 ReliabilityBoundaryTest | 9 | 未执行 | 0/0/0 | 0 |
| 定向 verify（只选新增类） | 9 | 4 | 0/0/0 | 0 |
| 最终 mvn test | 165 | 未执行 | 0/0/0 | 0 |
| 最终 mvn verify | 165 | 40 | 0/0/0 | 0 |

新增 **13 个不同 JUnit 实例**，最终 **205** 个；重复运行不相加。[逐类/逐用例统计](tests/test-summary.json) 来自已保存 XML，不是手写预期。最终新增场景的 14 个子 JVM 中，**9 个为未包装 java -jar，5 个为测试屏障入口**。原 CliProcessIT 的 36 项回归另计在 40 中，没有把全部内部进程再算作测试数量。

环境为 JDK 21.0.7、Maven 3.9.4、PowerShell 7.6.5、Windows 11、编译 release 17。Get-Volume 查询被拒绝，文件系统类型未确认，见 [filesystem.json](baseline/filesystem.json)；F 盘目录上的实际锁和原子替换测试通过，两者不矛盾。Shade 重叠告警保留在日志，未当作业务失败，也未隐藏。

## 场景怎么看

- **jvm-sequential-review**：A 单条 review 退出 0，B 重复退出 2；历史 1、revision 1，已有快照 SHA 不变。
- **jvm-review-race**：A/B ready 均经过两次详情读取，内容 pending、items 各 1；先释放 A，等其退出，再释放 B。两者都 succeeded/0，最终历史 2、revision 2。文件锁串行化成功，但不能消除业务竞态。
- **stale-tag-plan / stale-review-plan**：B 在 A 计划后真实提交，A 执行前重读拒绝，rejected/2、不再写、B 的快照字节不变。
- **jvm-tag-lost-update**：A 到达 PUT 前屏障；未包装 B JAR 新增轻松并完成；A 再提交原三项＋悬疑。两者 0，轻松被覆盖，A 的 matched 没发现丢失更新。
- **process-tag-lost-update**：代码级插入 B 的真实标签提交，A 的 process 最终成功但覆盖轻松，日志仅 1、revision 3。不是 HTTP 并发测试。
- **tag-library-change**：夹具将计划时 active 的悬疑改为 deprecated；A 仍提交成功。库变更是受控工作副本修改，不是原始 seed 或现有 CLI 写标签库能力。
- **jvm-snapshot-writers**：两个 JVM 各写 20 个合成 marker，共 40 次实际快照。中间屏障后新 JAR 可读完整 revision 20，最终 40 个 marker 全部存在，原始业务数据完整相同，无 tmp 残留。
- **write-lock-timeout**：真正持有 sidecar 锁，写方 2 秒后 REJECTED_NO_COMMIT，callback 未执行、原 SHA 不变。
- **atomic-move-target-obstruction**：测试在加载后人为把目标变成非空目录，真实移动失败为 WRITE_UNKNOWN，备份原字节保留；不是断电/不支持原子移动的真实文件系统测试。
- **malformed-tags-* 三项**：missing/null/非数组均拒绝计划且不重置状态。

屏障入口在 src/test 的 ReliabilityProbe；它复用 JAR 中的 CliRunner/Service/Mock Store，只拦在委托前等父测试释放，没有给正式命令加参数。ready 文件完整写入后原子发布；轮询不是决定交错的依据。最终 JAR 检查确认未包含这些测试类。[源码用例](../../src/test/java/com/example/contentops/integration/ReliabilityProcessIT.java) 含明确的顺序、超时和只终止自身子进程的清理。

已有 S5 的五种故障与独立补标签在本轮完整 verify 中重新执行；断言检查实际 state.json/revision、新 JVM 查询、history 和调用计数。其历史原文继续在 [evidence/s5](../s5/README.md)，没有覆盖或把旧原文改称本轮新采集。

## 复现

普通源码工作区从根目录运行（原有 JDK/Maven/JUnit，无新增依赖）：

```powershell
mvn -B -ntp test
mvn -B -ntp verify
# 定向运行已有新增用例；verify 会先打包供新 JVM 使用
mvn -B -ntp '-Dtest=ReliabilityBoundaryTest' '-Dit.test=ReliabilityProcessIT' verify
```

所有测试自动使用新临时状态目录。没有证据环境变量时，新测试摘要默认写忽略的 `target/reliability-review-evidence/<场景-UUID>`。本轮采集在各次 Maven 子进程中明确设置 `CONTENTOPS_RELIABILITY_EVIDENCE` 为 `evidence/reliability-review/scenarios/<运行阶段>`，仍每例一个新 UUID，不覆盖旧结果；该变量仅供测试辅助类识别，正式 CLI 不读取，也不提供业务故障开关。手工设置时先保存已有值，结束恢复或使用独立终端，不改永久环境。

`python scripts/summarize-reliability-review.py` 是**本轮开发工作区的只读汇总工具**：只读已保存的报告、场景、当前 JAR 和 `.contentops/reliability-review/protected-before.json`，再输出汇总。原始保护基线包含本机正式任务二状态，故新 clone 不具备该本地文件时不能原样运行这个汇总步骤；这不影响 Maven 测试或审阅已提交 JSON。不要伪造新的保护基线冒充本轮旧记录。

## 范围与剩余事项

没有测试失败或跳过；受控的拒绝/丢失更新/move 异常是断言对象，不是通过后被删除的失败。没有真实 HTTP 接入/断流、断电、磁盘崩溃、其他操作系统或不支持原子移动的文件系统验证。

本轮最终 JAR SHA 与任务二历史值不同。相邻归档内容逐项相同、顺序不同，详细检查在 [jar-packaging-observation.json](tests/jar-packaging-observation.json)，最终候选事实在 [final-jar.json](tests/final-jar.json)。不把新值覆盖到旧证据；最终交付前须冻结候选 JAR 并解释历史版本，后续如需改构建配置另作最小调整与验证。本轮不进入该修复、HTML 更新或打包阶段。

源码与说明使用默认 Git whitespace 检查；原始 Maven/JUnit 输出中的尾随空格（如空白 INFO 日志行）保留，证据格式检查仅忽略这些原文空白，不编辑真实日志。
