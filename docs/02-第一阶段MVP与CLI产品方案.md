# 第一阶段 MVP 与 CLI 产品方案

## 1. 评审结论与交付边界

第一阶段选择上一轮的**方案 A：运营人员的单条审核与标签更新闭环**。只使用内容列表、详情、审核历史、审核提交、标签库、标签更新这 6 个现有 API 操作，兼顾脚本单条调用。

命令入口选择本轮比较中的 **C：独立命令 + 受限组合命令**：日常使用 `content process` 完成一个内容的审核和标签变更；使用 `content review`、`content tags update` 进行独立操作和局部恢复。这里的 C 是命令组织方式，**不是上一轮“增加创作者、举报和操作日志”的范围方案 C**。

第一阶段的核心承诺是：明确处理一个 ID，先预览再执行，分别报告两次写入及其回读结果；不能确定执行结果时停止。组合命令不提供服务端事务，也不自动回滚或重试写入。

### 1.1 两个时间约束

| 约束 | 本方案的解释与交付 |
| --- | --- |
| **业务题目的两周研发周期** | 1 名 Java 后端、10 个工作日，完成本文 P0、必要测试、Mock 演示、轻量 HTML Demo、文档和验收；P1 不承诺全部完成 |
| **本次 48 小时试炼** | 用户已确认最低目标为“评审文档 + HTML 演示 + Mock 上可运行的最小 Java CLI”。交付一个可证明核心闭环的切片，明确标注尚未完成的两周 P0，不将两周工程压缩宣称为 48 小时全部完成 |
| **当前这一轮** | 只交付本产品方案。命令及结果均为设计示例；没有生成 Java 实现、HTML 文件或执行审核，没有修改题目、OpenAPI、Mock 数据 |

接口事实和数据核查引用 [01-需求与接口分析.md](01-需求与接口分析.md)，不在此重复完整接口清单和统计。现有能力以附件 [OpenAPI](../内容运营后台接口数据/content-ops-admin-openapi.json) 为准；命令、确认规则、输出和退出码均为**新增 CLI 产品合同**。

### 1.2 人工、脚本与未来 Agent 的边界

| 调用者 | 第一阶段提供 | 第一阶段不承诺 |
| --- | --- | --- |
| 运营人员 | 查询和阅读；自行给出审核决定；预览变更；确认执行；根据逐步骤结果恢复 | 自动判断内容是否合规、自动修复样例矛盾、强制覆盖已审核内容 |
| 脚本 | 对一个明确 ID 提交调用方给定的决定；非交互执行；JSON、退出码和当前状态核对 | 100 条任务管理、失败自动重放、断点续跑或跨进程去重 |
| 未来 Agent | 可以复用同一套单条命令和结构化结果；明确知道预览、成功、部分失败和未知 | 本期不验收 Agent 自主审核、自动连续处理 100 条或无人值守恢复。自动调用命令不等于取得审核业务授权 |

所有写命令只接收**一个内容 ID**，不接收通配符、筛选结果、ID 数组或输入文件。只读列表不会直接触发写入。客户端不提供白名单、上下架、限流、分发、通知等旁路动作；现有管理员令牌仍然没有服务端角色隔离，不能把“CLI 少暴露命令”当作真正的权限隔离。

## 2. P0、P1 与暂不实现

### 2.1 P0：完整两周 MVP 必须验收

下表估算按一人有效工作日计，包含对应功能的基本验证；专门列出的自动化测试为跨功能故障与回归验证，不重复计算开发工作。各行合计 9.5 人日，另留 0.5 日缓冲。

| 项目 | 具体功能与业务价值 | 工作量 | 取舍 |
| --- | --- | ---: | --- |
| 范围与合同确认 | 固定命令语义、确认规则、退出码和验收场景，减少开发中反复改接口 | 0.75 日 | 本期不确定 Java 框架；下一阶段再决定实现方式 |
| 4 个只读入口 | 内容列表、详情、历史、标签库；支持单页、详情正文和实际状态核对；表格/JSON | 1.25 日 | 列表 P0 仅开放 `content-id / review-status / keyword / tag / page`；不做交互分页器或自动扫全量 |
| 独立审核 | 单 ID 通过/驳回；仅处理当前 pending；驳回必须填写原因 | 1.00 日 | 上游虽是批量接口，本期固定传一项，以计数关联单条结果；不做重复审核覆盖 |
| 独立标签更新 | 新增、移除、非空替换；完整差异预览；基于当前标签计算全量数组 | 1.25 日 | 不新增标签库标签，不清空全部标签；存量废弃标签可保留或移除 |
| 共享执行规则 | 默认预览、执行确认、非交互校验、错误分类、写后读取、变化检测、超时停止 | 1.25 日 | 这是可信写入的必要成本，不能为了压缩工期删去结果未知处理 |
| 单条组合命令 | 对一个 ID 先审核、后更新标签，共享前述校验、执行和输出；失败即停止后续步骤 | 0.75 日 | 只支持固定两步，不做可配置工作流、自动回滚或 resume 命令 |
| Mock 与受控故障 | 从只读附件初始化工作副本，跨 CLI 进程保留演示变更；模拟六项 API、审核计数、明确失败和超时 | 1.00 日 | 新增故障场景单独标记；不实现其余后台模块；不改原始 JSON |
| 自动化验证 | 正常闭环、写请求次数、边界校验、部分失败、未知结果、stdout/JSON/退出码一致性 | 1.00 日 | 覆盖有业务风险的行为；不追求测试数量或复杂测试平台 |
| HTML Demo | 单页说明目标、命令、预览、成功/部分失败/未知三类结果，支持复制命令或切换预设场景 | 0.50 日 | 明示模拟结果，不连接真实后台、不执行 Java CLI、不做第二套管理后台 |
| 操作说明与验收 | 人工和脚本说明、复现步骤、证据整理、已知边界和交付检查 | 0.75 日 | Mock 通过与真实服务联调的结论分开记录 |
| **合计** | | **9.50 日** | **另留 0.50 日缓冲，总容量 10 日** |

实现需要具备六项 API 的适配能力，并在 Mock 合同上验证；附件地址不可访问，不能将真实服务联调通过作为目前可证明的结论。真实环境接入条件在技术设计阶段明确，不能自动回退到 Mock 后冒充真实成功。

### 2.2 P1：有余量才做，可不进入首次交付

| 功能 | 价值 | 增量工作量 | 推迟理由 |
| --- | --- | ---: | --- |
| 列表增加 creator、quality、visibility、created-from/to 筛选 | 更方便定位特定运营队列 | 0.25–0.50 日 | 复用同一 API，但带来日期校验与说明；不影响待审核单条闭环 |
| Shell 补全与更精细的终端排版 | 降低手工输入成本 | 0.25–0.50 日 | `--help`、完整 ID、基本表格和 JSON 已满足 P0；不做多 Shell 兼容扩张 |
| 可选本地结果文件输出 | 避免手工重定向，便于保存证据 | 0.25 日 | P0 已可用 Shell 重定向保存 JSON；不是服务端审计，也不实现持久化任务状态 |

P1 合计可能超过缓冲，**不排入十日必做清单**。尤其不能为了做补全或更多筛选挤掉写入验证和异常测试。

