# 发布候选独立验收证据

结论和完整限制见 [docs/10](../../docs/10-交付候选版验收记录.md)。本轮只生成本地候选与独立复验，没有 ZIP、上传、邮件或 AI 会话整理。

| 位置 | 本轮真实来源 |
| --- | --- |
| source-baseline.json、environment.json | 起点 c590640 与本次环境；不复制所有环境变量或个人配置 |
| maven.stdout.log、maven.stderr.log、maven-result.json | 唯一一次 mvn -B -ntp clean verify，实际退出 0 |
| test-summary.json、test-reports/ | 本次 JUnit XML/TXT；165+40=205，失败/错误/跳过均为 0 |
| frozen-jar.json | JAR 大小/主类/依赖/seed/源码输入哈希，冻结后不重打包 |
| jar-version-relationship.json | 任务二历史 JAR 与本冻结版的源码/哈希关系、已确认与未证明之处 |
| input-adjustments.json、preparation-attempts.json | 唯一计划调整为 .gitignore 两条生成物排除；保留预检停止、编码排查事实；这些是事实记录，不冒充完整原始工具日志 |
| candidate-files.json | 实际候选 1,920 个文件的大小/SHA；清单在候选外，不自引用 |
| candidate-copy.*、candidate-final-audit.* | 逐文件复制及实际候选链接/哈希/路径复核的 stdout/stderr/进程码 |
| cli/ | 无 Maven/Git 的专用 PowerShell 子会话；每条真实 CLI 命令的 stdout/stderr/实际退出码；110 项检查和状态完整性 |
| browser/run-01～04、browser-*.log/result.json | 实际断网 file:// Chrome 过程；01 沙箱启动拒绝，02/03 测试选择/假设错误，04 为 448 项全部通过 |
| protection.json | 1,938 项旧文件和正式任务二保护；测试副本 1,920 项交付源文件保持不变 |

原始 Maven/JUnit 日志保留空白和告警；退出码原文没有用预期值替代。截图是实际 Chrome 页面，浏览器模拟与 cli/ 中真实 JVM 进程结果分开。可写 state.json 仅留在忽略的 delivery/test-run 中，没有提交完整工作状态。

冻结 SHA-256：`2e6b40ece3567579383c777bff31c35bc682bbf5b18a5bf881bfe5c6596940c6`。候选及测试副本使用同一内容，source baseline 为 `c5906402d87ad78e5ea43bd0932cbd97bb08f00e`；后续本轮提交只增加验证工具/文档/证据及生成物忽略规则，没有更改生产 Java/pom 或重新构建。

本目录和 10 暂留在候选外供用户审查；若将来纳入最终包，需要显式更新复制清单并重新检查引用与哈希。最终外置说明、完整 AI 记录和 ZIP 仍待完成，不把候选验收当最终提交完成。
