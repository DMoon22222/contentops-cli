# Windows 命令入口与会话初始化验证

起点 master / `c9059feb085fa56b1085a07263b75b7a63393f41`，工作区干净。本轮只增强 CMD 入口、增加 PowerShell 初始化和专项测试、更新 README 及其静态阅读版。没有修改生产 Java、业务合同、原始附件、docs/01–08、任务二/S5/HTML 历史证据，没有创建最终包、push、上传或发送。

## 使用方式与设计边界

在包含 JDK 21 和 target/contentops.jar 的项目根目录，**同一个 PowerShell 窗口**执行：

```powershell
.\scripts\enable-contentops.ps1
contentops --help
contentops content list --review-status pending
contentops --output json content get ct_000004
```

不用 Git、Maven 或后台服务运行已打包 JAR；源码开发者才需要 mvn verify。当前并未制作最终邮件交付包，测试用的目录是专门复制的本地运行夹具，不冒充已交付附件。

- 初始化按自身位置定位根目录，检查 java.exe 的真实 -version 必须为 21、JAR、同名入口与故障配置，全部通过后才配置**进程级** PATH/状态变量；不改 JAVA_HOME、注册表、永久 PATH、执行策略、profile，不安装依赖。
- scripts 目录置前并按大小写/引号/尾斜线归一化去重；冲突别名/函数拒绝，其他程序被明确提示并核对最终解析路径；调整后仍不是本 CMD 或 Java 入口变化则回滚 PATH 与状态变量。
- 默认绝对目录 .contentops/reviewer；现有有效状态变量默认保留，已有 state.json 不读取或重置。显式 -StateDirectory 可改目录，显式相对参数转绝对；现有环境变量为相对路径则拒绝，不静默改写。-NewState 创建新 UUID 目录，旧目录不删除；与 -StateDirectory 互斥。
- 初始化不访问业务 API，也不调用业务 JAR。可创建空工作目录，不创建 state.json。故障变量存在（包括空值）即拒绝且不移除；原始附件、任务二目录和经过联接/符号链接的状态路径拒绝。失败后不留下半配置的会话环境；极端后置失败可能留下本次空目录，不会删除用户目录来“回滚”。
- CMD 仍只转发参数，用自身位置找 JAR，保留 UTF-8 和真实退出码。它从 PATH 找明确的 java.exe，不意外执行当前工作目录中的同名文件；缺 JAR/Java 时 stderr 提示、stdout 为空、退出 2，不伪造 Java JSON。

当前会话环境与命令优先级依据 [Microsoft 环境变量说明](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_environment_variables?view=powershell-7.6) 与 [命令优先级](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_command_precedence?view=powershell-7.6)。初始化结果是面向人的独立输出，不混入随后 Java 命令的 JSON stdout。

## 测试组织

`scripts/verify-cli-entry.ps1` 是开发验收工具（PowerShell 7），每次使用新的证据目录和忽略目录 `.contentops/cli-entry/<UUID>`；复制两个启动脚本与实际 JAR 到“面试解压项目 ContentOps CLI”等中文/空格路径，不复制原始可写状态。所有审核/标签执行都在该副本默认 .contentops/reviewer 中。源项目入口只做 help/get，使用另一个明确测试状态目录。

每个案例在独立无 profile 的 PowerShell 子进程运行，helper 记录每次初始化/CLI 的参数、工作目录、解析到的入口、状态目录、stdout、stderr、真实退出码和核查结果。用户/系统级 PATH、状态/故障变量、JAVA_HOME 只存前后哈希；不导出全部环境或凭据。父测试会话同样核对未变化。

失败尝试保留：

1. entry-tests-01：初始化成功且重复 PATH 检查通过，测试函数 Cli 被内置别名 Clear-Item 遮蔽；已改成 Invoke-EntryCli，不是产品命令故障。
2. entry-tests-02：前 17 个案例通过，后置冲突测试用零字节 .exe 期待被解析；PowerShell 没有将其作为可执行入口，导致测试假设失败。改用真实编译的测试 PE 和明确 PATHEXT 顺序；单独 late-conflict-check-03 验证回滚通过。未改生产 Java 或放松检查。
3. no-maven-check：补充验证驱动直接取 Get-Command java.exe 的 Source，遇到多个 Java 入口得到数组，拼出的测试 PATH 无效；初始化正确拒绝。驱动改为只选第一个入口后，在 no-maven-final 中通过。此问题在补充测试驱动，初始化脚本原本已只选择第一个入口。