### 2.3 暂不实现

- 100 条批处理、按筛选条件直接写入、自动翻页后执行、并行写入、任务队列、断点续跑、自动重试写入、幂等保证。
- 非 pending 的重新审核、`--force` 绕过保护、自动批准、自动生成审核依据。
- 标签库创建/编辑、默认新增废弃或未知标签、清空全部标签。清空规则在材料中未明确，本期也没有业务必要性证据。
- 创作者、举报、操作日志、分发、限流、上下架、通知、推荐位、导出、日报等额外 API。
- 保存/签名审批计划、跨次调用锁定预览、可信身份审计、跨接口事务，以及为这些能力建立的新平台。

## 3. 为什么选择独立命令与组合命令并存

| 方式 | 运营体验 | 开发成本 | 部分失败与恢复 | 后续脚本 / Agent |
| --- | --- | --- | --- | --- |
| **A：只有独立命令** | 能完成任务，但要自己串联两次写入、两次确认和结果 | 最低；可少做组合结果汇总 | 容易只重做标签；但操作者可能遗漏第二步或错用另一个 ID | 能组合调用，调用方要自行维护步骤关系 |
| **B：只有组合命令** | 正常路径简短 | 表面入口少，实际仍需要分别处理两项 API | 审核成功、标签失败后，重跑组合会面临重复审核；若再增加“只做标签/跳过审核”等分支，反而隐藏了独立命令 | 单条入口统一，但局部恢复含义不清晰 |
| **C：独立命令 + 单条组合命令** | 正常路径用一条命令；特殊情况有直接入口 | 比 A 多约 0.75 日固定顺序编排与结果汇总；不增加 API | 审核已完成时明确改用独立标签命令；不需要恢复引擎 | 日常单条和局部恢复都能复用现有语义 |

选择 **C**。必要条件是组合命令保持克制：**一个 ID、一个审核决定、一组标签变更、固定先审核后标签**。它不是把任意动作拼装在一起的工作流。

先审核的理由是：审核失败时不先改变标签，且“审核已成功后补标签”的恢复方式直接明确。所有标签参数必须在审核前校验并完成预览，减少审核成功后才发现标签写错的情况。这一顺序不意味着审核会自动上架、解除限流或产生其他未声明联动。

`process` 必须同时给出审核动作和标签操作。只审核用 `review`，只改标签用 `tags update`；不再提供 `--skip-review`、`--resume` 或多套别名。

## 4. 命令体系与调用示例

### 4.1 总览与公共参数

```text
contentops [公共参数] content list
contentops [公共参数] content get <content-id>
contentops [公共参数] content history <content-id>
contentops [公共参数] tags list
contentops [公共参数] content review <content-id> --action approve|reject
contentops [公共参数] content tags update <content-id> <标签操作>
contentops [公共参数] content process <content-id> --action approve|reject <标签操作>
```

| 公共参数 | 规则 |
| --- | --- |
| `--env mock|api` | 默认 mock；所有结果明确标明环境。下文示例显式使用 mock。api 环境必须另有可用地址和管理员令牌；不得静默降级或直接使用附件占位地址 |
| `--output table|json` | 默认 table；json 输出固定信封，详见第 6 节。get 的 table 模式采用适合正文阅读的字段块，不强行塞入宽表 |
| `--non-interactive` | 禁止任何输入提示；JSON 模式也自动禁止提示。写入时仍必须显式给出 `--execute --yes` |
| `--help` | 列出参数、示例、默认预览和退出码；不调用写接口 |

只在写命令上提供 `--execute` 和 `--yes`。`--yes` 只表示调用者明确授权执行本次输入，不代表业务审批、幂等、强制覆盖或忽略校验。为了避免多套执行开关，P0 不另加 `--dry-run`、`--apply` 等同义参数。

以下命令和输出是**拟定合同示例，并未执行**。每个独立示例都以初始 Mock 副本为起点；第 7 节的流程示例才按顺序接续状态。通过/驳回均是假设人工已给出该演示决定，不是根据附件自动得出的审核结论。

除特别展示完整信封外，下列 JSON 块标明为 **data 字段示例**；实际输出一律包在第 6 节的完整信封里，不会裸输出不同结构。

### 4.2 查询待审核内容及分页：`content list`

```text
contentops --env mock content list --review-status pending --page 1
contentops --env mock content list --review-status pending --page 2
contentops --env mock content list --review-status pending --keyword "灯塔" --tag "科幻" --page 1
contentops --env mock --output json content list --review-status pending --content-id ct_000004 --page 1
```

参数：`--review-status pending|approved|rejected` 可选，不传表示不限制审核状态；`--page` 为大于等于 1 的整数，默认 1；`--keyword` 匹配标题与正文，`--tag` 为单个标签，`--content-id` 精确筛选。各条件 AND。不支持 page-size、排序或 all。

对应 API：`GET /admin/contents`，CLI 的连字符参数名映射为 `review_status / content_id` 等上游参数；单次只读一页，固定最多 20 条。

第一条查询的表格可显示页码、total=132、总页数=7；具体行顺序不在现有合同中保证。页码大于当前总页数时，如果上游正常返回空 items，CLI 按空结果展示，不猜测并跳回第一页。

第四条精确筛选的 **data 字段示例**：

```json
{
  "page": 1,
  "page_size": 20,
  "total": 1,
  "items": [
    {
      "content_id": "ct_000004",
      "title": "无人剧场·第12话：逆流而上",
      "creator_id": "cr_00002",
      "review_status": "pending",
      "quality_status": "normal",
      "visibility": "online",
      "tags": ["恋爱", "校园", "武侠"],
      "created_at": "2026-07-04T05:19:06Z"
    }
  ]
}
```

这里的 page、page_size 是 CLI 补充的分页元信息；不是上游可调页大小。筛选条件没有任何匹配时，items=[]、total=0、退出码 0，不自动换筛选条件。超出末页但存在匹配内容时，不将空页的 total 擅自改成 0。

### 4.3 查看详情、查询实际状态：`content get`

```text
contentops --env mock content get ct_000004
contentops --env mock --output json content get ct_000004
```

参数：一个必填 ID，无标题模糊选取、无“最近一次操作对象”隐式状态。对应 API：`GET /admin/contents/{content_id}`，每次重新读取，不使用旧预览冒充当前值。

**data 字段示例（初始状态）**：

```json
{
  "content_id": "ct_000004",
  "title": "无人剧场·第12话：逆流而上",
  "creator_id": "cr_00002",
  "review_status": "pending",
  "quality_status": "normal",
  "visibility": "online",
  "tags": ["恋爱", "校园", "武侠"],
  "created_at": "2026-07-04T05:19:06Z",
  "body": "赛琳娜在灯塔下做出了一个反常的决定，故事从这里开始分岔……",
  "source": "app",
  "channels": ["search_only"],
  "category_id": "cat_03"
}
```

操作后仍用同一命令看 review_status 和 tags，没有必要再做一个重复的 status 命令。表格列表允许截断长标题；详情和 JSON 必须保留完整中文、emoji、正文和标签。空正文显示“正文为空”，不自动判定通过或驳回。

### 4.4 查看审核历史：`content history`

```text
contentops --env mock content history ct_000004
contentops --env mock --output json content history ct_000003
```

