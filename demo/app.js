"use strict";
(() => {
  const D = window.DEMO_DATA;
  const main = document.querySelector('main');
  const state = {route:'product', step:0, snapshot:'before', command:6, selected:false,
    executionShown:false, outcome:'normal', fault:'tags-reject-before-write',
    recovery:false, capability:'current', open:new Set()};
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const task = key => D.task[key];
  const before = task('05-candidate-ct000004-detail').result.data;
  const after = task('14-after-detail').result.data;
  const link = (path, label) => `<a href="../${esc(path)}">${esc(label)} ↗</a>`;
  const tags = (values, added=[]) => `<div class="tagrow">${values.map(t => `<span class="tag ${added.includes(t)?'added':''}">${esc(t)}</span>`).join('')}</div>`;
  const sourcebar = (type, text, path, label='查看原始证据') => `<div class="sourcebar ${type}"><strong>${esc(text)}</strong>${link(path,label)}</div>`;
  const sources = entries => `<div class="source-links">${entries.map(([p,l])=>link(p,l)).join('')}</div>`;
  const header = (title, text) => `<h1>${title}</h1><p class="intro">${text}</p>`;
  const commandBox = (cmd, title='命令') => `<div class="panel-head"><h3>${esc(title)}</h3><button type="button" data-copy="${esc(cmd)}" aria-label="复制命令">复制命令</button></div><div class="terminal"><div class="prompt">PowerShell / 项目根目录</div><pre>${esc(cmd)}</pre></div>`;
  const stepTable = steps => `<div class="table-scroll"><table class="steps-table"><thead><tr><th>步骤</th><th>写入状态</th><th>核对结果</th></tr></thead><tbody>${Object.entries(steps).map(([k,v])=>`<tr><td><code>${esc(k)}</code></td><td><code>${esc(v.write)}</code></td><td><code>${esc(v.verification)}</code></td></tr>`).join('')}</tbody></table></div>`;
  const rawDetails = (r, label='查看完整 JSON 与 stderr') => `<details class="raw-details"><summary>${esc(label)}</summary><div class="stream-label">stdout · 全字段格式化视图（无截断）</div><div class="terminal"><pre class="json-view">${esc(JSON.stringify(r.result,null,2))}</pre></div><div class="stream-label">stderr · ${r.stderr.trim()?'原始诊断':'空'}</div>${r.stderr.trim()?`<div class="terminal"><pre>${esc(r.stderr)}</pre></div>`:''}${sources([[r.source+'.stdout.txt','原始 stdout'],[r.source+'.stderr.txt','原始 stderr'],[r.source+'.exit-code.txt','实际进程退出码']])}</details>`;
  const resultView = (r, explanation='') => {
    const v = r.result;
    const color = v.exit_code===5||v.exit_code===6?'danger':v.exit_code?'warning':'';
    return `<div class="statusline"><span class="status ${color}">${esc(v.status)}</span><span class="exit">exit ${r.exit}</span><span class="muted mono">mode=${esc(v.mode)}</span></div>${explanation?`<p class="explain">${explanation}</p>`:''}${v.data?.steps?stepTable(v.data.steps):''}${rawDetails(r)}`;
  };
  const fields = c => `<table class="data-table"><tbody>${Object.entries(c).map(([k,v])=>`<tr><td>${esc(k)}</td><td>${esc(Array.isArray(v)?JSON.stringify(v):v)}</td></tr>`).join('')}</tbody></table>`;
  const commands = [
    {name:'content list',description:'查询待审核内容，固定每页 20 条；多个筛选条件按 AND 组合。',params:'--review-status pending|approved|rejected；--page 正整数（默认 1）；--content-id 精确 ID。',api:'GET /admin/contents',record:'03-pending-page1-json'},
    {name:'content get',description:'按明确 ID 读取完整详情；操作后仍用同一命令查询实际状态。',params:'一个必填 content_id。',api:'GET /admin/contents/{content_id}',record:'05-candidate-ct000004-detail'},
    {name:'content history',description:'按时间倒序展示审核历史；保留所有动作，不修改原始数据。',params:'一个必填 content_id。',api:'GET /admin/contents/{content_id}/review-logs',record:'07-candidate-ct000004-history'},
    {name:'tags list',description:'从全库读取后，在 CLI 本地过滤 active 或 all。默认 active。',params:'--status active|all；当前不支持 deprecated 单独筛选或 keyword。',api:'GET /admin/tags',record:'08-active-tags'},
    {name:'content review',description:'人工提供 approve 或 reject；只处理 pending，reject 必须给非空理由。',params:'content_id；--action approve|reject；--reason 文本；执行时 --execute --yes。',api:'GET 详情 → POST /admin/content-reviews（items 只有 1 项）→ GET 详情',template:`java -jar ./target/contentops.jar --env mock --output json content review ct_000004 --action approve --reason '人工提供的本地演示决定'`},
    {name:'content tags update',description:'只新增标签，保留原有标签并计算完整目标数组，再调用全量覆盖 API。',params:'content_id；--add 标签（可重复，不按逗号拆分）；执行时 --execute --yes。未实现 remove/set。',api:'GET 详情 + GET /admin/tags → PUT /admin/contents/{content_id}/tags → GET 详情',template:`java -jar ./target/contentops.jar --env mock --output json content tags update ct_000004 --add '悬疑'`},
    {name:'content process',description:'一次命令编排审核与标签新增。先校验全部输入，再按审核→核对→标签→核对执行。',params:'content_id；--action；--reason；--add（可重复）；执行时 --execute --yes。',api:'GET 详情 / 标签库 → 单 item POST 审核 → GET → 全量 PUT 标签 → GET',record:'10-process-preview'}
  ];
  function commandPage() {
    const c=commands[state.command];
    const r=c.record?task(c.record):null;
    const readSummary = !r ? '' : c.name==='tags list' ? `<p class="explain">实测 active 标签共 ${r.result.data.total} 个。</p>${tags(r.result.data.items.map(t=>t.tag))}` : c.name==='content list' ? `<p class="explain">实测 total=${r.result.data.total}，page=${r.result.data.page}，page_size=${r.result.data.page_size}；items=${r.result.data.items.length}。完整列表见 JSON。</p>` : c.name==='content history' ? `<p class="explain">此内容初始历史 ${r.result.data.items.length} 条；items=[] 表示空历史，不用于证明任意 ID 存在。</p>` : '';
    const shape = `<div class="table-scroll"><table><thead><tr><th>返回字段</th><th>结构说明（非新增运行结果）</th></tr></thead><tbody><tr><td>schema_version / invocation_id</td><td>输出契约版本 / 本次调用标识，非服务端幂等键</td></tr><tr><td>environment / command / mode</td><td>环境 / 命令路径 / preview 或 execute</td></tr><tr><td>status / exit_code</td><td>整体状态及与实际进程一致的退出码</td></tr><tr><td>data.plan</td><td>原状态、人工动作与理由，完整标签 before / after</td></tr><tr><td>data.steps.${c.name==='content review'?'review':'tags'}</td><td>write、verification、api_result 分别记录</td></tr><tr><td>data.observed / error / warnings</td><td>最近读取的实际状态 / 错误 / 警告，不能用目标值填充观测</td></tr></tbody></table></div>`;
    return header('命令手册','只展示当前原型支持的语法。复制不会执行；在终端手工尝试时，请按 README 使用新的独立状态目录。')+
      sourcebar('','当前能力 · Mock 单条 CLI','README.md','完整运行说明')+
      `<div class="command-layout"><div class="command-menu" role="group" aria-label="选择命令">${commands.map((c,i)=>`<button data-command="${i}" aria-pressed="${state.command===i}">${esc(c.name)}</button>`).join('')}</div><section class="panel"><h2 class="mono">${esc(c.name)}</h2><p class="command-description">${esc(c.description)}</p><p><strong>参数：</strong>${esc(c.params)}</p><p class="api">${esc(c.api)}</p>${commandBox(r?r.command:c.template)}${r?`<p class="muted">任务二实测记录：${esc(r.result.mode)} / ${esc(r.result.status)}。这是历史快照，非本页执行。</p>${readSummary}${resultView(r)}`:`<div class="note info">上方为当前有效的预览调用模板，本页没有执行此命令。返回采用统一信封，data 中包含 plan、steps、observed；review 含 review 步骤，tags update 含 tags 步骤。授权执行且步骤为 acknowledged / matched 才确认写入完成。</div>${shape}<p class="muted">可在任务二查看组合命令真实结果；在本页全部故障证据中查看独立标签修复的真实 stdout。这里不编造独立预览结果。</p>`}<div class="note">公共参数：<code>--env mock|api</code>、<code>--output table|json</code>、<code>--non-interactive</code>、<code>--help</code>。api 尚未实现且返回 rejected/2。写命令默认预览；execute 和 yes 缺一即拒绝。本原型不读取 stdin。</div></section></div>`;
  }
  const faultMeta = {
    'tags-reject-before-write':['审核成功，标签明确失败','标签委托前拒绝；审核已经提交。清除故障并核查后，仅用独立标签命令恢复。不得重做 process。'],
    'review-commit-response-lost':['审核提交后，响应丢失','磁盘已审核，但本次调用没有可信响应。保留 unknown/5，标签未提交。暂停并人工核查，不重发审核。'],
    'tags-commit-response-lost':['标签提交后，响应丢失','磁盘含目标标签，但调用没有确认标签响应。另行读取到目标值也不能把原 unknown/5 改成 succeeded。'],
    'review-readback-mismatch':['审核确认后，回读不匹配','审核已获确认；受控包装器仅向调用方返回一次旧审核视图。保留 verification_failed/6，停止标签写入。'],
    'tags-readback-mismatch':['标签确认后，回读不匹配','两次写入都已获确认；受控包装器返回一次旧标签视图。保留 acknowledged / mismatched，不回滚或自动重试。']
  };
  function faultsPage(){
    const f=D.faults[state.fault];
    const r=state.recovery?f.recovery:f.process;
    const disk=state.recovery?f.recoveredQuery.result.data:f.query.result.data;
    const observed=r.result.data.observed;
    const h=state.recovery?f.recoveredHistory:f.history;
    const recordedEnvironment=state.recovery?'此恢复记录已清除 CONTENTOPS_MOCK_SCENARIO。':`此故障记录设置了 CONTENTOPS_MOCK_SCENARIO=${state.fault}。复制命令本身不会设置这个变量。`;
    return header('失败结果，也必须说清楚。','切换已验证的受控故障记录，区分调用方确认、回读观测与持久化结果。此页不会注入新故障。')+
      sourcebar('fault','S5 · 受控 Mock 故障实测 / 新增“轻松”','evidence/s5/README.md')+
      `<p class="explain">${esc(recordedEnvironment)}每个场景使用独立工作副本，核查时关闭故障。复现方法见 README。</p>`+
      `<div class="fault-controls"><label for="fault-select">选择记录</label><select id="fault-select">${Object.entries(faultMeta).map(([k,[title]])=>`<option value="${k}" ${state.fault===k?'selected':''}>${esc(title)}</option>`).join('')}</select></div>${state.fault==='tags-reject-before-write'?`<div class="segmented" role="group" aria-label="部分失败与独立修复"><button data-recovery="false" aria-pressed="${!state.recovery}">查看部分失败</button><button data-recovery="true" aria-pressed="${state.recovery}">查看独立补标签回放</button></div>`:''}
      <div class="two-col"><section class="panel"><h2>${state.recovery?'独立补标签 · 已有恢复记录':esc(faultMeta[state.fault][0])}</h2><p class="mono muted">${esc(state.fault)}</p>${commandBox(r.command)}${state.recovery?'<div class="note info">原 partial/4 记录保持不变。清除故障后，独立 tags update 返回 succeeded/0；历史仍只有 1 条，没有再次审核。</div>':`<div class="note">${esc(faultMeta[state.fault][1])}</div>`}${resultView(r)}${!state.recovery?`<details><summary>查看本次 JVM 的实际调用计数</summary><div class="terminal"><pre>${esc(JSON.stringify(f.facts.calls,null,2))}</pre></div></details>`:''}</section><aside class="panel inspector"><h2>调用观测 ≠ 磁盘事实</h2><div class="field-label">调用结束时最后一次成功读取</div><p class="state-label ${observed.review_status}">${esc(observed.review_status)}</p>${tags(observed.tags,['轻松'])}<div class="field"><span class="field-label">关闭故障后，新 JVM 普通查询</span><p class="state-label ${disk.review_status}">${esc(disk.review_status)}</p>${tags(disk.tags,['轻松'])}<p class="muted">历史 ${h.result.data.items.length} 条 · ${state.recovery?'revision 2':'revision '+f.facts.disk_revision_after_process}</p></div><div class="note info">磁盘事实是后续独立核查结果，不补写到原调用的 observed，也不改变其 status。</div>${sources([[f.query.source+'.stdout.txt','故障关闭后的查询'],[h.source+'.stdout.txt','对应历史记录'],['evidence/s5/scenarios/'+state.fault+'/result.json','磁盘 / 计数验证']])}${state.recovery?sources([[f.recoveredQuery.source+'.stdout.txt','独立修复后查询']]):''}<details><summary>查看当前磁盘核查 JSON</summary><div class="terminal"><pre class="json-view">${esc(JSON.stringify((state.recovery?f.recoveredQuery:f.query).result,null,2))}</pre></div></details></aside></div><p class="metrics-caption">每个 S5 场景使用独立初始副本，目标标签为“轻松”；任务二新增“悬疑”，两组操作不能合并成同一次记录。这些故障没有连接真实 HTTP。</p>`;
  }
  const capabilityContent = {
    current:{title:'现有单条能力 · 已实现',items:['固定一个 content_id，默认预览，执行需 --execute --yes；JSON 与实际退出码对应。','审核仅一个 item，确认并回读后才更新完整标签数组；支持独立补标签。','partial/4、unknown/5、verification_failed/6 有真实 Mock 证据，不自动重试。','当前独立预览不强绑定后续执行计划；process 内部进度在内存中，最终 JSON 结束时输出。']},
    future:{title:'批次执行基础 · 尚未实现',items:['先在只读收集期冻结最多 100 个明确 ID；不能边审核 pending 边翻页，否则队列收缩可能漏项。','逐项计划与理由交给人工审批；--yes 只是本次授权参数，不是审批身份或审批快照绑定。','可信本地执行器串行复用单条 CLI，持久化 intent、每次 stdout/stderr/退出码和任务账本。','unknown 默认暂停整批核查；partial 仅恢复标签；子进程中断不能把未知写入伪装成未提交。','正式批次门槛还需计划绑定、速率限制与恢复检查；不需要先引入消息队列或调度平台。']},
    upstream:{title:'上游接口限制 · 需协作增强',items:['分页固定 20，未声明稳定排序、游标或快照。客户端冻结已见 ID 不保证某时点覆盖完整。','审核接口最多 20 项但只有成功/失败计数；重试会追加审核日志，所以近期仍单条提交。','需要服务端幂等键与逐项结果才能提高重试可信度；invocation_id 不是幂等键。','标签仍逐条全量覆盖，没有版本 / ETag 条件；两接口没有联合事务。','真实权限、审批人/执行人关联与请求审计需要上游支持；Mock 操作人不代表真实认证。']}
  };
  const stepTitles=['查询待审核','查看内容','操作预览','确认执行','结果核验'];
  const stepRecords=['03-pending-page1-json','05-candidate-ct000004-detail','10-process-preview','13-process-execute','14-after-detail'];
  const dayPlan=[
    ['D1','0.75 日确认产品合同/验收和下一阶段技术选择，0.25 日搭通读取路径'],
    ['D2','1 日完成四个只读入口、基本表格/JSON、分页与本地标签过滤'],
    ['D3','1 日完成单条审核与基本校验'],
    ['D4','1 日完成标签增删/替换与完整数组计算'],
    ['D5','0.25 日收尾标签边界，0.75 日统一预览/确认/非交互和结果处理'],
    ['D6','0.50 日完善共享核对/未知结果，0.50 日做组合命令'],
    ['D7','0.25 日收尾组合，0.75 日完善可持久化 Mock 和故障场景'],
    ['D8','0.25 日 Mock 收尾，0.75 日集中自动化回归'],
    ['D9','0.25 日测试收尾，0.50 日 HTML Demo，0.25 日操作文档'],
    ['D10','0.50 日评审验收、证据与已知限制，0.50 日缓冲修复']
  ];
  const openAttrs=id=>state.open.has(id)?' open':'';
  const auxiliary=html=>html.replaceAll('<h1>','<h3>').replaceAll('</h1>','</h3>');
  function productPage(){
    return header('将内容运营后台的核心操作，封装为可复用的 CLI。','通过统一命令完成内容查询、审核与标签管理，供运营人员、自动化脚本及未来 Agent 使用。')+`
      <div class="constraints" aria-label="MVP 资源约束"><div><strong>1 名 Java 后端</strong><span>单人开发与验收</span></div><div><strong>2 周 MVP</strong><span>10 个工作日的产品计划</span></div><div><strong>6 项现有 API</strong><span>围绕单条内容闭环封装</span></div></div>
      <div class="scope-grid">
        <section class="scope-plan"><h2>产品计划 · 两周 MVP</h2><p>查询 → 审核 → 标签维护，优先完成运营闭环。</p><p class="muted">独立命令便于定位和修复；组合 <code>process</code> 减少正常流程的多次调用，共享校验与核对。</p></section>
        <section class="scope-now"><h2>已验证 · 48 小时 Java 原型</h2><p>四个只读入口 + 三个写入口，基于本地 Mock。</p><p class="muted">HTTP、标签 remove/set、人工输入 ID 确认及完整筛选<strong>尚未实现</strong>，需按两周计划补齐。</p></section>
      </div>
      <div class="audiences"><p><strong>运营人员</strong>网页查找与点击 → 明确命令，人工给出决定</p><p><strong>脚本</strong>复用相同命令，通过 JSON 与退出码判断</p><p><strong>未来 Agent</strong>在审批、目标与执行约束下调用，批次待实现</p></div>
      <section class="product-workflow"><h2>第一阶段核心工作流</h2><ol class="workflow-strip">${stepTitles.map((t,i)=>`<li class="${i===2||i===4?'emphasis':''}"><span>${i+1}</span>${['查询待审核','查看详情 / 历史','默认预览','明确执行','回读验证'][i]}</li>`).join('')}</ol><p class="muted">默认预览不改数据；明确授权才写入，执行后核对实际状态。</p></section>
      <div class="product-compact"><h2>围绕闭环取舍，不按 API 数量堆功能。</h2><p>保留四个只读命令与 review、tags update、process。分发、上下架、创作者管理和复杂批处理暂不纳入，保护单人两周的验证与交付时间。</p><details id="api-scope"${openAttrs('api-scope')}><summary>查看六项 API 与七个命令的关系</summary><div class="table-scroll"><table><thead><tr><th>现有 API</th><th>CLI 入口</th></tr></thead><tbody>${commands.slice(0,6).map(c=>`<tr><td class="api">${esc(c.api)}</td><td class="mono">${esc(c.name)}</td></tr>`).join('')}<tr><td>复用审核与标签更新两个 API</td><td class="mono">content process</td></tr></tbody></table></div></details></div>
      <section class="product-compact"><h2>十个工作日：沿用已确认排期</h2><div class="timeline">${[['D1–2','合同与读取'],['D3–4','审核与标签'],['D5–6','确认与编排'],['D7–8','Mock 与回归'],['D9–10','演示与验收']].map(([d,t])=>`<div><strong>${d}</strong><span>${t}</span></div>`).join('')}</div>
        <details id="full-plan"${openAttrs('full-plan')}><summary>查看十日完整安排与验收</summary><p class="muted">摘自 docs/02 第 9.1 节；Mock 和测试随核心开发先做，D7–D9 是完善与集中回归。计划已满，只有 D10 的 0.50 日缓冲。</p><table class="day-plan"><thead><tr><th>工作日</th><th>已确认安排</th></tr></thead><tbody>${dayPlan.map(([day,plan])=>`<tr><td>${day}</td><td>${esc(plan)}</td></tr>`).join('')}</tbody></table>${sources([['docs/02-第一阶段MVP与CLI产品方案.md','完整计划 / 产品与研发验收'],['docs/04-交付物规划与验收清单.md','交付与验收清单']])}</details>
        <p class="acceptance"><strong>验收看实际结果：</strong>能定位内容 · 预览零写入 · 分步执行并核对 · 准确报告 partial/unknown · 脚本可解析</p>
      </section>
      <div class="page-actions"><a class="link-button" href="#demo">体验一次 CLI 操作 <span aria-hidden="true">→</span></a>${link('docs/02-第一阶段MVP与CLI产品方案.md','查看完整产品方案')}</div>`;
  }
  function planPanel(){
    const plan=task('10-process-preview').result.data.plan;
    return `<aside class="panel plan-panel"><h2>本次操作计划</h2><p class="mono">ct_000004</p><p class="content-title">${esc(before.title)}</p><div class="field"><span class="field-label">审核目标 · 计划，尚未写入</span><p class="state-change"><span>pending</span><b>→</b><strong>approved</strong></p></div><div class="field"><span class="field-label">完整标签数组</span>${tags(plan.tags.before)}<p class="muted">保留以上三项，拟新增：</p>${tags(['悬疑'],['悬疑'])}<details><summary>查看完整目标数组</summary><pre>${esc(JSON.stringify(plan.tags.after))}</pre></details></div><div class="field"><span class="field-label">人工提供的审核原因</span><p>${esc(plan.review.reason)}</p></div></aside>`;
  }
  function contentPanel(){
    const c=state.snapshot==='before'?before:after;
    const history=task(state.snapshot==='before'?'07-candidate-ct000004-history':'15-after-history');
    return `<aside class="panel inspector"><h2>已记录的内容快照</h2><p class="mono">ct_000004</p><p class="content-title">${esc(c.title)}</p><div class="segmented" role="group" aria-label="内容快照"><button data-snapshot="before" aria-pressed="${state.snapshot==='before'}">操作前</button><button data-snapshot="after" aria-pressed="${state.snapshot==='after'}">操作后</button></div><p class="muted">${state.snapshot==='before'?'操作前快照':'最终执行后快照'}，非当前页面实时状态。</p><span class="state-label ${c.review_status}">${esc(c.review_status)}</span>${tags(c.tags,['悬疑'])}<div class="field"><span class="field-label">正文</span><p class="body-text">${esc(c.body)}</p></div><p><strong>审核历史 ${history.result.data.items.length} 条</strong></p><details><summary>查看完整详情字段</summary>${fields(c)}</details><details><summary>查看此快照的审核历史</summary><pre>${esc(JSON.stringify(history.result.data,null,2))}</pre></details>${sources([[task(state.snapshot==='before'?'05-candidate-ct000004-detail':'14-after-detail').source+'.stdout.txt','详情来源'],[history.source+'.stdout.txt','历史来源']])}</aside>`;
  }
  function comparison(){
    return `<section class="comparison"><h2>变化已持久化，由新 JVM 再次读取。</h2><div class="comparison-grid">${[['操作前',before,0],['最终执行后',after,1]].map(([label,c,count])=>`<div><h3>${label}</h3><p class="state-label ${c.review_status}">${esc(c.review_status)}</p>${tags(c.tags,['悬疑'])}<p>标签 ${c.tags.length} 个 · 审核历史 ${count} 条</p></div>`).join('')}</div><div class="metrics"><div class="metric"><small>待审核总数</small><strong>132 → 131</strong></div><div class="metric"><small>审核历史</small><strong>0 → 1</strong></div><div class="metric"><small>最终快照</small><strong>revision ${D.taskFacts.revision}</strong></div></div><p class="muted">原有三项标签保留，新增“悬疑”；其余业务字段未因本次操作改变。</p>${sources([[task('15-after-history').source+'.stdout.txt','操作后历史'],[task('16-after-pending-exact').source+'.stdout.txt','精确 pending 查询'],[task('17-after-pending-total').source+'.stdout.txt','待审核总数'],['evidence/task2/after/snapshot-facts.json','revision / SHA'],['evidence/task2/validation/result.json','跨 JVM 与差异验证']])}</section>`;
  }
  function walkthrough(){
    const r=task(stepRecords[state.step]);
    let body='',right=contentPanel(),showResult=true;
    if(state.step===0){
      body=`<p class="queue-summary"><strong>${r.result.data.total}</strong> 条初始待审核 · 第 1 页 / ${r.result.data.items.length} 条</p><p class="muted">选择实际第二行 ct_000004，进入已有记录。其他行只展示真实列表数据。</p><div class="table-scroll queue-scroll"><table class="queue-table"><thead><tr><th>ID</th><th>标题</th><th>状态</th></tr></thead><tbody>${r.result.data.items.map(c=>`<tr class="${c.content_id==='ct_000004'&&state.selected?'selected':''}"><td>${c.content_id==='ct_000004'?`<button class="select-content" data-select-content="ct_000004">${c.content_id}<small>${state.selected?'已选择':'选择并查看'}</small></button>`:esc(c.content_id)}</td><td>${esc(c.title)}</td><td>${esc(c.review_status)}</td></tr>`).join('')}</tbody></table></div>`;
      right=`<aside class="panel"><h2>先定位，再作决定。</h2><p class="muted">本页回放任务二实际选中的内容，不按标题猜测目标，也不自动判断通过或驳回。</p><p class="mono">ct_000004</p><p class="content-title">${esc(before.title)}</p><p class="state-label">pending</p>${tags(before.tags)}<p>初始历史 0 条</p></aside>`;
    }else if(state.step===1){
      body=`<p>已读取正文、状态和原标签；历史查询为空，不能单靠空历史推断任意 ID 存在。</p><section class="history-card"><h3>操作前审核历史 · 0 条</h3><p class="muted">人工提供本地演示决定。题目没有完整审核标准，不据样例正文自动认定内容合规。</p><details><summary>查看历史查询命令与完整 JSON</summary>${commandBox(task('07-candidate-ct000004-history').command)}${rawDetails(task('07-candidate-ct000004-history'))}</details></section>`;
    }else if(state.step===2){
      body=`<p class="preview-message">预览成功，<strong>未提交任何写入</strong>。</p><p>审核动作 approve，目标 pending → approved；保留恋爱、校园、武侠，新增“悬疑”。</p>${sources([['evidence/task2/preview/zero-write-validation.json','预览零写入验证']])}`;
      right=planPanel();
    }else if(state.step===3){
      body=`<p class="execution-permission">实际命令增加 <code>--execute --yes</code> 才获执行授权。</p><p class="muted">以下为任务二已保存的唯一组合写入记录，不会再次提交。审核先确认并核对，才更新标签。</p><button class="primary" data-show-execution aria-expanded="${state.executionShown}">${state.executionShown?'收起已记录的执行结果':'查看已记录的执行结果'}</button>`;
      showResult=state.executionShown;
      right=`<aside class="panel"><h2>两个步骤，分别确认。</h2><ol class="execution-order"><li>提交单条审核</li><li>检查计数，回读审核状态</li><li>提交完整标签数组</li><li>回读并核对标签</li></ol><p class="muted">审核和标签没有联合事务，不自动回滚，也不自动重试。</p></aside>`;
    }else{body=comparison();right=contentPanel();}
    return `<section id="walkthrough" aria-label="任务二五步演示"><div class="step-rail" role="group" aria-label="任务二步骤">${stepTitles.map((t,i)=>`<button class="step" data-step="${i}" aria-pressed="${state.step===i}"><span class="num">${i+1}</span><strong>${t}</strong></button>`).join('')}</div><div class="two-col"><section class="panel workflow-primary"><h2>${['查询一批待审核内容','查看详情与审核历史','默认预览，不提交写入。','确认执行 · 历史结果回放','重新查询，核对实际结果'][state.step]}</h2>${commandBox(r.command)}${body}${showResult?resultView(r,state.step===2?'mode=preview / status=previewed / exit_code=0，只证明计划已生成。':''):''}</section>${right}</div><div class="step-actions"><button data-move="-1" ${state.step===0?'disabled':''}>上一步</button><span class="muted">${state.step+1} / 5 · 只切换记录</span><button class="primary" data-move="1" ${state.step===4?'disabled':''}>${state.step===4?'已到结果核验':'下一步：'+stepTitles[state.step+1]}</button></div></section>`;
  }
  function outcomeSection(){
    const options={
      normal:['正常成功','succeeded / 0',task('13-process-execute'),'任务二 · Mock 正常实测 / 新增“悬疑”','审核与标签均 acknowledged / matched，再由新 JVM 验证。无需重新执行。'],
      partial:['审核成功，标签失败','partial / 4',D.faults['tags-reject-before-write'].process,'S5 · 受控 Mock 故障 / 独立副本新增“轻松”','审核已成功，保留已完成步骤；核查后只用独立标签命令补齐，不重做 process。'],
      unknown:['写入响应丢失','unknown / 5',D.faults['tags-commit-response-lost'].process,'S5 · 受控 Mock 故障 / 独立副本新增“轻松”','本次未获得可信确认。后续读到目标状态也不改报成功；暂停核查，不自动重放审核或随意回滚。']
    };
    const selected=options[state.outcome];
    return `<section class="outcomes" aria-label="代表性执行结果"><h2>如果执行过程中出现异常怎么办？</h2><p class="muted">审核与标签是两个独立步骤；已完成步骤不能随意回滚或重复执行。</p><div class="outcome-options" role="group" aria-label="代表性结果">${Object.entries(options).map(([k,[label,status]])=>`<button data-outcome="${k}" aria-pressed="${state.outcome===k}"><strong>${label}</strong><span class="mono">${status}</span></button>`).join('')}</div><div class="outcome-view"><p class="source-label">${selected[3]}</p><p class="recommendation">${selected[4]}</p>${resultView(selected[2])}${state.outcome==='partial'?'<button data-show-recovery>查看独立补标签记录</button>':''}</div><details id="all-faults"${openAttrs('all-faults')}><summary>查看全部故障和技术证据 · 保留五种 S5 场景</summary>${auxiliary(faultsPage())}</details></section>`;
  }
  function demoPage(){
    return header('走完一次内容审核。','沿着五步流程查看命令、操作计划与实际结果。浏览器只回放，Java CLI 才执行操作。')+
      sourcebar('','任务二 · Mock 实测回放 / 新增“悬疑”','evidence/task2/README.md')+
      walkthrough()+`<details class="command-reference" id="command-reference"${openAttrs('command-reference')}><summary>命令参考 · 七条现有命令</summary>${auxiliary(commandPage())}</details>`+
      outcomeSection()+`<div class="page-actions"><a class="link-button" href="#technical">继续：技术方案与演进 →</a>${link('docs/06-实际操作记录.md','完整操作记录')}</div>`;
  }
  function technicalPage(){
    const choices=[
      ['为什么固定单条审核','items 固定 1 项','上游批量仅返回计数，单条更易判定；不消除重复日志或并发风险。'],
      ['为什么默认预览','先计划，显式授权后执行','降低误写；独立预览尚未强绑定后续执行计划。'],
      ['为什么审核后回读','确认并匹配，才修改标签','写入响应不代表业务状态已核对；回读也不能证明未知调用成功。'],
      ['为什么不自动重试','unknown 停止并核查','无服务端幂等保证；重复审核会追加日志。'],
      ['全量 PUT 的覆盖风险','读原标签、保留无关项后提交','读写之间仍有竞争窗口；需要上游版本条件，文件锁不能替代。']
    ];
    const c=capabilityContent[state.capability];
    return header('用简单分层，守住执行边界。','当前实现单条 Mock 闭环；HTTP 与 Agent 批次执行仍需后续适配和验证。')+`
      <section class="panel architecture"><h2>Java 系统架构</h2><div class="architecture-flow"><div><strong>CLI</strong><span>Picocli · 参数 / 授权 / 输出</span></div><b>→</b><div><strong>Application Service</strong><span>ContentService 编排<br>TagPlanner 计算标签</span></div><b>→</b><div><strong>ContentGateway</strong><span>统一六项 API 能力</span></div><b>→</b><div class="adapters"><div><strong>Mock · 已实现</strong><span>只读 seed / 独立工作副本</span></div><div class="future-adapter"><strong>HTTP · 尚未实现</strong><span>未来适配，不是已部署组件</span></div></div></div><p class="muted">Java + Maven + Picocli + Jackson。无 Spring Boot、数据库、消息队列或跨接口事务。</p><details id="technical-details"${openAttrs('technical-details')}><summary>查看 Gateway、存储与异常测试细节</summary><p>JsonMockGateway 使用 JsonStateStore，每次读取工作快照，sidecar 锁、临时文件与原子替换保护本地文件；保留 seed 原始字段和异常，不把损坏状态静默重置。</p><p>这些机制不让审核与标签原子提交，也不提供服务端幂等。partial、unknown、verification_failed 的完整步骤和计数可在核心演示的故障证据中展开。</p>${sources([['docs/03-Java技术架构与实施方案.md','完整 Java 架构'],['evidence/s5/README.md','S5 跨进程故障验证']])}</details></section>
      <section class="technical-choices"><h2>关键技术取舍</h2><div class="table-scroll"><table><thead><tr><th>设计问题</th><th>当前选择</th><th>原因与限制</th></tr></thead><tbody>${choices.map(row=>`<tr>${row.map(x=>`<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>
      <section class="panel agent-design"><div class="panel-head"><h2>未来 Agent · 一次约 100 条</h2><span class="future-label">仅设计 / 未执行</span></div><div class="flow"><span>冻结目标 ID</span><b>→</b><span>生成计划</span><b>→</b><span>人工审批</span><b>→</b><span>可信执行器</span><b>→</b><span>单条 CLI</span><b>→</b><span>批次账本</span><b>→</b><span>核查与恢复</span></div><p>不能边审核 pending 边翻页：队列收缩可能跳过目标。先冻结 ID，再逐条执行；unknown 不自动重放。</p><div class="segmented" role="group" aria-label="Agent 能力边界">${[['current','当前已实现'],['future','未来需新增'],['upstream','需上游配合']].map(([k,l])=>`<button data-capability="${k}" aria-pressed="${state.capability===k}">${l}</button>`).join('')}</div><h3 id="capability-title">${c.title}</h3><ul class="future-list">${c.items.map(x=>`<li>${esc(x)}</li>`).join('')}</ul><p class="muted">审批计划绑定、写前持久化意图与批次账本需要新增；服务端幂等、标签版本和稳定分页需上游协作。当前没有 batch/resume 命令或 100 条执行器。</p></section>
      <div class="page-actions">${link('docs/03-Java技术架构与实施方案.md','完整技术方案')}${link('docs/07-Agent批量处理方案.md','完整 Agent 演进方案')}</div>`;
  }
  function toast(text){const el=document.querySelector('#toast');el.textContent=text;el.classList.add('visible');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('visible'),4500);}
  async function copy(text,button){
    try{if(!navigator.clipboard?.writeText)throw Error('Clipboard API unavailable');await navigator.clipboard.writeText(text);toast('命令已复制；页面没有执行。');return;}catch{/* Local-file or denied permission: use selection fallback. */}
    const area=document.createElement('textarea');area.value=text;area.className='manual-copy';area.setAttribute('aria-label','手动复制命令');area.setAttribute('readonly','');
    button.closest('.panel-head').after(area);area.focus();area.select();
    let copied=false;try{copied=document.execCommand('copy');}catch{/* Leave a selectable, visible fallback. */}
    if(copied){area.remove();button.focus();toast('命令已复制（兼容模式）；页面没有执行。');}
    else{toast('浏览器未允许剪贴板，请在已选文本中按 Ctrl+C。');area.addEventListener('blur',()=>area.remove(),{once:true});}
  }

  function rememberExpanded(){
    main.querySelectorAll('details[id]').forEach(el=>{
      if(el.open)state.open.add(el.id);else state.open.delete(el.id);
    });
  }
  function render(){
    rememberExpanded();
    main.innerHTML=({product:productPage,demo:demoPage,technical:technicalPage})[state.route]();
    document.querySelectorAll('nav a').forEach(a=>{
      if(a.hash==='#'+state.route)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');
    });
  }
  function redrawKeepingFocus(selector){render();main.querySelector(selector)?.focus({preventScroll:true});}
  function changeStep(index){
    state.step=Math.max(0,Math.min(4,index));
    if(state.step>0)state.selected=true;
    redrawKeepingFocus('[data-step="'+state.step+'"]');
    main.querySelector('#walkthrough').scrollIntoView({block:'start'});
  }
  function route(){
    const key=location.hash.slice(1);
    if(key==='workspace'){
      if(!main.childElementCount)render();
      main.focus();return;
    }
    const aliases={overview:'product',commands:'demo',task2:'demo',faults:'demo',agent:'technical'};
    state.route=['product','demo','technical'].includes(key)?key:(aliases[key]||'product');
    render();
    if(key==='commands'){main.querySelector('#command-reference').open=true;}
    if(key==='faults'){main.querySelector('#all-faults').open=true;}
    main.focus({preventScroll:true});window.scrollTo(0,0);
  }
  main.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button||button.disabled)return;
    if(button.hasAttribute('data-copy')){copy(button.dataset.copy,button);return;}
    if(button.hasAttribute('data-step')){changeStep(Number(button.dataset.step));return;}
    if(button.hasAttribute('data-move')){changeStep(state.step+Number(button.dataset.move));return;}
    if(button.hasAttribute('data-select-content')){state.selected=true;changeStep(1);return;}
    if(button.hasAttribute('data-show-execution')){state.executionShown=!state.executionShown;redrawKeepingFocus('[data-show-execution]');return;}
    if(button.hasAttribute('data-show-recovery')){
      state.fault='tags-reject-before-write';state.recovery=true;
      render();main.querySelector('#all-faults').open=true;
      main.querySelector('[data-recovery="true"]').focus();return;
    }
    const updates=[['snapshot','snapshot'],['command','command'],['recovery','recovery'],['capability','capability'],['outcome','outcome']];
    for(const [attribute,key]of updates){
      if(!button.hasAttribute('data-'+attribute))continue;
      const value=button.dataset[attribute];
      state[key]=key==='command'?Number(value):key==='recovery'?value==='true':value;
      redrawKeepingFocus('[data-'+attribute+'="'+value+'"]');return;
    }
  });
  main.addEventListener('change',event=>{
    if(event.target.id==='fault-select'){
      state.fault=event.target.value;state.recovery=false;redrawKeepingFocus('#fault-select');
    }
  });
  window.addEventListener('hashchange',route);
  route();
})();
