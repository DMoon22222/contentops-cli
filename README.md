# Contentops CLI · S0–S2

内容运营后台的 Java CLI。目前已实现 **Mock 数据驱动的四个只读命令**，尚未开放审核、标签更新、组合命令或真实 HTTP。产品合同见 [docs/02](docs/02-第一阶段MVP与CLI产品方案.md)，后续实施顺序见 [docs/03](docs/03-Java技术架构与实施方案.md)。

## 构建与运行

在项目根目录使用 JDK 21、Maven 3.9.x、PowerShell 7：

```powershell
mvn -B -ntp test
mvn -B -ntp verify
java -jar ./target/contentops.jar --help
```

编译目标为 Java 17，Shade 产物为 `target/contentops.jar`。当前实际运行验收使用 Temurin 21.0.7、Maven 3.9.4、Windows 11 和 PowerShell 7.6.5；尚未在 Java 17 JVM 或 Windows PowerShell 5.1 上验收。

依赖固定为 Picocli 4.7.7、Jackson BOM 2.21.8、JUnit Jupiter 5.13.4。没有 Spring Boot、数据库或 Mock HTTP 服务器。`.mvn/maven.config` 将 Maven 缓存放到忽略目录 `.contentops/m2`，解决本机全局缓存的写权限问题；请从项目根目录构建，首次构建需要下载依赖。

## 当前可用命令

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

公共参数 `--env`、`--output table|json`、`--help` 在各级命令可用，默认为 mock/table。`--non-interactive` 已保留；当前命令均不读取 stdin。各级 `--help` 不实例化 Gateway、不创建状态目录、不调用网络。`--env api` 查询明确返回退出码 2，不会回退 Mock。审核、标签写入和 `process` 均未注册为命令。

Windows 也可用 `./scripts/contentops.cmd` 启动，它传递参数并保留 Java 进程退出码。

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

本阶段使用的退出码：0=读取成功；1=内部或输出失败；2=参数/配置拒绝；3=读取失败（如不存在的 ID、状态损坏、锁超时）。写入相关的 4–7 已在结果模型中预留，尚无执行命令。读取成功不代表执行过审核。PowerShell 请立即保存 `$LASTEXITCODE`。

## Mock 状态与原始材料

- 只读 seed 从原始 `内容运营后台接口数据/mock_data.json` 无过滤打包到 JAR 的 `seed/mock_data.json`；构建和运行不修改附件。
- `CONTENTOPS_STATE_DIR` 必须是独立的绝对目录，默认是用户目录下 `.contentops/mock/v1`。原始附件目录及其子目录禁止用作工作目录。
- 无 `state.json` 时，从只读 seed 创建内存数据视图。读取可能创建目录和 `state.lock` 元数据，**不创建业务快照**。
- 每次读取均加 sidecar 文件锁并重新加载完整快照，没有长期状态缓存。已有 `state.json` 不会被只读命令重写；损坏、重复 JSON 键或 seed/版本不匹配时明确失败，不回退 seed。
- 存储层的通用快照提交已实现：锁内加载 → 完整数据树副本 → 同目录临时文件写入并 `force(true)` → 关闭文件 → 原子替换。保留原始七类数据及 `_note`、未使用字段和已有异常数据。它不构成审核和标签两个操作的联合事务。
- 提交前实际探测同目录原子创建和替换能力；不支持时拒绝提交，不降级为非原子覆盖。锁等待上限为 2 秒。不承诺硬件断电后的目录项持久性，也没有跨机器/网络盘保证。

当前没有初始化、重置或写入 CLI。需要新的只读初始视图时换一个独立状态目录；损坏工作副本应保留排查，不自动删除。测试中的快照修改仅限独立临时目录的标记/标题夹具，没有执行审核或标签变更。

## 验证与阶段边界

本轮最终 `mvn test`：55 项；`mvn verify`：55 项单元/契约测试 + 19 项独立 JVM 集成测试，全部通过，0 失败、0 错误、0 跳过。实际 JAR 另运行 18 条命令，记录见 [阶段证据](evidence/s0-s2/README.md)。

复跑独立 JAR 验证（使用新证据目录以免覆盖历史）：

```powershell
./scripts/verify-s0-s2.ps1 -EvidenceDirectory ('evidence/s0-s2/recheck-' + [guid]::NewGuid())
```

测试状态统一放在被忽略的 `target/test-state` 下；手工验证状态位于 `.contentops/manual-validation`。构建缓存、产物、临时业务状态均不纳入 Git。证据是实际开发验证记录，不是任务二审核演示，也不替代完整 AI 对话导出。

下一轮 S3–S4 可复用 Gateway 六方法、完整快照存储、DTO、只读服务、命令树和 JSON/退出码模型，实现审核/标签更新/组合编排及受控故障测试。本轮止于 S2；HTTP、交互确认、HTML Demo、Agent 100 条方案和最终交付包仍按已有计划后续推进。