参数：一个必填 ID。对应 API：`GET /admin/contents/{content_id}/review-logs`。CLI 按 created_at 倒序展示和输出；保留所有动作，不将 limit、take_down 当成 approve/reject。相同时间保留来源顺序，不推断先后。

**第二条的 data 字段示例**：

```json
{
  "content_id": "ct_000003",
  "items": [
    {"action": "approve", "operator_id": "op_06", "reason": "复核通过", "created_at": "2026-06-15T05:39:59Z"},
    {"action": "approve", "operator_id": "op_05", "reason": "", "created_at": "2026-06-12T09:49:54Z"}
  ]
}
```

这是 CLI 针对附件排序冲突做的显式规范化，不表示原始数组本来就倒序。ct_000004 初始没有历史，返回 items=[]、退出码 0；空历史不能被用于证明一个未知 ID 一定存在，需要读详情确认。

### 4.5 查询可用标签：`tags list`

```text
contentops --env mock tags list
contentops --env mock tags list --status all
contentops --env mock --output json tags list --status active --keyword "轻松"
```

参数：`--status active|deprecated|all` 默认 active；`--keyword` 可选，按标签名包含匹配。对应 API：`GET /admin/tags` 一次取全量，**status 和 keyword 为 CLI 本地过滤，不是新增上游参数**。

**第三条的 data 字段示例**：

```json
{
  "total": 1,
  "items": [
    {"tag": "轻松", "group": "风格", "usage_count": 650, "status": "active"}
  ]
}
```

默认初始可用标签为 23 个；all 可看到废弃标签。展示 usage_count 但不将其解释为当前 300 条样例中的使用次数。本期没有创建标签命令。

### 4.6 独立审核：`content review`

```text
contentops --env mock content review ct_000004 --action approve --reason "演示：人工已给出通过决定"
contentops --env mock content review ct_000004 --action approve --reason "演示：人工已给出通过决定" --execute
contentops --env mock content review ct_000005 --action reject --reason "演示：人工提供的驳回理由" --execute
```

第一条只预览；后两条在交互终端要求输入完整 ID 后才写入，它们是独立的替代示例，不应依次用于重复审核同一份初始状态。

参数：`--action approve|reject` 必填；`--reason` 在 reject 时由 **CLI 强制非空**，approve 时可选。只允许当前 pending，没有 force。对应 API：先读详情检查，再调用 `POST /admin/content-reviews`，`items` 固定只含一项。

预览表格示例：

```text
环境       mock
内容       ct_000004  无人剧场·第12话：逆流而上
审核状态   pending -> approved
原因       演示：人工已给出通过决定
标签       不在本命令的写入范围
执行       未提交；使用 --execute 进入执行确认
```

假设人工确认、API 返回计数 1/0 且回读匹配，**data 字段示例**：

```json
{
  "plan": {"review": {"before": "pending", "action": "approve", "reason": "演示：人工已给出通过决定"}},
  "steps": {"review": {"write": "acknowledged", "verification": "matched", "api_result": {"success_count": 1, "failed_count": 0}}},
  "observed": {"review_status": "approved", "quality_status": "normal", "visibility": "online", "tags": ["恋爱", "校园", "武侠"]}
}
```

成功后的状态是预期示例，不是已执行结果。驳回也不自动下架、限流或发通知。

### 4.7 独立标签变更：`content tags update`

```text
contentops --env mock content tags update ct_000004 --add "轻松"
contentops --env mock content tags update ct_000004 --remove "武侠"
contentops --env mock content tags update ct_000004 --add "轻松" --remove "武侠"
contentops --env mock content tags update ct_000004 --set "恋爱" --set "校园" --set "轻松"
contentops --env mock content tags update ct_000004 --add "轻松" --execute
```

这些模式均支持显式执行；未传 execute 均只预览。标签变更参数可在 process 中原样使用。

| 参数模式 | 语义与校验 |
| --- | --- |
| `--add TAG` / `--remove TAG` | 可重复，也可搭配；根据读取的完整标签生成目标数组。同一标签同时出现在 add 和 remove 中拒绝执行 |
| `--set TAG` | 可重复，表示完整替换为这些标签；与 add/remove 互斥。必须至少一个非空标签，不提供隐式清空 |
| 未提供标签操作 | 参数错误，不提交任何写入 |

新增轻松时的预览示例：

```text
模式       全量写回（CLI 计算增量后的结果）
原标签     恋爱、校园、武侠
新增       轻松
移除       无
目标标签   恋爱、校园、武侠、轻松
执行       未提交
```

对应 API：`GET /admin/contents/{id}` + `GET /admin/tags` 用于计算与校验，实际写入仍为 `PUT /admin/contents/{id}/tags`，请求必须为完整目标数组。**上游没有增量 add/remove 接口**。

假设最后一条确认执行并核对成功，**data 字段示例**：

```json
{
  "plan": {"tags": {"before": ["恋爱", "校园", "武侠"], "after": ["恋爱", "校园", "武侠", "轻松"]}},
  "steps": {"tags": {"write": "acknowledged", "verification": "matched", "api_result": {"result": "ok"}}},
  "observed": {"review_status": "pending", "quality_status": "normal", "visibility": "online", "tags": ["恋爱", "校园", "武侠", "轻松"]}
}
```

本命令不要求 pending，允许在审核已成功后独立补标签。移除已不存在的标签、新增已存在的标签，若最终集合无变化，执行模式返回 no_change，不发 PUT；仍返回当前标签。参数本身仍须通过校验，不能用 no_change 绕过非法输入检查。

### 4.8 单条组合：`content process`

```text
contentops --env mock content process ct_000004 --action approve --reason "演示：人工已给出通过决定" --add "轻松"
contentops --env mock content process ct_000004 --action approve --reason "演示：人工已给出通过决定" --add "轻松" --execute
contentops --env mock --output json --non-interactive content process ct_000004 --action approve --reason "演示：人工已给出通过决定" --add "轻松" --execute --yes
```

参数是 review 与 tags update 的同一套规则，必须同时有 action 和标签操作。读取用 `GET /admin/contents/{content_id}` 和 `GET /admin/tags`，写入用 `POST /admin/content-reviews` 与 `PUT /admin/contents/{content_id}/tags`，回读仍用详情 GET；没有新增服务端 process 接口。

预览表格示例：

```text
环境       mock
内容       ct_000004  无人剧场·第12话：逆流而上
步骤 1     审核 pending -> approved
步骤 2     标签 [恋爱, 校园, 武侠] -> [恋爱, 校园, 武侠, 轻松]
执行顺序   审核成功并回读匹配后，才更新标签
失败边界   两次独立写入；可能部分完成，不自动回滚
执行       未提交
```

完整 JSON 成功示例见第 6 节；部分失败示例见第 7 节。process 的标签计划如果合法但无实际变化，只跳过标签 PUT，仍可提交审核，输出明确标为 skipped；不把“标签没有发请求”伪造为“标签写入成功”。

## 5. 交互、校验与执行规则

### 5.1 默认预览与明确执行

