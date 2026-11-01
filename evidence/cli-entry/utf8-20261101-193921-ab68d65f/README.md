# Windows CLI UTF-8 编码修复与实测

起点 `49d049a4156b63d7ac2c4a36f5a0f92482105a57`。本轮只修改源仓库的初始化、测试脚本、根 README 及对应静态阅读版；不修改 Java、CMD、原始附件、任务二正式状态、AI 阅读记录、冻结候选目录或最终 ZIP。本目录为新证据，未覆盖旧验收报告。

## 使用方式

仍在准备使用 CLI 的同一个 PowerShell 窗口执行一次，不用点源、管理员权限或手动配置编码：

```powershell
.\scripts\enable-contentops.ps1
contentops content list --review-status pending --page 1
contentops --output json content get ct_000004
```

正常初始化将 `Console.InputEncoding`、`Console.OutputEncoding` 和 **global** `OutputEncoding` 设置为不带 BOM 的 UTF-8。通过 Windows API 单独核对控制台输入、输出代码页均为 65001；没有可用控制台时如实提示流编码，不伪造代码页。任一步无法设置就报错并退出 2。失败时恢复原编码对象、全局输出编码、两个原生代码页、PATH 和状态变量；恢复某项失败会另行明确提示。原先输入、输出代码页不同也能分别恢复。只读的用户编码偏好不会被强制覆盖。

不修改 Profile、注册表、永久环境或系统语言。CMD 的 `-Dfile.encoding=UTF-8`、参数传递和退出码保持原样，Java 仍输出 UTF-8；没有添加 GBK 转换。

