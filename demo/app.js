"use strict";
(() => {
  const D = window.DEMO_DATA;
  const main = document.querySelector('main');
  const state = {route:'task2', step:2, snapshot:'before', command:0,
    fault:'tags-reject-before-write', recovery:false, capability:'current'};
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
  const inspector = () => {
    const c = state.snapshot==='before'?before:after;
    const history = state.snapshot==='before'?task('07-candidate-ct000004-history'):task('15-after-history');
    return `<aside class="panel inspector"><h2>ct_000004</h2><p class="content-title">${esc(c.title)}</p><p class="field-label">当前展示的快照：${state.snapshot==='before'?'操作前':'最终执行后'}（非实时状态）</p><div class="segmented" role="group" aria-label="内容快照"><button data-snapshot="before" aria-pressed="${state.snapshot==='before'}">操作前</button><button data-snapshot="after" aria-pressed="${state.snapshot==='after'}">操作后</button></div><span class="state-label ${c.review_status}">${esc(c.review_status)}</span><div class="field"><span class="field-label">内容标签 · ${c.tags.length} 个</span>${tags(c.tags,['悬疑'])}</div><div class="field"><span class="field-label">正文</span><p class="body-text">${esc(c.body)}</p></div><div class="field"><span class="field-label">审核记录</span><p><strong>${history.result.data.items.length}</strong> 条 · ${state.snapshot==='before'?'尚无审核历史':'approve / op_mock_cli'}</p></div><details><summary>查看完整详情字段</summary>${fields(c)}</details>${sources([[state.snapshot==='before'?task('05-candidate-ct000004-detail').source+'.stdout.txt':task('14-after-detail').source+'.stdout.txt','此快照的来源'],[history.source+'.stdout.txt','此快照的历史']])}</aside>`;
  };
  function overview() {
    return header('让单条运营操作可检查、可复用。','把现有后台能力变为明确的命令。以审核与标签维护闭环为先，服务运营人员，并为脚本提供稳定的 JSON 和退出码。')+
      sourcebar('','已实现 · Java CLI / 本地 Mock 原型','README.md','运行说明')+
      `<div class="overview-grid"><section class="overview-block"><h2>两种时间约束</h2><p>业务研发：<strong>1 名 Java 后端 / 10 个工作日</strong>。本次试炼：<strong>48 小时交付切片</strong>。二者不能等同。</p><p class="muted">当前交付已验证单条 Mock 闭环；两周范围还需补齐 HTTP、标签 remove/set、人工交互确认与完整筛选等。</p><a class="link-button" href="#task2">查看一次完整处理回放</a></section><section class="overview-block"><h2>谁来使用</h2><table><thead><tr><th>使用者</th><th>当前与边界</th></tr></thead><tbody><tr><td>运营人员</td><td>查看详情、给出审核决定，先预览再显式授权。</td></tr><tr><td>脚本</td><td>固定 ID、非交互、JSON 与退出码；不得盲目重试写入。</td></tr><tr><td>未来 Agent</td><td>复用单条协议；100 条执行器、审批和账本尚未实现。</td></tr></tbody></table></section></div>
      <section class="panel"><h2>七个命令入口，六项 API 能力</h2><div class="flow"><span>CLI · 参数 / 授权 / 输出</span><b>→</b><span>Application Service · 计划 / 校验 / 编排</span><b>→</b><span>ContentGateway</span><b>→</b><span>本地 JSON Mock</span></div><p class="muted">查询列表、详情、历史、标签库，加上单条审核和标签新增。process 复用审核与标签两个独立提交；真实 HTTP 适配尚未实现，<code>--env api</code> 明确拒绝。</p><div class="note">页面只回放已有记录。审核动作来自人工提供的本地演示决定，不代表真实业务合规结论；点击不会启动 CLI 或修改 Mock 工作副本。</div></section>
      <div class="overview-grid"><section class="overview-block"><h2>写入前的约束</h2><ul><li>默认 preview，不写入；执行需要 <code>--execute --yes</code> 同时出现。</li><li>仅审核 pending；reject 理由非空。新增标签必须存在且 active。</li><li>保留无关标签后提交完整数组；P0 不清空全部标签。</li></ul></section><section class="overview-block"><h2>执行后的可信度</h2><ul><li>先审核、回读匹配，再更新标签并回读。</li><li>partial / unknown / verification_failed 分别保留，不自动回滚或重试。</li><li>快照 revision 和文件锁不等于跨 API 事务、服务端幂等或真实权限。</li></ul></section></div>`+
      sources([['docs/02-第一阶段MVP与CLI产品方案.md','产品合同'],['docs/03-Java技术架构与实施方案.md','Java 实施方案'],['docs/04-交付物规划与验收清单.md','交付清单']]);
  }
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
      `<div class="command-layout"><div class="command-menu" role="group" aria-label="选择命令">${commands.map((c,i)=>`<button data-command="${i}" aria-pressed="${state.command===i}">${esc(c.name)}</button>`).join('')}</div><section class="panel"><h2 class="mono">${esc(c.name)}</h2><p class="command-description">${esc(c.description)}</p><p><strong>参数：</strong>${esc(c.params)}</p><p class="api">${esc(c.api)}</p>${commandBox(r?r.command:c.template)}${r?`<p class="muted">任务二实测记录：${esc(r.result.mode)} / ${esc(r.result.status)}。这是历史快照，非本页执行。</p>${readSummary}${resultView(r)}`:`<div class="note info">上方为当前有效的预览调用模板，本页没有执行此命令。返回采用统一信封，data 中包含 plan、steps、observed；review 含 review 步骤，tags update 含 tags 步骤。授权执行且步骤为 acknowledged / matched 才确认写入完成。</div>${shape}<p class="muted">可在任务二查看组合命令真实结果；在“异常结果”查看独立标签修复的真实 stdout。这里不编造独立预览结果。</p>`}<div class="note">公共参数：<code>--env mock|api</code>、<code>--output table|json</code>、<code>--non-interactive</code>、<code>--help</code>。api 尚未实现且返回 rejected/2。写命令默认预览；execute 和 yes 缺一即拒绝。本原型不读取 stdin。</div></section></div>`;
  }
  const stepTitles=['查询队列','查看详情','预览计划','确认执行','回读验证'];
  function taskPage() {
    let r, content='';
    if(state.step===0){
      r=task('03-pending-page1-json');
      content=`<p class="explain">初始快照共 ${r.result.data.total} 条 pending；page 1 返回 ${r.result.data.items.length} 条。实际第二行是 ct_000004，先查看再由人工选择。</p><div class="table-scroll"><table class="queue-table"><thead><tr><th>ID</th><th>标题</th><th>审核状态</th></tr></thead><tbody>${r.result.data.items.map(c=>`<tr class="${c.content_id==='ct_000004'?'selected':''}"><td class="mono">${esc(c.content_id)}</td><td>${esc(c.title)}</td><td>${esc(c.review_status)}</td></tr>`).join('')}</tbody></table></div>`;
    } else if(state.step===1){
      r=task('05-candidate-ct000004-detail');
      content=`<p class="explain">详情确认 pending，历史查询返回 0 条，标签库包含 active“悬疑”。人工只为演示提供决定；CLI 不做自动合规判断。</p><p class="body-text">${esc(before.body)}</p>${tags(before.tags)}${sources([[task('07-candidate-ct000004-history').source+'.stdout.txt','操作前历史（0 条）'],[task('08-active-tags').source+'.stdout.txt','active 标签库（23 个）']])}`;
    } else if(state.step===2){
      r=task('10-process-preview');
      content=`<p class="explain">review：pending → approve；保留恋爱、校园、武侠，新增“悬疑”。此步骤只输出计划，两步均未发送。</p><div class="note info">默认预览不写入。实际零写入验证已保存，预览前后业务快照与审核历史未变。</div>${sources([['evidence/task2/preview/zero-write-validation.json','零写入验证']])}`;
    } else if(state.step===3){
      r=task('13-process-execute');
      content=`<p class="explain">这是既有的唯一组合写入记录。明确授权后，审核收到 1 成功 / 0 失败并回读匹配，才提交完整标签数组并核对。</p><div class="note">两个独立提交，没有联合事务。这里的“确认执行”是历史步骤名称；页面没有执行按钮，也不会再次审核。</div>`;
    } else {
      r=task('14-after-detail');
      content=`<p class="explain">独立的新 JVM 从持久化工作副本回读：approved，原有三标签保留并新增“悬疑”；历史 1 条，pending 总数 131，revision ${D.taskFacts.revision}。</p>${tags(after.tags,['悬疑'])}${sources([[task('15-after-history').source+'.stdout.txt','操作后历史（1 条）'],[task('16-after-pending-exact').source+'.stdout.txt','精确 pending 查询（0 条）'],[task('17-after-pending-total').source+'.stdout.txt','待审核总数（131 条）'],['evidence/task2/after/snapshot-facts.json','快照 revision / SHA']])}`;
    }
    return header('一次审核，看清每一步。','在步骤间切换，核查从选择内容到持久化验证的完整链路。所有结果来自已保存的 Java CLI 实测。')+
      sourcebar('','任务二 · Mock 实测记录 / 新增“悬疑”','evidence/task2/README.md')+
      `<div class="step-rail" role="group" aria-label="任务二步骤">${stepTitles.map((t,i)=>`<button class="step" data-step="${i}" aria-pressed="${state.step===i}"><span class="num">${i+1}</span><span><strong>${t}</strong><small>${['定位待处理内容','核对内容与历史','生成待执行变更','检查正式执行','核验写入结果'][i]}</small></span></button>`).join('')}</div><div class="two-col"><section class="panel">${commandBox(r.command)}<h3>${stepTitles[state.step]} · 证据回放</h3>${content}${resultView(r,state.step===2?'previewed / exit 0 仅说明计划已生成，不代表完成审核。':'')}</section>${inspector()}</div><div class="metrics" aria-label="最终执行后的实测变化"><div class="metric"><small>待审核队列 / pending</small><strong>132 → 131</strong></div><div class="metric"><small>内容标签 / tags</small><strong>3 → 4</strong></div><div class="metric"><small>审核历史 / history</small><strong>0 → 1</strong></div></div><p class="metrics-caption">以上为最终执行后的实测变化；切换预览步骤不会产生这些变化。操作前后切换只读取本页内嵌快照。</p>`+
      sources([['docs/06-实际操作记录.md','操作记录与选择理由'],['evidence/task2/validation/result.json','跨 JVM / 全量差异验证']]);
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
  function agentPage(){
    const c=capabilityContent[state.capability];
    return header('当调用方变成 Agent。','从单条 CLI 扩展到约 100 条、低频、单机处理。这里展示方案，不运行批次，也不自动作出审核判断。')+
      sourcebar('future','未来设计 · 未实现 / 未执行 100 条','docs/07-Agent批量处理方案.md','阅读完整方案')+
      `<section class="panel"><h2>近期推荐：轻量执行器 + 独立账本</h2><div class="flow" aria-label="未来批次流程"><span>冻结 ID</span><b>→</b><span>逐项计划</span><b>→</b><span>人工审批</span><b>→</b><span>可信执行器</span><b>→</b><span>单条 CLI</span><b>→</b><span>持久化账本</span><b>→</b><span>核查 / 恢复</span></div><p class="muted">先串行复用已验证的单条协议，再按实际需求增加细步骤检查点。裸循环与无条件重试无法解决部分失败、输出丢失或进程中断。</p><div class="segmented" role="group" aria-label="能力边界">${[['current','现有能力'],['future','未来新增'],['upstream','上游限制']].map(([k,l])=>`<button data-capability="${k}" aria-pressed="${state.capability===k}">${l}</button>`).join('')}</div><h3 id="capability-title">${c.title}</h3><ul class="future-list">${c.items.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></section><div class="note">当前没有 batch、resume、计划摘要参数、审批系统或任务调度；真实 HTTP 也尚未实现。页面流程只是 docs/07 的可视化摘录，没有预设“100 条已成功”的统计。</div><div class="table-scroll"><table class="cap-table"><thead><tr><th>已有能力</th><th>未来需要补充</th><th>现有 API 无法单方保证</th></tr></thead><tbody><tr><td>单条 JSON / 退出码 / 步骤</td><td>逐项持久化、审批计划绑定</td><td>跨接口原子提交</td></tr><tr><td>pending 校验 / 执行前重读</td><td>固定 ID、变化阻断、限速</td><td>强幂等、并发条件更新</td></tr><tr><td>独立标签恢复</td><td>未知核查队列、恢复审批</td><td>请求与真实人员审计关联</td></tr></tbody></table></div>`;
  }
  function render(){
    main.innerHTML=({overview,commands:commandPage,task2:taskPage,faults:faultsPage,agent:agentPage})[state.route]();
    document.querySelectorAll('nav a').forEach(a=>{
      if(a.hash==='#'+state.route)a.setAttribute('aria-current','page'); else a.removeAttribute('aria-current');
    });
  }
  function redrawKeepingFocus(selector){render(); if(selector)main.querySelector(selector)?.focus({preventScroll:true});}
  function route(){const key=location.hash.slice(1);state.route=['overview','commands','task2','faults','agent'].includes(key)?key:'task2';render();}
  function toast(text){const el=document.querySelector('#toast');el.textContent=text;el.classList.add('visible');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('visible'),4500);}
  async function copy(text,button){
    try{if(!navigator.clipboard?.writeText)throw Error('Clipboard API unavailable');await navigator.clipboard.writeText(text);toast('命令已复制；页面没有执行。');return;}catch{/* Local-file or denied permission: use selection fallback. */}
    const area=document.createElement('textarea');area.value=text;area.className='manual-copy';area.setAttribute('aria-label','手动复制命令');area.setAttribute('readonly','');
    button.closest('.panel-head').after(area);area.focus();area.select();
    let copied=false;try{copied=document.execCommand('copy');}catch{/* Leave a selectable, visible fallback. */}
    if(copied){area.remove();button.focus();toast('命令已复制（兼容模式）；页面没有执行。');}
    else{toast('浏览器未允许剪贴板，请在已选文本中按 Ctrl+C。');area.addEventListener('blur',()=>area.remove(),{once:true});}
  }
  main.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.hasAttribute('data-copy')){copy(button.dataset.copy,button);return;}
    if(button.hasAttribute('data-step')){state.step=Number(button.dataset.step);redrawKeepingFocus(`[data-step="${state.step}"]`);}
    if(button.hasAttribute('data-snapshot')){state.snapshot=button.dataset.snapshot;redrawKeepingFocus(`[data-snapshot="${state.snapshot}"]`);}
    if(button.hasAttribute('data-command')){state.command=Number(button.dataset.command);redrawKeepingFocus(`[data-command="${state.command}"]`);}
    if(button.hasAttribute('data-recovery')){state.recovery=button.dataset.recovery==='true';redrawKeepingFocus(`[data-recovery="${state.recovery}"]`);}
    if(button.hasAttribute('data-capability')){state.capability=button.dataset.capability;redrawKeepingFocus(`[data-capability="${state.capability}"]`);}
  });
  main.addEventListener('change',event=>{if(event.target.id==='fault-select'){state.fault=event.target.value;state.recovery=false;redrawKeepingFocus('#fault-select');}});
  window.addEventListener('hashchange',route);
  route();
})();