| 调用方式 | 行为 |
| --- | --- |
| 写命令不带 execute | 读取所需数据、校验并显示预览，**零写请求**；mode=preview、status=previewed、退出码 0；不继续询问是否执行 |
| 带 execute，交互终端、table 输出、未带 yes | 先显示本次计划，再要求输入完整内容 ID。完全匹配才执行；取消、EOF、输入不匹配均不写入，cancelled / 7 |
| 带 execute 和 yes | 显示/返回实际执行结果，不再提示；业务和前置条件校验仍然生效 |
| JSON、non-interactive 或非交互终端中的执行 | 必须同时有 execute、yes；缺 yes 返回 rejected / 2，不弹提示、不等待 stdin，也不自动接受 |
| 仅有 yes，没有 execute | 参数冲突，rejected / 2，防止把 yes 误当成执行开关 |

人工交互时，中途预览和确认提示写 stderr，stdout 只保留最终结果；默认的“只预览”本身就是最终结果，写 stdout。交互确认前的计划只属于本次调用。此前另一次调用显示的预览没有保存或锁定，第二次调用必须重新计划，不能保证与之前展示完全相同。

### 5.2 参数和业务前置校验

| 检查 | P0 规则及错误提示要点 |
| --- | --- |
| 参数语法 | 未知参数、缺 ID、重复 action、非法枚举、page 非正整数均拒绝。ID 作为不透明字符串，只接收一个非空且不含空白/控制字符的值；不自行宣称 `ct_` 加固定位数是上游强制格式 |
| 目标读取 | 写入前必须成功读到指定详情，核对返回 ID；错误或缺少必要状态/标签字段时停止，不把缺字段当空值 |
| 审核状态 | review / process 仅允许 pending；approved 或 rejected 均提示重新查看，不能强制提交。它是新增 CLI 限制，不是已声明的服务端状态机 |
| 审核理由 | reject 的 reason 去除首尾空白后不能为空；approve 可选。理由仍由调用方提供，不自动编造 |
| 标签参数 | 去除参数首尾空白后不得为空；不改大小写、全半角或做相似标签替换；重复输入去重并提示；同一标签 add/remove 冲突、set 与增删混用均拒绝 |
| 标签库 | 新增到当前集合中的标签必须存在且 active；废弃或未知的存量标签允许原样保留、允许移除，并给出警告；不能借 set 新增一个当前没有的废弃/未知标签 |
| 清空 | 计算后目标为空时拒绝执行，提示本期不支持清空；不提交 tags=[]。这属于产品范围限制，不宣称上游一定禁止空数组 |
| 原有异常 | 正文为空、质量 limited、其他字段异常要展示；不自动生成审核结论，不暗改质量/可见性。写入必需字段不可用时才阻断对应操作 |
| 环境与凭据 | mock 与 api 明示；api 缺地址/令牌或使用占位地址时拒绝，令牌不作为命令示例明文参数，不进入输出和错误日志。具体配置载体留待技术设计 |

预览同样执行这些校验。因此非法标签在 process 中会在审核之前被发现，而不是等审核成功后再报错。

### 5.3 标签覆盖与并发变化

CLI 将标签当作集合比较，不将顺序变化当成业务变更；展示时保留存量顺序，新增标签按参数出现顺序追加，set 按参数顺序去重。上游是否保存顺序没有保证，验收不要求排序一致。

执行前重新读详情，并对照本次预览所依据的标签集合；review / process 还对照审核状态。若变化，**不静默重算后继续执行**：

- 还未发出任何写入：rejected / 2，提示状态已变化，重新查看和预览。
- process 审核已核对成功，但审核后的读取发现标签被别人改变：不发 PUT，partial / 4，提示审核已完成、标签步骤未执行，重新做独立标签计划。

这样可减少覆盖旧快照的风险，但 GET 与写入之间仍有窗口。没有版本条件或服务端锁，**不能保证并发安全，也不能阻止绕过 CLI 的重复审核**。

### 5.4 process 的固定执行流程

1. 校验全部参数，读取当前详情和标签库，生成审核与完整标签目标。任一输入不合法，零写入。
2. 按执行模式完成确认；再次读取详情，检查状态和标签是否与本次计划一致。
3. 提交一个审核 item。只有响应计数恰为 `success_count=1, failed_count=0`，才记录审核已获确认。
4. 重新 GET 详情：审核状态应为目标值；同时检查标签仍为原集合。审核核对不通过时停止；标签已变化时按部分完成停止。
5. 标签计划有变化才 PUT 完整目标数组；无变化标 skipped。
6. PUT 后重新 GET，核对**本次要求的审核状态与目标标签集合**，并返回 observed。最终不匹配或读失败不能报告全部成功。

顺序固定，没有自动补偿。一次正常的“两项都发生变更”调用约为 4 次详情 GET、1 次标签库 GET、1 次审核 POST、1 次标签 PUT；这是上述简单流程的请求预算，不是性能承诺。历史不自动成为每次写入的依赖，调用者可另读 history 辅助核查。

### 5.5 错误、回读与结果未知

| 情况 | 处理与后续 |
| --- | --- |
| 单条审核返回 1/0 | 记录写入 acknowledged，随后读取状态；计数确认与状态核对缺一不可 |
| 单条审核返回 0/1 | 按上游明确的单项失败处理，不更新标签。因为只有一个 item，可关联该 ID；不能从计数编造具体失败原因 |
| 审核计数缺失、为其他组合或响应不能解析 | 写入结果 unknown，不继续、不重发。不能把 HTTP 200 当作成功 |
| 标签更新返回成功响应及合规结果对象 | 记录 acknowledged，必须回读核对。result 是字符串，不能因示例为 ok 就宣称 schema 只允许 ok |
| 明确拒绝写入 | 只有确认属于未执行的校验/鉴权拒绝或明确业务失败，才标 failed；保留真实 HTTP 与业务 code/message。无法判断是否执行的 5xx、异常体等不能一律当作可重试失败 |
| 写入调用超时、连接中断、响应丢失 | 除非能够确认请求尚未发出，否则标 unknown / 5；后续写步骤不执行；不自动重试 POST 或 PUT |
| 写入已获确认，回读失败或值不匹配 | 标 verification_failed / 6，保留已获确认的写入信息；不撤销、不自动再写，也不把“核对失败”伪装成“写入肯定没发生” |
| 只读或写入前读取失败 | failed / 3，说明未提交写入；没有资料就不生成假预览 |

P0 不做自动网络重试或轮询核对；一次回读不符合预期时，用户可以另行 get / history。接口没有声明读写立即一致，所以“不匹配”也可能是延迟或其他人改写，提示中不擅自归因。

写入 unknown 后，即使补读已经看到 approved 或目标标签，也仍不能证明是本次调用执行，原调用继续保持 unknown。自动重放尤其可能追加审核记录。后续只能核查并由有权限的人决定是否另起独立操作；本期没有自动消除歧义的恢复命令。

## 6. 输出合同与退出码

### 6.1 统一 JSON 信封

所有正常受控的 JSON 结果（包括错误）输出**一个 JSON 对象**，UTF-8。所有命令共用字段：