实现依据：[Microsoft 控制台代码页](https://learn.microsoft.com/en-us/windows/console/console-code-pages)、[GetConsoleCP](https://learn.microsoft.com/en-us/windows/console/getconsolecp)、[PowerShell 字符编码](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_character_encoding?view=powershell-7.6)。`OutputEncoding` 与控制台代码页分别保存，不把修改其中一个视为全部已完成。

## 实测结果

环境：Windows 11，Temurin JDK 21.0.7，Maven 3.9.4；PowerShell **7.6.5** 与 Windows PowerShell **5.1.22621.6133** 均实际启动，不仅是语法检查。

| 验证 | 实际结果与证据 |
| --- | --- |
| Maven test | 165 项，失败/错误/跳过均 0，实际退出 0：[stdout](maven-test.stdout.log)、[stderr](maven-test.stderr.log)、[退出码](maven-test.exit-code.txt) |
| Maven verify | 165 项单元/契约 + 40 项进程集成测试全部通过，退出 0：[stdout](maven-verify.stdout.log)、[stderr](maven-verify.stderr.log)、[退出码](maven-verify.exit-code.txt)、[套件文本报告](maven-reports/) |
| 原有 Windows 用例 | 原有 19 个会话、239 项检查全部保留并通过：[完整汇总](entry-tests-final/summary.json) |
| 编码专项 | 两种 PowerShell 各 6 个会话，共 12 会话、382 项检查全部通过；加上原有检查共 621 项：[stdout](entry-tests-final.stdout.log)、[退出码](entry-tests-final.exit-code.txt) |
| 解压后的使用流程 | 从现有最终 ZIP 解压到新的中文/空格目录，**仅在该临时副本覆盖新版初始化脚本**；PS7/5.1 各 48 项通过：[PS7](extracted-ps7/result.json)、[PS5.1](extracted-ps51/result.json)。这不表示旧 ZIP 已包含修复 |
| 原始材料与冻结文件保护 | 前后逐文件 SHA-256 核对结果见 [protected-files.json](protected-files.json)；本轮没有重建根目录 JAR、修改候选目录、重打 ZIP 或改写旧 AI 记录 |
| 文档生成 | 根 README 同步到静态阅读版；生成、check 与 15 项渲染测试的实际输出见 [docs-build.stdout.log](docs-build.stdout.log)、[docs-check.stdout.log](docs-check.stdout.log)、[docs-tests.stderr.log](docs-tests.stderr.log) |

为避免 `mvn verify` 的 package/replace 行为触及冻结 JAR，将 `pom.xml`、完整 `src` 与原始材料按字节复制到 `.contentops/utf8-20261101-193921-ab68d65f/maven-source`，并顺序执行 `mvn -B -ntp test`、`verify`，额外以 `-Dmaven.repo.local=.../.contentops/m2` 使用现有缓存。构建产生的 JAR 仅在这个独立副本中；Windows 专项测试使用的是**冻结 JAR 的复制件**。没有对源仓库执行 Shade。实际工作目录、选项、退出码与统计见 [summary.json](summary.json)。

### 新增用例与真实调用

- `fresh`：初始化前不执行 chcp，不修改任何 Console 编码；普通 `&` 调用初始化后直接运行命令，验证返回到调用方后全局编码仍生效。
- `cp936` / `cp65001`：只在这两个**基线夹具**设置初始代码页；初始化后核对三项 .NET/PowerShell 编码、两个 Windows 原生代码页及 chcp 的实际结果。
- `rollback` / `rollback-mixed`：真实可执行的同名入口使后置校验失败，检查 PATH、状态变量、编码与代码页恢复；mixed 用例包含 Console 缓存输出为 936、实际输出代码页为 65001 的不同值，恢复后逐项一致。
- `encoding-refused`：测试子会话把全局 OutputEncoding 标记只读，验证明确 UTF-8 初始化失败、退出 2、不得提示就绪，其余已修改编码恢复。夹具不会修改用户会话。

每个成功会话实际调用 list/get/history/tags list/review/tags update/process，核对原始 seed 中的标题、正文及标签、分页中文、审核理由与预览字段，不只检查“没有替换字符”。三项写命令默认预览后均无 state.json；随后在该副本显式 `--execute --yes` 执行组合命令，新 JVM 读取 approved、完整标签与一条中文理由历史，再检查查询未改状态。

JSON 同时检查 PowerShell 实际解码结果及另行捕获的**原生 stdout 字节**：严格 UTF-8 解码、首字节 `{`、没有 BOM、没有初始化提示、信封退出码与实际进程退出码相同。Windows PowerShell 5.1 的 `>` 默认文本编码不是 JAR 的输出编码，不能用它判断 Java 是否带 BOM；测试保留原生字节 `09-raw-json.stdout.bin`，PowerShell 捕获结果另标为重新编码的 UTF-8 证据。

各会话目录含真实命令、stdout/stderr、实际退出码、前后编码和核查项。例如 [PS7 936](entry-tests-final/encoding-ps7-cp936/result.json)、[PS5.1 936](entry-tests-final/encoding-ps51-cp936/result.json)、[PS5.1 混合回滚](entry-tests-final/encoding-ps51-rollback-mixed/result.json)。

凭据扫描未命中。新生成的 49 份 `session.started.json` 含本机 PowerShell 可执行路径，提交副本只将用户目录名遮盖为 `[LOCAL_USER]`，逐文件标注遮盖字段和原始 SHA；原始字节另存忽略目录，没有改写 stdout/stderr、失败文本或执行结果。详见 [隐私及链接核对](privacy-and-links.json)。

本目录的 `.gitattributes` 仅保护新增证据的原始换行及哈希；真实日志里的行尾空格、空行不做源码格式检查，不裁剪这些字节来让检查通过。Java、脚本和 Markdown 仍执行正常的 diff 检查。

### 失败尝试与修复

第一轮：原有 19 个会话和 PS7 编码场景通过；PS5.1 的实际七条命令、预览及 JSON 检查也通过，但测试在执行后调用 `Get-FileHash` 时，该隔离会话未能找到此 cmdlet，测试退出 1：[失败原文](entry-tests-01/encoding-ps51-fresh/failure.json)、[会话 stderr](entry-tests-01/encoding-ps51-fresh/session.stderr.txt)。没有把它报告成 CLI 中文或业务错误，也没有修改生产 Java。

测试辅助脚本改为使用 .NET SHA256 计算哈希，不依赖该 cmdlet；独立 [PS5.1 复验](ps51-retest-02/result.json) 通过后，再完整运行上表的最终专项。第一轮证据保留，未以成功结果覆盖。失败会话的原始 stderr 经父驱动按 UTF-8 读取后存在历史解码损失；完整错误文本与定位在 UTF-8 的 failure.json 中保留，不凭猜测重建 stderr。

## 后续交付包更新清单（本轮不执行）

旧 `delivery/final/项目代码包.zip` 和候选目录仍保持冻结版本，**尚未包含本轮修复**。经用户确认后，基于独立暂存目录更新以下内容，再制作新 ZIP 并独立解压验收；不能仅修改旧报告声称已更新。

1. 运行必需：`scripts/enable-contentops.ps1`。冻结 `target/contentops.jar` 和 `scripts/contentops.cmd` 不需要替换。
2. 源码/测试：`scripts/verify-cli-entry.ps1`、新增 `scripts/test-support/cli-encoding-session.ps1`。
3. 说明：根 `README.md`、生成的 `demo/docs/readme.html` 与 `demo/docs/manifest.json`；本目录的必要新证据。外置运行/补充说明需同步编码自动初始化及 PS5.1 的最新验证边界。
4. 新包元数据：交付文件清单、说明、验收报告、ZIP SHA-256 及校验文件重新生成；旧包和旧证据保留。AI 记录按届时另行授权补充，本轮未修改它们。

冻结 JAR：`2e6b40ece3567579383c777bff31c35bc682bbf5b18a5bf881bfe5c6596940c6`。

保持原样的最终 ZIP：`aaffbc930761007ab317d90b89c995298ca18310505ed32db8c5c83cda9e15e3`。

本轮不发送邮件、不上传、不 push；修复提交供用户检查。