受控 Java 17 夹具由本机已有 .NET Framework csc 编译，仅报告版本字符串，用于验证拒绝非 21；另有损坏的零字节 java.exe 验证无法启动。它们不是真实 JDK 17 安装或版本兼容测试，二进制只在忽略目录，不提交。csc 仅是此开发测试的夹具工具，不是 CLI 或初始化脚本的运行依赖。

## 复现与最终结果

```powershell
mvn -B -ntp test
mvn -B -ntp verify
.\scripts\verify-cli-entry.ps1 # 自动新建 evidence/cli-entry/run-<UUID>
# 或明确一个尚不存在的 evidence/cli-entry 子目录
```

实际环境为 Windows 11、PowerShell 7.6.5、Temurin JDK 21.0.7、Maven 3.9.4。初始化脚本保留 Windows PowerShell 5.1 可解析的语法和 UTF-8 BOM，但本轮未在 5.1 下独立验收，不把语法兼容目标当作实测结论。

| 验证 | 实测结果 | 证据 |
| --- | --- | --- |
| `mvn -B -ntp test` | 165 项，失败/错误/跳过均为 0，进程退出 0 | [结果](maven/test.result.json)、[stdout](maven/test.stdout.log)、[JUnit 报告](maven/test-reports/) |
| `mvn -B -ntp verify` | 165 项单元/契约测试 + 40 项进程集成测试，失败/错误/跳过均为 0，退出 0 | [结果](maven/verify.result.json)、[stdout](maven/verify.stdout.log)、[报告](maven/verify-reports/) |
| Windows 初始化及入口 | 19 个独立会话、239 项检查全部通过；23 次初始化、29 次 CLI 调用 | [汇总](entry-tests-final/summary.json)、[stdout](entry-tests-final.stdout.log)、[退出结果](entry-tests-final.result.json) |
| 无 Maven 的运行环境 | PATH 仅含实际 JDK 21 bin 与 Windows System32，确认找不到 Maven；初始化、help 和 JSON 查询等 7 项通过，退出 0 | [stdout](no-maven-final/session.stdout.txt)、[会话结果](no-maven-final/session.finished.json)、[核查](no-maven-final/result.json) |
| README 静态阅读版同步 | 11 份文档生成及 check 通过；渲染器 15 项测试全部通过。本轮未重测浏览器业务交互 | [生成](docs-build.stdout.txt)、[核对](docs-check.stdout.txt)、[测试](docs-tests.stdout.txt) |
| 既有文件保护 | 核对 1,153 个既有文件；只变化根 README、CMD 入口及 README 的两个静态生成文件；无意外变化 | [保护结果](protected-files.json) |

总汇总见 [summary.json](summary.json)。正常案例的原始命令、stdout、stderr、实际进程退出码及断言见 [normal](entry-tests-final/normal/)；覆盖四条查询、三条写命令的默认预览零写入、显式执行 process、后续独立调用回读、重复审核拒绝、缺授权拒绝及不存在 ID。实际审核理由含中文、English、空格、括号和 `!`，由审核历史回读核对。所有写入均在专用复制项目工作副本中，预期数据未代替实际输出。

中文/空格解压路径和其他工作目录启动已通过。JSON stdout 能被解析为一个完整对象，信封退出码与实际进程退出码一致；入口缺 JAR/Java 等 Java 启动前错误仅有 stderr 与退出 2，不伪造 JSON。现有环境保留、自定义/相对路径、新目录、PATH 去重、故障变量（包括空值）、同名入口、前置失败不变和后置失败回滚均有独立案例。用户/系统永久变量及父会话环境前后核对未变化。

本轮验收 JAR 的 SHA-256：`065e7ab3a31e5cd5268f36810217711fa8db12c74338ba2f66089830e5acc77f`。测试复制件与本轮 verify 后的 target/contentops.jar 一致；Maven Shade 重复打包可能改变哈希，本轮不调整构建插件，也不改旧证据中的历史哈希。最终提交前仍须冻结选定 JAR 并记录届时哈希，本轮未制作最终交付 ZIP。

原始题目、OpenAPI/Mock/附件、全部 Java 与 pom、旧证据和 docs/01–08 保持不变。任务二正式 state.json 前后 SHA-256 均为 `0E72B6DFC455B59F87EA7D9FB7C29F379680540DF39056397E15C911C36A8790`。原始 stdout/stderr 不裁剪或去除行末空白；失败尝试继续保留，不以最终成功覆盖。

运行说明、七条命令及执行策略的手动会话替代方式见根 README。测试只验证保存的实际 Windows 环境，不宣称支持全部 Shell 或 cmd.exe 的任意特殊字符语法；来自不可信文本的自动化仍应按 Agent 方案使用参数数组直接调用 Java。