| 字段 | 定义 |
| --- | --- |
| `schema_version` | 初始字符串 `1`；后续兼容新增字段，调用者不依赖字段顺序 |
| `invocation_id` | CLI 为本次调用生成的本地关联标识；不是上游幂等键，不会使同一请求去重，也不能关联服务端审计身份 |
| `environment, command, mode` | mock/api；规范命令名；read/preview/execute |
| `status, exit_code` | 本次整体结果和预期进程退出码，二者必须一致 |
| `content_id` | 单条命令的 ID；列表/标签库为 null |
| `data` | 读取结果，或 plan / steps / observed。observed 是最近一次实际读取的值，可为 null，不把计划写成当前值 |
| `error` | 无错误为 null；否则含稳定 CLI code、message、step 及可得的 upstream 信息；upstream 缺失时为 null，不伪造 HTTP/业务码 |
| `warnings` | 数组，保存存量废弃标签、数据异常等提示；不能用一条 warning 掩盖未知结果 |

假设在 Mock 副本上确认执行并核对成功，**完整设计示例**：

```json
{
  "schema_version": "1",
  "invocation_id": "local-demo-001",
  "environment": "mock",
  "command": "content.process",
  "mode": "execute",
  "status": "succeeded",
  "exit_code": 0,
  "content_id": "ct_000004",
  "data": {
    "plan": {
      "review": {"before": "pending", "action": "approve", "reason": "演示：人工已给出通过决定"},
      "tags": {"before": ["恋爱", "校园", "武侠"], "after": ["恋爱", "校园", "武侠", "轻松"]}
    },
    "steps": {
      "review": {"write": "acknowledged", "verification": "matched", "api_result": {"success_count": 1, "failed_count": 0}},
      "tags": {"write": "acknowledged", "verification": "matched", "api_result": {"result": "ok"}}
    },
    "observed": {"review_status": "approved", "quality_status": "normal", "visibility": "online", "tags": ["恋爱", "校园", "武侠", "轻松"]}
  },
  "error": null,
  "warnings": []
}
```

步骤 write 的取值为 `not_sent / acknowledged / failed / unknown / skipped`；verification 为 `not_checked / matched / mismatched / unavailable`。acknowledged 表示收到合规成功响应，不单独等于端到端成功。failed 仅表示已明确失败；未提交是 not_sent，不能混为失败。

plan.review.reason=null 只表示调用方未提供理由；构造上游审核请求时省略 reason，不能把 null 当成接口声明接受的字符串值发送。

预览的 mode 为 preview、status 为 previewed，所有待写步骤为 not_sent；即使退出码为 0，也不表示执行过。读取命令的 succeeded 只表示读取成功。脚本必须同时检查 mode、status、exit_code 和必要步骤，不只判断“JSON 能解析”。

### 6.2 标准输出与错误输出

- stdout：唯一结果。table 模式为可读摘要/字段块；JSON 模式为一个完整对象，不混入进度条、提示符或日志。
- stderr：交互预览/确认提示、简短诊断；JSON 模式不产生确认提示，错误详情也必须体现在 stdout 的 error 中，不能要求脚本解析 stderr 文案。
- 令牌、认证头和含凭据的配置不输出；上游诊断脱敏，不能把原始 HTTP dump 当作安全日志。
- `--help` 是面向人的帮助文本，不属于结果信封。进程被杀死、输出被截断、无法输出 JSON 时，不承诺有完整信封；调用方应视为没有可信结果，不能据此自动重放写入。

### 6.3 退出码

| 码 | status | 含义与调用方动作 |
| ---: | --- | --- |
| 0 | `succeeded / no_change / previewed` | 读取成功、执行且核对成功、无需变更或有效预览。必须结合 mode，不能把 previewed 当作已执行 |
| 1 | `failed` | 未分类的本地内部错误；如可能已有写入，结果应优先按 5/6 报告；拿不到可信结果时也不得自动重放 |
| 2 | `rejected` | 参数、配置、前置条件或执行确认方式不满足；无已提交写入时使用，修正后重新预览 |
| 3 | `failed` | 只读/前置读取失败，或无成功写步骤时的明确上游失败；保留真实错误，不自动重试写入 |
| 4 | `partial` | 审核已确认并核对成功，但标签明确失败或尚未提交即被阻断；只对未完成的标签重新计划 |
| 5 | `unknown` | 任一步写入结果未知；停止，核查，不自动重放。即使另一项已成功，也优先报告 5 |
| 6 | `verification_failed` | 已获成功响应，但核对失败或不可读；停止，核查，不能据此直接再写 |
| 7 | `cancelled` | 人工未确认或取消；零写入 |

结果优先级：写入 unknown 优先于 partial；已获确认的写入无法核对时用 6；其余存在审核已核对成功而标签未完成时用 4。下游步骤不因整体结果为非零而被伪装为全部失败。

“可信执行成功”的最低条件：环境正确、mode=execute、status=succeeded 或 no_change、退出码 0，所需写步骤 acknowledged 且核对 matched，或明确 skipped。这个结论只表示按当前响应与观测完成了目标，不表示具有强幂等、永久状态或真实操作者身份审计。

## 7. 典型使用流程

### 7.1 人工从待审核查询到闭环

以下是一条**计划中的 Mock 演示流程**。先重置工作副本；不改原始附件。人工是否通过及选什么标签由评审者明确给定。

```text
contentops --env mock content list --review-status pending --page 1
contentops --env mock content list --review-status pending --content-id ct_000004 --page 1
contentops --env mock content get ct_000004
contentops --env mock content history ct_000004
contentops --env mock tags list --status active
```

第一条用于浏览；第二条用于精确定位，不依赖未声明的分页排序。详情能看到正文和原标签，历史为空只说明附件中没有该 ID 的日志组。

假设人工明确给出“演示通过，新增轻松”的决定：

```text
contentops --env mock content process ct_000004 --action approve --reason "演示：人工已给出通过决定" --add "轻松"
contentops --env mock content process ct_000004 --action approve --reason "演示：人工已给出通过决定" --add "轻松" --execute
```

第二条在交互终端显示本次计划并要求输入 `ct_000004`。假设全部执行和核对成功，表格摘要应类似：

```text
整体结果   succeeded / 0
审核       acknowledged；回读 approved，与目标匹配
标签       acknowledged；回读 恋爱、校园、武侠、轻松，与目标匹配
质量/可见  normal / online（仅展示当前值）
```

然后用独立读取核对，而不是只截图“提交成功”：

```text
contentops --env mock --output json content get ct_000004
contentops --env mock content history ct_000004
contentops --env mock content list --review-status pending --content-id ct_000004 --page 1
```

Mock 的预期证据是：详情 approved 且标签四个；审核历史比初始增加一条本次模拟审核记录；pending 精确筛选为空。真实 API 的历史和状态时间可能存在附件所示矛盾，不能仅靠“最新一条看起来通过”覆盖当前详情。

也可用两条独立写命令完成同一流程：先 review，再 tags update，每条独立确认和核对。日常操作推荐 process；审核后补标签用独立入口。

### 7.2 误输入、非法标签与部分失败

**误输入 ID**：

```text
contentops --env mock content process "ct_000004 ct_000005" --action approve --add "轻松" --execute --yes
contentops --env mock content get ct_999999
```

第一条违反单 ID 规则，本地 rejected / 2、零写入。第二条 ID 形式可接受但不在附件中；由 Mock 的“目标不存在”场景返回明确读取失败，failed / 3，不自动改成相似 ID。材料没有给真实不存在错误码，产品示例不虚构其 HTTP 状态或业务 code。

