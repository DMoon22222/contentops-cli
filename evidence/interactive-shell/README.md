# 交互式 Shell：已有真实测试记录

代码提交为 `93d9d586ba0c5b0c493ffed5c21f7c563acf11fe`，JAR 为 `4db8686e91dd388dc17c0c41a5c7419e2807da1002a8e330db06bab5b2930ad8`。编译验收时是 8c73984 基线加未提交 Shell 修改，随后提交为 93d9d58；不能把旧基线字段抹掉。来源、逐文件 SHA 见 [origin.json](origin.json)。

本目录只复制已存在的真实结果，没有本轮重新构建或重跑测试。新增 37 项单元专项；完整 clean verify 为 202 项单元/契约和 45 项进程集成，共 247 项，失败/错误/跳过均 0。完整套件包含前面的 37 项，不能重复相加；其中 5 项为新增真实 Shell 进程测试。

- [验证汇总](verification-summary.json)
- 专项：[stdout](targeted.stdout.log)、[stderr](targeted.stderr.log)、[实际退出码](targeted.exit-code.txt)
- 完整构建：[stdout](verify.stdout.log)、[stderr](verify.stderr.log)、[实际退出码](verify.exit-code.txt)
- [Tokenizer 14 项](junit-reports/surefire/com.example.contentops.cli.CommandTokenizerTest.txt)
- [Shell 23 项](junit-reports/surefire/com.example.contentops.cli.InteractiveShellTest.txt)
- [真实 JVM 5 项](junit-reports/failsafe/com.example.contentops.integration.InteractiveShellIT.txt)

覆盖单双引号、中文空格、key=value、错误后继续、两种命令前缀、默认预览、y/yes、N/空回答/EOF、显式 yes、非交互授权、JSON 隔离、非零 revision 已有快照取消后逐字节不变、新 JVM 回读及 CMD 入口。Shell 会话正常退出 0，取消命令本身为 cancelled/7，两者分别核查。

旧 windows-cli、任务二、S5、可靠性和浏览器证据继续保留各自的历史 JAR/版本，不将它们改称新版 Shell 的运行。新交付 ZIP 的必要解压验收另保存在 ZIP 外最新最终交付验收报告中。

