# S0–S2 实际验证记录

记录日期：2026-10-31，Windows 11，F:\AI_TESTEXAM。这里只记录本阶段实际构建与只读验证，不是审核/标签操作记录，不代表真实后台联调，也不是完整 AI 会话导出。

## 最终验证结果

| 实际命令/检查 | 结果 | 原始证据 |
|---|---|---|
| `mvn -B -ntp test` | 退出 0；55 项，失败/错误/跳过均为 0 | `validation/maven-test.stdout.log`、`.stderr.log`、`.exit-code.txt` |
| `mvn -B -ntp verify` | 退出 0；55 项单元/契约 + 19 项独立 JVM 集成；失败/错误/跳过均为 0 | `validation/maven-verify.stdout.log`、`.stderr.log`、`.exit-code.txt` |
| 打包后的实际 JAR，共 18 次启动 | 全部符合对应断言；包含用户指定的 help、list/get/history/tags、详情 JSON | `commands/summary.json` 及各命令 `.stdout.txt`、`.stderr.txt`、`.exit-code.txt` |
| 全部内容/待审核 | 300 / 132；每页 20 条，pending 第 7 页 12 条 | `commands/07-*`、`08-*`、`11-*` |
| 默认标签/全部标签 | 23 active / 25 all，其中 2 deprecated | `commands/09-*`、`10-*` |
| 参数错误/不存在内容/API 未实现 | 实际退出码分别为 2 / 3 / 2，JSON 信封一致 | `commands/13-*` 至 `16-*` |
| 原始题目、接口、Mock、附件 README、批准文档及配置 | 操作前后 SHA-256 一致；原有 Git 跟踪文件相对初始提交无改动 | `commands/summary.json`、`validation/baseline-protection.json` |

stdout/stderr 的空文件表示该进程对应流实际为空。JSON 中的 invocation_id 是每次运行生成的值，不能用整个输出字符串做跨次运行的相等断言。

## 平台与文件系统验证

实际开发/执行环境是 Temurin JDK 21.0.7、Maven 3.9.4、PowerShell 7.6.5；编译 release 17，集成测试检查 Main.class major version=61。JAR 内 seed 与附件字节一致。具体环境/测试汇总见 `validation/environment.txt`、`validation/test-summary.json`。

`JsonStateStoreTest` 在 F 盘 `target/test-state` 临时目录执行真实文件操作，验证原子创建/覆盖、修订号、临时文件清理、损坏不回退、回调失败不提交和锁互斥。`CliProcessIT` 启动独立 JVM，验证：

- 一个 JVM 提交存储测试标记，后一个 JVM 读取到两个标记；原始业务字段完整保留。
- 一个 JVM 改动独立夹具中的标题，后一个真实 CLI 读取到修改值；审核状态与标签未改变。
- 一个 JVM 持有 state.lock，CLI 等待上限后返回 `STATE_LOCK_TIMEOUT`/退出 3；释放后查询成功。
- 有工作快照时执行四个只读命令，state.json 字节不变；没有快照时查询不创建 state.json。
- 损坏快照返回失败，保留损坏文件；真实 JSON/进程退出码匹配；Windows cmd 包装器保留退出码。

所有修改均是测试临时副本中的通用存储夹具，没有调用审核或标签业务修改。当前文件系统能力已实测通过；未验证其他磁盘、网络盘、断电或高并发压力，不扩大可靠性声明。

## 实际遇到的问题与修复

1. 首次 Maven 构建因本机全局仓库位于工作区外、缓存写权限不足而失败。通过项目 `.mvn/maven.config` 指定 `.contentops/m2` 解决；未修改全局配置或更换指定依赖版本。最初终端输出保留在本次对话中，没有完整文件日志，不能当作已导出的 AI 会话。
2. 首轮全量单元测试出现 19 个错误，原因是 JUnit 将 `Stream<String[]>` 的数组展开为多个测试参数。改为 `Stream<Arguments>`，将数组显式包装成单个参数，先重跑对应 27 个测试，再运行完整测试。修复前的真实报告保留在 `failures/junit-parameter-source.txt`。
3. 初次 verify 的测试已经通过，但 Surefire/Failsafe 在 Windows 跨盘 classpath 下打印 Manifest-JAR 路径警告。保存实际警告至 `diagnostics/initial-booter-warning.txt`，使用插件支持的 `useManifestOnlyJar=false`，最终 verify 不再出现该诊断；未关闭 JDK 安全检查。
4. Shade 对重复 module-info/许可证资源的告警通过过滤模块描述和合并许可证/Notice 处理。最终保留依赖包与应用包重复 `META-INF/MANIFEST.MF` 的常规告警；Manifest transformer 已设置 Main-Class，实际 `java -jar` 测试全部通过。

以上失败尝试没有冒充最终成功记录。新建的复核脚本拒绝覆盖已有证据目录；使用新的目录名重跑即可保留不同轮次的实际输出。

补充核对：使用固定版本的诊断插件执行 `mvn -B -ntp org.apache.maven.plugins:maven-dependency-plugin:3.8.1:tree`，退出 0，实际依赖树保存在 `validation/dependency-tree.stdout.log`。Jackson BOM 2.21.8 将 annotations 管理为 2.21，core/databind/jsr310 为 2.21.8；没有手动覆盖 BOM。`Get-Volume -DriveLetter F` 查询被拒绝，未获得磁盘类型；这不影响已经通过的真实文件能力测试。

## 仍未实现

审核/标签业务写方法当前明确抛出 `WRITE_NOT_IMPLEMENTED`；未注册写命令、没有执行审核。没有 HTTP Gateway、业务预览/授权/组合执行、受控业务故障、HTML、任务二真实审核记录或任务三完整方案。以上留待已授权的后续阶段。本轮结果模型中预留的状态枚举不代表相应写能力已实现。