**非法标签，在审核前阻断**：

```text
contentops --env mock content process ct_000004 --action approve --add "轻松松" --execute --yes
```

“轻松松”不在附件标签库，CLI 返回 rejected / 2、error.code=TAG_NOT_AVAILABLE，并提示先查 tags list；review、tags 都是 not_sent。可以提示核对名称，但不得自动替换为“轻松”。

**受控部分失败**：测试场景让审核成功并可回读，但标签写入在落库前被明确拒绝。这是后续新增的故障场景，不是声称附件接口必然有此故障或已发生过。

```text
contentops --env mock --output json --non-interactive content process ct_000004 --action approve --add "轻松" --execute --yes
```

该场景的完整结果示例：

```json
{
  "schema_version": "1",
  "invocation_id": "local-demo-002",
  "environment": "mock",
  "command": "content.process",
  "mode": "execute",
  "status": "partial",
  "exit_code": 4,
  "content_id": "ct_000004",
  "data": {
    "plan": {
      "review": {"before": "pending", "action": "approve", "reason": null},
      "tags": {"before": ["恋爱", "校园", "武侠"], "after": ["恋爱", "校园", "武侠", "轻松"]}
    },
    "steps": {
      "review": {"write": "acknowledged", "verification": "matched", "api_result": {"success_count": 1, "failed_count": 0}},
      "tags": {"write": "failed", "verification": "not_checked", "api_result": null}
    },
    "observed": {"review_status": "approved", "quality_status": "normal", "visibility": "online", "tags": ["恋爱", "校园", "武侠"]}
  },
  "error": {"code": "TAG_WRITE_REJECTED", "message": "Mock 故障场景：标签未写入；审核已完成，请仅重新计划标签操作", "step": "tags", "upstream": null},
  "warnings": []
}
```

这里 observed 来自审核后的那次读取，**不是失败后新读到的状态**；因此先重新 get，再恢复：

```text
contentops --env mock content get ct_000004
contentops --env mock content tags update ct_000004 --add "轻松"
contentops --env mock content tags update ct_000004 --add "轻松" --execute
contentops --env mock content get ct_000004
```

不重跑 process。若重跑，本期的 pending 前置检查会拒绝，但这不是服务端幂等保证。恢复标签不能增加审核记录。

**写入超时**：若审核 POST 可能已经落库但响应丢失，返回 unknown / 5，review.write=unknown、tags.write=not_sent。若是标签 PUT 超时，则保留审核 acknowledged/matched，tags.write=unknown，整体仍为 5。后续只先核查：

```text
contentops --env mock content get ct_000004
contentops --env mock content history ct_000004
```

这两个读取是线索，不能自动解除原调用的未知结果。API 写入操作者无法可靠区分时，不能承诺识别出哪一条记录一定属于这次超时调用。

### 7.3 脚本非交互调用

以下是 **PowerShell 使用示例**，用于后续运行 CLI；本轮没有执行它，也不是 Java 实现。

先预览并保存结果：

```powershell
contentops --env mock --output json --non-interactive content process ct_000004 --action approve --reason "演示：调用方明确给定的决定" --add "轻松" | Set-Content -LiteralPath './preview-result.json' -Encoding utf8
```

预览成功应为 mode=preview、status=previewed、exit_code=0；不能据此给业务任务标记“已审核”。经调用方确认后，另发明确执行调用：

```powershell
$jsonResult = & contentops --env mock --output json --non-interactive content process ct_000004 --action approve --reason "演示：调用方明确给定的决定" --add "轻松" --execute --yes 2> process-error.log
$commandExit = $LASTEXITCODE
$jsonResult | Set-Content -LiteralPath './process-result.json' -Encoding utf8
$result = $jsonResult | ConvertFrom-Json
$result.mode
$result.status
$result.data.steps
```

立即保存 LASTEXITCODE，避免被后续命令覆盖；结果文件显式按 UTF-8 保存，避免依赖 Shell 的重定向编码默认值。示例文件是运行时的结果文件，不是输入审批单；预览和执行仍是重新读取的两次调用。

脚本按以下规则判断，不自动循环重发写入：

| 判断条件 | 动作 |
| --- | --- |
| 退出 0，信封 exit_code=0，environment=mock，mode=execute，status=succeeded，review acknowledged/matched，tags acknowledged/matched 或 skipped/matched | 此次 Mock 任务可标完成；生产调用应检查预期的 api 环境，而不是照搬 mock |
| 退出 0，但 mode=preview | 只保存计划，不计为执行完成 |
| 退出 2 / 3 | 保存错误并停止；由调用方修正输入或处理明确错误，不自动扩大范围 |
| 退出 4 | 保存逐步结果，交由运营重新查看并仅处理标签；不重放整个 process |
| 退出 5 / 6 | 标记待核查，停止后续写入并通知任务负责人；不因回读目标状态相同而盲目重试 |
| JSON 缺失、解析失败、字段与进程退出码矛盾、环境不符，或意外非零退出 | 不能信任本次结果；保存可得证据并停止，不自动重放 |

P0 无论人还是脚本都不凭退出码 0 单独推断执行成功；也不把客户端 invocation_id 当作重试令牌。

## 8. 可验证验收标准

### 8.1 验收证据与数据前提

每个独立测试从可重置的 Mock 工作副本开始；串联流程单独标注。初始来源仍是只读附件；新增故障场景与原始数据分开。

至少保存：输入命令、环境、stdout、stderr、真实退出码、调用的 API 与次数、操作前后详情、必要的审核日志。令牌不进入证据。能够看到状态变了，还应能证明 CLI 没有偷偷重放审核或调用范围外接口。

以下是两周 P0 的验收目标，不是本轮已经跑过的测试结果。真实 API 若有可用环境，再增加联调证据；不能用 Mock 的故障行为推定真实服务的错误码或一致性。

### 8.2 产品验收

| 编号 | 条件与操作 | 通过标准 |
| --- | --- | --- |
| P-01 | 首次使用，仅阅读 help 和操作说明 | 能找到“查询 → 详情/历史 → 标签 → 预览 → 执行 → 核对”的完整路径；明确当前环境和单 ID 限制 |
| P-02 | 用 pending、page、keyword/tag 筛选 | 条件含义与 AND 一致；知道当前页、固定每页 20 和匹配总量；无结果不被报成服务故障 |
| P-03 | get ct_000004、history ct_000003、读取空正文和长标题样本 | 正文/完整标签可阅读；历史倒序且不丢动作；空正文有提示，长文本/emoji 不导致错行或 JSON 数据丢失 |
| P-04 | 对 ct_000004 执行 process，人工指定 approve + 新增轻松 | 默认预览不写；确认后审核和标签均实际改变并核对；独立 get 能看到 approved 与四个标签 |
| P-05 | 重置后独立 reject ct_000005 | CLI 要求有效理由；只完成审核，标签不被 CLI 改动；不附加下架/限流/通知请求 |
| P-06 | 独立新增、移除、替换标签 | 三种语义与预览一致；新增/移除保留未涉及标签；替换明确展示将删除哪些存量标签 |
| P-07 | 误 ID、非法标签、拒绝确认 | 提示具体对象或参数、说明是否提交、给出可执行的查看/修正方向；不选相似 ID、不自动改标签名称 |
| P-08 | 审核成功、标签明确失败 | 清楚显示审核已完成和标签未完成；退出 4；运营能按说明仅补标签，不要求重做审核 |
| P-09 | 模拟写入超时和核对失败 | 分别呈现 unknown / verification_failed，而非统一“失败请重试”；说明哪些步骤未执行及下一步核查命令 |
| P-10 | 脚本执行、HTML Demo、文档交叉检查 | 命令名、参数、状态和退出码一致；Demo 明示预设模拟，Mock 成功不被标成真实后台已成功 |

### 8.3 研发验收，可转为 Java 测试用例

| 编号 | 给定 / 操作 | 必须验证的结果与副作用 |
| --- | --- | --- |
| R-01 | 初始 Mock，pending 分别查询 page=1/7，另做 ID 精确筛选 | pending total=132；在稳定且无写入的测试中第 1 页 20、第 7 页 12；精确筛选 ct_000004 得 1 条；不把具体排序写成真实 API 保证 |
| R-02 | 过滤无匹配、page=0、page=abc、非法状态、未知选项 | 无匹配为成功空集合；其余 rejected / 2；参数错误不发写请求；上游报错不被擅自改成空集合 |
| R-03 | history ct_000003 与 ct_000004 | 前者输出 6 月 15 日在前、6 月 12 日在后，原因空串保留；后者为空。所有原始动作保留 |
| R-04 | tags list 默认、status=all、keyword=轻松 | 默认 23、all 25、关键词结果 1；只调用 GET /admin/tags，本地过滤不被发送成未声明参数 |
| R-05 | 对任一合法写命令不带 execute | 退出 0、mode=preview、status=previewed；POST/PUT 次数为 0；前后工作副本完全相同 |
| R-06 | execute 的交互确认、取消/EOF、JSON 未带 yes、仅带 yes | 正确完整 ID 才执行；取消为 7；非交互缺 yes 和 yes 无 execute 为 2；未确认时零写入、无 stdin 等待 |
| R-07 | review approve / reject，返回 1/0 | 每次审核 POST 的 items 长度严格为 1；action/reason 正确；省略理由时不传 null；回读匹配后才为成功；Mock 审核记录只新增 1 条 |
| R-08 | review 返回 0/1、2/0、缺计数或不可解析响应 | 0/1 为明确失败；其余为 unknown；process 均不调用标签 PUT；没有自动第二次 POST |
| R-09 | reject 缺/空理由，或 review/process 对当前非 pending 内容执行 | rejected / 2；零写入；对已完成内容再次执行 process 不重复追加记录 |
| R-10 | process 同时带 approve 与未知标签轻松松 | TAG_NOT_AVAILABLE、退出 2；审核 POST 与标签 PUT 均为 0，证明全量前置校验有效 |
| R-11 | 初始 ct_000004，分别 add 轻松、remove 武侠、set 恋爱/校园/轻松 | PUT 数组分别为四标签、恋爱/校园、恋爱/校园/轻松；回读按集合核对；不能只发送增量标签 |
| R-12 | add 已有标签、remove 不存在标签、set 相同集合不同顺序 | 合法且无变化时 no_change / 0、零 PUT，返回实际集合；process 中标签为 skipped，审核仍按需执行 |
| R-13 | add/remove 同一标签、混用 set、空标签、移除最后一个标签 | rejected / 2、零写入；最后一种明确说明不支持清空；不发送空数组 |
| R-14 | ct_000077 保留/移除旧版-悬疑；对其他内容新增旧版-悬疑 | 存量可保留/移除并警告；新增废弃标签拒绝。另用标注的新样本验证未知存量标签可保留/移除 |
| R-15 | 在预览读取和执行前检查之间改动审核状态/标签 | 尚未写入时 rejected / 2；若审核已核对成功才发现标签变化，则 partial / 4、零标签 PUT；不静默重算并继续 |
| R-16 | process 正常完成两项变更 | 严格先 POST、审核回读匹配，再 PUT、最终回读；各写接口恰调用 1 次；真实退出码与 JSON 一致 |
| R-17 | 受控故障：审核成功，标签落库前明确拒绝；随后只补标签 | 首次 partial / 4，保留审核 acknowledged/matched；恢复只调用标签相关写入；审核记录总共只增加 1 条 |
| R-18 | 受控故障：审核已落库但响应丢失；另测标签已落库但响应丢失 | 整体 unknown / 5；审核未知时标签 not_sent；标签未知时保留审核成功；每次都无写入重试，即使回读已是目标值仍不抹去 unknown |
| R-19 | 收到写入成功响应后，回读失败或返回旧值/并发新值 | verification_failed / 6，分别标 unavailable/mismatched；保留 acknowledged；审核核对失败时不做标签；不自动回滚 |
| R-20 | 前置读取失败、响应缺必需字段、ID 对不上；API 鉴权错误 | 无法计划时零写入，按错误分类返回；保留可得的上游 code/message，不伪造“内容不存在”或“可重试” |
| R-21 | JSON 成功/预览/拒绝/部分失败/未知/核对失败各执行一次 | stdout 恰为一个可解析对象；schema_version、mode、status、exit_code 与实际退出一致；错误含稳定 CLI code；stderr 文案不作为解析依赖 |
| R-22 | mock/api 环境检查、缺 api 配置、含令牌的故障诊断 | 缺配置拒绝且不回退；环境标识准确；stdout、stderr、HTML 和结果文件均不泄露凭据 |
| R-23 | 两个独立 CLI 进程：前一个变更，后一个 get；重置工作副本 | 后一进程读到已保存的 Mock 状态；重置可复现初始状态；原始题目/OpenAPI/Mock 文件校验值不变 |
| R-24 | 检查调用范围与无可信输出情况 | 全流程只调用六项 API；不发送通知/处置；输出截断、进程中断等在调用方说明中明确不能自动重放，不承诺跨进程恢复 |

所有 P0 场景通过才可称完整 MVP 验收完成。未接入真实环境、并发窗口、不可判定超时和 op_api 身份局限须保留在交付说明中，不能通过修改测试期望隐藏。

## 9. 一名 Java 后端的十个工作日计划

### 9.1 两周完整 MVP

| 工作日 | 具体安排 | 当日可检查产出 |
| --- | --- | --- |
| D1 | 0.75 日确认产品合同/验收和下一阶段技术选择，0.25 日搭通读取路径 | 范围冻结、错误/输出合同清晰；能证明附件只读、环境隔离。框架选择在技术设计阶段完成，不在本文预定 |
| D2 | 1 日完成四个只读入口、基本表格/JSON、分页与本地标签过滤 | 列表/详情/历史/标签库可演示，ct_000004 状态与附件一致 |
| D3 | 1 日完成单条审核与基本校验 | approve/reject、理由校验、单 item 计数解释、日志追加可验证 |
| D4 | 1 日完成标签增删/替换与完整数组计算 | 三种预览与实际 PUT 正确，存量废弃标签处理明确 |
| D5 | 0.25 日收尾标签边界，0.75 日统一预览/确认/非交互和结果处理 | 非交互不阻塞；错误输出和标签无变化处理统一 |
| D6 | 0.50 日完善共享核对/未知结果，0.50 日做组合命令 | 两步固定顺序、失败停止，不能回读时不报全成功 |
| D7 | 0.25 日收尾组合，0.75 日完善可持久化 Mock 和故障场景 | 正常闭环、标签明确失败、响应丢失均可重复演示；不更改原始附件 |
| D8 | 0.25 日 Mock 收尾，0.75 日集中自动化回归 | 重点覆盖零写入、写入次数、部分失败和未知分支；问题可定位 |
| D9 | 0.25 日测试收尾，0.50 日 HTML Demo，0.25 日操作文档 | Demo 与 CLI 命令/JSON 一致；明确模拟与真实状态区别 |
| D10 | 0.50 日评审验收、证据与已知限制，0.50 日缓冲修复 | 产品/研发验收记录、重置/演示说明、缺口清单；仅在无阻塞问题且有余量时考虑 P1 |

Mock 和基础验证随核心开发先做；D7 是完善故障与跨进程演示能力，不能等到 D7 才第一次测试写入。D8–D9 的测试预算用于集中回归和故障验证。

计划已用满 10 日，余量只有 0.5 日。超时恢复、可配置流程、更多 API、复杂终端体验都不能追加为必做。若 D6 仍未有可信的正常闭环，则冻结 P1、将 HTML 限制为静态预设展示，优先修正写入和结果；若 P0 仍无法按期完成，应明确标记未通过项目，不能用演示页面代替实际 CLI 验收。

### 9.2 48 小时试炼：交付切片与完整 MVP 的差别

用户已确认需要可运行的最小 Java CLI，因此单有方案文档或 HTML 不能完成试炼目标。建议按两天合计约 **18 小时有效工作 + 日历时间中的休息/机动** 安排，避免把 48 小时理解为一个人连续研发 48 小时；实际预算在下一阶段技术选择后复核。

| 交付项 | 48 小时最低切片 | 两周完整 MVP 补齐 |
| --- | --- | --- |
| 文档 | 复用 01、完成本 02；下一阶段给出足以落地的技术说明、运行/操作/边界说明 | 完整评审、验收与全部 P0 证据 |
| 只读 CLI | Mock 的 list/get/history/tags list；列表先满足 pending/page/content-id | 所有 P0 筛选、完整帮助与排版边界 |
| 写入 CLI | 单条 review 与 process；标签先满足 add，独立 tags update 能补标签；可跨进程 get 核对 | 标签 remove/set、完整存量/并发变化校验和所有 P0 边界 |
| 安全和输出 | 默认预览；实际执行显式 execute+yes；基础表格/统一 JSON；禁止写入自动重试；单项结果、部分失败 4、未知 5 和核对失败 6 的基本区分 | 交互输入完整 ID、各种受控退出与全面校验/回归 |
| 环境 | 仅验收 Mock 工作副本；所有输出标 mock | 六项 API 的适配及可得的真实环境联调，不承诺占位地址可用 |
| 演示 | 一次真实运行最小 CLI 的闭环证据；明确失败/超时的少量受控证据；HTML 单页展示 | R-01 至 R-24 完整通过和异常覆盖 |

这是**48 小时可运行切片的收缩**，不是把两周 P0 的标签移除/替换等要求降成 P1。若试炼只实现部分命令参数，help 和 HTML 都必须准确标记支持情况，未实现参数明确拒绝，不能展示成可执行功能。

| 时间分配 | 有效工作估算 | 目标 |
| --- | ---: | --- |
| 第一天：范围/最小技术说明 | 2 小时 | 复用已有分析，冻结最小切片和安全底线，不再扩 API |
| 第一天：Mock 工作副本与四个读取入口 | 4 小时 | 可运行、可查询、环境有标识 |
| 第一天：最小单条审核/标签新增闭环 | 3 小时 | 能显式执行，返回 JSON，第二个进程能读到变更 |
| 第二天：回读、局部失败/未知处理、冒烟验证 | 3 小时 | 正常闭环、零写入预览、部分失败和超时不重放有证据 |
| 第二天：HTML 轻量展示 | 2 小时 | 使用已验证结果或明确预设的模拟，不再开发后台页面 |
| 第二天：操作说明和演示复核 | 2 小时 | 命令可复制、结果可复现，列出未完成 P0 |
| 第二天：机动修复 | 2 小时 | 优先修核心路径，不加入 P1 |
| **合计** | **18 小时** | **试炼切片，不声称等于十日完整 MVP** |

如果下一阶段确认该切片仍无法在时间内完成，应进一步减少展示和过滤参数，保留“可执行审核 + 实际标签变更 + 回读证据 + 明示未知结果”的底线；不能删掉实际写入只留下模拟成功文字。此时须明确暴露交付缺口，而不是默认已完成用户确认的最低目标。

## 10. 为后续 Agent 预留什么

### 10.1 第一阶段必须打好的基础

- 稳定命令语义、schema_version、明确的 read/preview/execute，以及不阻塞的显式非交互执行。
- 单个 ID 贯穿计划、步骤与实际观测；审核与标签分别报告，不把局部成功压成一个布尔值。
- 部分失败、未知、核对失败和未提交的区别；调用方知道什么时候停止，未来不会被错误成功信号驱动重试。
- 预览与完整标签目标、写前变化检查、写后核对；承认其不能替代服务端版本校验。
- invocation_id 用于客户端关联和保存 stdout，凭据脱敏；不预先引入幂等键假语义。
- 单条业务判断由调用方提供；历史和正文按数据处理，不能被内容中的文字变成额外操作指令。

### 10.2 放到后续 Agent / 100 条阶段

目标文件与固定 ID 清单、批内去重、目标快照说明、逐项审批/预览、批次结果持久化、限速与并发、任务暂停和恢复、未知项人工对账、审计身份增强，以及 Agent 审核判断的授权/质量标准。

现有审核 API 最多 20 项且只有计数，后续必须重新选择“每项单独请求”还是“分批提交并承认不可逐项确认”，并评估是否需要上游补逐项结果、幂等和版本条件。不能把现有单条调用简单循环 100 次就宣称完成了可靠批量方案。

第一阶段不预建消息队列、任务调度平台、分布式工作流或数据库任务中心。等批量的执行、恢复与审计需求具体化后再决定是否需要持久化和其他组件。

## 11. 当前决定与仍需确认的业务政策

本稿确定用于后续技术设计的产品基线为：**方案 A 的六项 API 范围；C 型命令组织；单条 process；默认预览；人工显式确认；脚本 execute+yes；先审核后标签；分别回读；不自动重试或回滚**。本次 48 小时交付目标已由用户确认，不再作为悬而未决的问题。

以下两组规则在本文按推荐值写成了可测试合同，属于比上游更严格的 CLI 业务政策，仍值得产品确认；它们不阻止本轮文档完成：

1. **审核政策**：P0 只处理 pending，驳回强制填写理由，不开放 force 或重复审核。
2. **标签政策**：只允许新增 active 标签，存量废弃/未知标签可保留或移除；P0 不支持清空全部标签。

上述政策若调整，需要同步修改示例、校验和验收。真实服务地址、令牌配置方式、运行平台和 Java 框架由下一阶段技术设计确定；本文不推断材料外的服务能力。
