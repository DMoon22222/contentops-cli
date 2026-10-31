"use strict";
(() => {
  const D = window.DEMO_DATA;
  const main = document.querySelector('main');
  const state = {route:'product', command:0, exampleMode:'preview', outcome:'normal',
    fault:'tags-reject-before-write', recovery:false, open:new Set()};
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const task = key => D.task[key];
  const before = task('05-candidate-ct000004-detail').result.data;
  const after = task('14-after-detail').result.data;
  const link = (path, label, raw=false) => {
    const reading = raw ? null : window.REVIEW_DOCUMENTS[path];
    return `<a href="${esc(reading?'docs/'+reading:'../'+path)}">${esc(path.endsWith('.md')&&!reading?'原始 Markdown 文件 · '+label:label)} ↗</a>`;
  };
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
    return header('故障记录','选择一份受控故障记录，查看当次输出与事后查询。')+
      sourcebar('fault','S5 · 受控故障记录','evidence/s5/README.md')+
      `<p class="explain">${esc(recordedEnvironment)}每个场景使用独立工作副本，核查时关闭故障。复现方法见 README。</p>`+
      `<div class="fault-controls"><label for="fault-select">选择记录</label><select id="fault-select">${Object.entries(faultMeta).map(([k,[title]])=>`<option value="${k}" ${state.fault===k?'selected':''}>${esc(title)}</option>`).join('')}</select></div>${state.fault==='tags-reject-before-write'?`<div class="segmented" role="group" aria-label="部分失败与独立修复"><button data-recovery="false" aria-pressed="${!state.recovery}">查看部分失败</button><button data-recovery="true" aria-pressed="${state.recovery}">查看独立补标签回放</button></div>`:''}
      <div class="two-col"><section class="panel"><h2>${state.recovery?'独立补标签 · 已有恢复记录':esc(faultMeta[state.fault][0])}</h2><p class="mono muted">${esc(state.fault)}</p>${commandBox(r.command)}${state.recovery?'<div class="note info">原 partial/4 记录保持不变。清除故障后，独立 tags update 返回 succeeded/0；历史仍只有 1 条，没有再次审核。</div>':`<div class="note">${esc(faultMeta[state.fault][1])}</div>`}${resultView(r)}${!state.recovery?`<details><summary>查看本次 JVM 的实际调用计数</summary><div class="terminal"><pre>${esc(JSON.stringify(f.facts.calls,null,2))}</pre></div></details>`:''}</section><aside class="panel inspector"><h2>调用观测 ≠ 磁盘事实</h2><div class="field-label">调用结束时最后一次成功读取</div><p class="state-label ${observed.review_status}">${esc(observed.review_status)}</p>${tags(observed.tags,['轻松'])}<div class="field"><span class="field-label">关闭故障后，新 JVM 普通查询</span><p class="state-label ${disk.review_status}">${esc(disk.review_status)}</p>${tags(disk.tags,['轻松'])}<p class="muted">历史 ${h.result.data.items.length} 条 · ${state.recovery?'revision 2':'revision '+f.facts.disk_revision_after_process}</p></div><div class="note info">磁盘事实是后续独立核查结果，不补写到原调用的 observed，也不改变其 status。</div>${sources([[f.query.source+'.stdout.txt','故障关闭后的查询'],[h.source+'.stdout.txt','对应历史记录'],['evidence/s5/scenarios/'+state.fault+'/result.json','磁盘 / 计数验证']])}${state.recovery?sources([[f.recoveredQuery.source+'.stdout.txt','独立修复后查询']]):''}<details><summary>查看当前磁盘核查 JSON</summary><div class="terminal"><pre class="json-view">${esc(JSON.stringify((state.recovery?f.recoveredQuery:f.query).result,null,2))}</pre></div></details></aside></div><p class="metrics-caption">每个 S5 场景使用独立初始副本，目标标签为“轻松”；任务二新增“悬疑”，两组操作不能合并成同一次记录。这些故障没有连接真实 HTTP。</p>`;
  }
  const openAttrs=id=>state.open.has(id)?' open':'';
  const auxiliary=html=>html.replaceAll('<h1>','<h3>').replaceAll('</h1>','</h3>');
  const commandInfo=[
    ['查询内容列表','找出待审核内容','按状态和内容 ID 筛选，找到需要处理的内容。','每页 20 条，用 --page 翻页。多个条件要同时满足。'],
    ['查看内容详情','阅读指定内容','读取指定内容的正文、审核状态和标签。','修改后也用这条命令重新查询。'],
    ['查询审核历史','检查之前的操作','查看这条内容之前的审核操作。','记录按时间从新到旧显示。'],
    ['查询标签库','查看可用标签','列出当前可新增的标签。','默认只显示在用标签；--status all 查看全部。'],
    ['审核单条内容','审核通过或驳回','通过或驳回一条待审核内容，审核决定由人工提供。','--action reject 表示驳回，必须同时填写 --reason。'],
    ['修改内容标签','新增“悬疑”标签','为内容新增标签，保留已有标签。','--add 可以重复填写。当前原型只支持新增。'],
    ['审核并更新标签','通过并新增标签','一条命令完成审核与标签新增。','先核对审核结果，再改标签；两项分别提交。']
  ];
  function productPage(){
    return header('内容运营后台 CLI 工具','将内容查询、审核和标签维护封装为统一命令，供运营人员使用，也便于脚本和未来 Agent 复用。')+`
      <section class="product-capabilities" aria-label="已实现的三项核心能力">
        <article><span class="capability-number">01</span><h2>内容查询</h2><p>查询内容列表，查看完整详情和审核历史。</p></article>
        <article><span class="capability-number">02</span><h2>内容审核</h2><p>通过或驳回指定内容，先预览、明确授权，再核对结果。</p></article>
        <article><span class="capability-number">03</span><h2>标签维护</h2><p>查询可用标签，为内容新增标签，保留原有标签。</p></article>
      </section>
      <section class="implemented-features"><h2>现在可以怎样用</h2><ul><li><strong>4 条查询命令</strong>：列表、详情、审核历史、标签库。</li><li><strong>3 条写命令</strong>：单条审核、标签新增、审核与标签组合处理。</li><li>默认预览、显式执行；结构化 JSON、退出码和结果核对。</li><li>Java CLI 已在独立 Mock 副本完成审核与标签更新的实际验证。</li></ul><p class="environment-pair">Java CLI 读写本地 Mock；网页 Playground 只模拟命令，不运行 Java、不连接真实后台。</p></section>
      <section class="product-example" aria-label="审核与标签维护案例"><div><h2>审核一条内容，并新增标签</h2><p><code>${esc(before.content_id)}</code> · ${esc(before.title)}</p><div class="example-change"><span>待审核 → 审核通过</span><span>原标签 ${before.tags.map(esc).join('、')}<b>＋${esc(after.tags.find(t=>!before.tags.includes(t)))}</b></span></div><p class="example-origin">来自任务二已保存的 Java Mock 实测；审核决定用于流程演示。</p></div><div class="example-actions"><a class="link-button" href="#demo">打开 CLI 交互体验 →</a>${link('docs/06-实际操作记录.md','阅读实际操作记录')}</div></section>
      <section class="product-progress"><h2>当前完成度与后续范围</h2><dl>
        <div><dt>已完成的 48 小时原型</dt><dd>查询、单条审核、标签新增、组合命令、Mock 跨进程持久化、故障验证和 HTML 演示。</dd></div>
        <div><dt>完整两周 MVP 尚需补充</dt><dd>真实 HTTP Gateway、标签移除/替换、人工交互确认、keyword/tag 等 P0 筛选及完整 P0 验收；真实联调需可用环境。</dd></div>
        <div><dt>未来 Agent 扩展</dt><dd>批次计划、人工审批绑定、任务账本与中断恢复。已有设计，尚未实现 100 条执行器。</dd></div>
      </dl></section>
      <section class="compact-plan"><h2>2 周 MVP · 10 个工作日</h2><p class="muted">1 名 Java 后端，第一阶段只覆盖 6 项 API。以下沿用已确认的十日计划，Mock 与基础测试随开发进行。</p><div class="timeline">${[['D1–2','需求确认与四项查询'],['D3–4','单条审核与标签增删/替换'],['D5–6','确认、核对与组合操作'],['D7–8','完善 Mock 故障与回归'],['D9–10','HTML、文档与验收；半日缓冲']].map(([d,t])=>`<div><strong>${d}</strong><span>${t}</span></div>`).join('')}</div>${sources([['docs/02-第一阶段MVP与CLI产品方案.md','阅读完整产品方案'],['README.md','构建与运行说明']])}</section>
      <details id="product-notes"${openAttrs('product-notes')}><summary>范围与验收说明</summary><div class="reading-note"><h3>为什么保留独立命令和组合命令</h3><p>日常处理用 process；若审核完成但标签失败，独立补标签，避免再次审核。两项是独立提交，不提供联合事务。</p><h3>怎样判断执行结果可信</h3><p>实际状态、逐步骤核对、JSON 与进程退出码一致；未知结果先停下核查，不自动重试。浏览器模拟不能代替 JAR 验收。</p></div></details>`;
  }
  function selectedExample(){
    const c=commands[state.command];
    if(state.command===6)return task(state.exampleMode==='execute'?'13-process-execute':'10-process-preview').command;
    const base=c.record?task(c.record).command:c.template;
    return state.command>=4&&state.exampleMode==='execute'?base+' --execute --yes':base;
  }
  function commandExamples(){
    const c=commands[state.command], info=commandInfo[state.command], write=state.command>=4;
    const record=state.command===6?task(state.exampleMode==='execute'?'13-process-execute':'10-process-preview'):c.record?task(c.record):null;
    return `<section class="command-browser" aria-label="七条命令"><div class="feature-menu" role="group" aria-label="选择功能">${commands.map((c,i)=>`<button data-command="${i}" aria-pressed="${state.command===i}"><code>${esc(c.name)}</code><span>${commandInfo[i][0]}</span></button>`).join('')}</div><article class="example-panel"><h2>${info[1]}</h2><p>${info[2]}</p>${write?`<div class="segmented" role="group" aria-label="写命令示例"><button data-example-mode="preview" aria-pressed="${state.exampleMode==='preview'}">预览示例</button><button data-example-mode="execute" aria-pressed="${state.exampleMode==='execute'}">执行示例</button></div>`:''}${commandBox(selectedExample(),'使用示例')}<p class="usage">${info[3]}</p>${write?`<p class="mode-note">${state.exampleMode==='preview'?'默认只生成预览，不修改数据。':'执行示例增加 --execute --yes，需在终端明确授权后运行。'}</p>`:''}${!c.record?'<p class="example-label">命令示例 · 未作为任务二的独立操作执行</p>':''}<details id="command-detail"${openAttrs('command-detail')}><summary>返回结果与对应接口</summary><p class="api">${esc(c.api)}</p><p class="muted">参数：${esc(c.params)}</p>${record?`<p class="record-origin">任务二已保存的${write?(state.exampleMode==='preview'?'预览':'执行'):'操作前查询'}记录。</p>${resultView(record)}`:`<p>返回结构包含操作计划、各步骤结果、最后读取的状态、错误和退出码；这里不生成运行结果。</p>`}</details></article></section>`;
  }
  const caseRecordKeys=['10-process-preview','13-process-execute','14-after-detail'];
  function evidenceRecord(key){
    const r=task(key);
    return `<article class="evidence-record" data-record-key="${key}"><h3>${esc(r.result.command)} · ${esc(r.result.mode)}</h3>${commandBox(r.command)}${resultView(r)}</article>`;
  }
  function realCase(){
    return `<section class="real-case" aria-label="任务二实际案例"><h2>一个实际例子：审核通过，并新增“悬疑”。</h2><p class="case-id"><code>ct_000004</code> · ${esc(before.title)}</p><div class="case-comparison">${[['操作前',before,0,'待审核'],['操作后',after,1,'审核通过']].map(([label,c,count,human])=>`<div><h3>${label}</h3><p class="business-status">${human}<small>${c.review_status}</small></p>${tags(c.tags,['悬疑'])}<p class="history-count">审核历史 ${count} 条</p></div>`).join('')}</div>${commandBox(task('13-process-execute').command,'实际使用的执行命令')}<p>默认先预览，添加 <code>--execute --yes</code> 才执行。审核和标签分别提交并核对，原有标签保留。</p><p class="case-scope">这是本地演示，审核决定用于验证流程，不代表真实业务合规结论。</p><details id="case-records"${openAttrs('case-records')}><summary>查看实际执行记录</summary><p>以下为任务二保存的预览、执行及新的 Java 进程查询结果。</p>${caseRecordKeys.map(evidenceRecord).join('')}<p>独立查询还确认：审核历史 0→1，待审核总数 132→131，最终 revision=2。</p>${sources([['evidence/task2/preview/zero-write-validation.json','预览零写入校验'],['evidence/task2/after/snapshot-facts.json','快照 revision 与 SHA'],['evidence/task2/validation/result.json','跨 JVM 校验'],['evidence/task2/README.md','任务二说明'],['docs/06-实际操作记录.md','任务二操作记录']])}<details id="all-task-records"${openAttrs('all-task-records')}><summary>查询和核查的其他原始记录</summary>${Object.keys(D.task).filter(k=>!caseRecordKeys.includes(k)).map(evidenceRecord).join('')}</details></details></section>`;
  }
  const businessOutcomes={
    normal:['审核和标签都完成','两项修改都得到确认，并重新查询核对后，可以继续处理下一条。'],
    partial:['审核完成，标签未改','请先查询当前状态，再单独修改标签，不要重复审核。'],
    unknown:['无法确认是否写入','请求可能已经执行。先暂停并人工核查，不能直接重试。']
  };
  function outcomes(){
    return `<section class="business-outcomes"><h2>遇到异常时怎样处理</h2><div class="outcome-options" role="group" aria-label="处理结果">${Object.entries(businessOutcomes).map(([k,[label]])=>`<button data-outcome="${k}" aria-pressed="${state.outcome===k}">${label}</button>`).join('')}</div><p class="business-advice">${businessOutcomes[state.outcome][1]}</p><details id="developer-evidence"${openAttrs('developer-evidence')}><summary>研发验证详情</summary>${auxiliary(faultsPage())}</details></section>`;
  }
  function demoPage(){
    return header('输入一条命令，看看会发生什么。','查询、预览和模拟执行共享当前页面中的数据。')+
      '<div id="cli-playground"></div>'+
      '<details id="java-evidence"'+openAttrs('java-evidence')+'><summary>查看真实 Java CLI 运行记录</summary><div class="java-evidence-origin">以下来自已保存的 Java CLI 独立 Mock 工作副本。任务二完成 ct_000004 的 approve 与新增“悬疑”，历史 0→1、pending 132→131，经新 Java 进程重新读取确认。它们不随网页模拟或重置改变。</div>'+realCase()+outcomes()+'</details>'+
      '<details id="jar-examples"'+openAttrs('jar-examples')+'><summary>真正 Java CLI 的命令参考</summary><p>以下命令在 PowerShell 中通过 java -jar 运行；网页中的短命令不代表 Windows 已安装 contentops 启动器。</p>'+commandExamples()+'</details>';
  }
  function originalMaterials(){
    const entries=[['docs/01-需求与接口分析.md','需求与接口分析'],['docs/02-第一阶段MVP与CLI产品方案.md','MVP 产品方案'],['docs/03-Java技术架构与实施方案.md','Java 技术架构'],['docs/04-交付物规划与验收清单.md','交付与验收清单'],['docs/06-实际操作记录.md','实际操作记录'],['docs/07-Agent批量处理方案.md','Agent 批量方案'],['README.md','构建与运行说明']];
    return `<section class="review-materials"><h2>完整评审文档</h2><p class="muted">以下为预先排版的 HTML 阅读版，可离线阅读标题、表格与命令。</p>${sources(entries)}</section><details id="original-materials"${openAttrs('original-materials')}><summary>原始资料（Markdown）</summary><p class="muted">研发原稿保留在原位置；以下明确打开原始 Markdown 文件。</p><div class="source-links">${entries.map(([p,l])=>link(p,l,true)).join('')}</div></details>`;
  }
  function technicalPage(){
    const decisions=[
      ['每次为什么只审核一条？','接口只返回成功和失败的数量。单条提交更容易确认具体哪条已完成。'],
      ['为什么默认预览？','先看清操作对象和标签变化，再明确授权写入。'],
      ['为什么分开核对？','审核与标签是两次提交。审核确认完成后才改标签，避免把部分完成报成全部成功。'],
      ['结果未知时为什么不自动重试？','请求可能已经写入，重复提交会增加审核记录。应先核查，再由人决定后续操作。'],
      ['全量更新标签有什么风险？','接口接收完整数组，可能覆盖他人刚改的标签。客户端保留原标签，仍需上游提供版本检查。']
    ];
    return header('技术设计与后续扩展','把命令解析、业务校验和接口访问分开处理。')+`
      <section class="architecture"><h2>Java 如何处理一条命令</h2><div class="architecture-flow"><div><strong>CLI</strong><span>解析参数、确认授权</span></div><b>→</b><div><strong>ContentService / TagPlanner</strong><span>检查规则、计算标签、安排调用</span></div><b>→</b><div><strong>ContentGateway</strong><span>统一接口调用</span></div><b>→</b><div class="adapters"><div><strong>Mock</strong><span>当前本地实现</span></div><div class="future-adapter"><strong>HTTP Gateway</strong><span>待实现</span></div></div></div></section>
      <section class="design-decisions"><h2>几项关键选择</h2><dl>${decisions.map(([q,a])=>`<div><dt>${q}</dt><dd>${a}</dd></div>`).join('')}</dl><details id="technical-notes"${openAttrs('technical-notes')}><summary>技术说明</summary><div class="reading-note"><h3>标签先算完整数组</h3><p>新增标签必须存在且在用。先读取原标签，将新增项合入，再提交完整数组；不会因为只新增一项而丢掉其他标签。读与写之间仍有竞争窗口，需要服务端版本条件才能防止覆盖。</p><h3>确认响应后再读一次</h3><p>收到成功响应，还要重新查询业务状态。若写入结果未知，即使之后查到目标值，原调用也保留 unknown，不自动改报成功。</p><h3>Mock 只改工作副本</h3><p>原始 seed 只读，每次读取最新工作快照。文件锁协调本地进程，临时文件与原子替换保护写入；损坏状态明确报错。这不让审核和标签变成一个事务。</p>${sources([['docs/03-Java技术架构与实施方案.md','阅读技术架构']])}</div></details></section>
      <section class="agent-summary"><h2>如果以后一次处理 100 条 <small>后续设计</small></h2><p>现在由人工或脚本单条调用；以后由执行器按批准的清单逐条处理。</p><div class="flow">${['固定目标 ID','生成计划','人工审批','可信执行器','逐条执行','记录与恢复'].map((s,i)=>`${i?'<b>→</b>':''}<span>${s}</span>`).join('')}</div><p>需要新增批次账本、审批计划绑定和恢复能力；上游要能识别重复请求，并检查标签版本。</p><details id="agent-notes"${openAttrs('agent-notes')}><summary>Agent 方案</summary><div class="reading-note"><h3>固定对象，再开始写入</h3><p>先收集并冻结目标 ID。不能边审核 pending 边翻页，队列减少后可能跳过内容；现有分页也没有时点快照保证。</p><h3>批准哪份计划，就执行哪份计划</h3><p>需要新增审批与计划绑定，写入前持久化执行意图，用批次账本保存每次输出和退出码。当前独立预览不会强绑定后续执行，--yes 也不是审批身份。</p><h3>恢复时只处理未确认的步骤</h3><p>部分成功后只补标签；未知结果先暂停核查，不能自动重放。服务端幂等用于避免重复写入，版本检查用于发现并发修改；这些都不能靠本地账本单独保证。</p><p>这部分是演进方案，批次执行器、审批绑定和恢复能力尚未实现，也没有执行 100 条。</p>${sources([['docs/07-Agent批量处理方案.md','阅读 Agent 批量方案']])}</div></details></section>${originalMaterials()}`;
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


  function rememberExpanded(){main.querySelectorAll('details[id]').forEach(el=>{
    if(el.open)state.open.add(el.id);else state.open.delete(el.id);
  });}
  function render(){
    rememberExpanded();
    main.innerHTML=({product:productPage,demo:demoPage,technical:technicalPage})[state.route]();
    if(state.route==='demo')window.ContentOpsTerminal.mount(main.querySelector('#cli-playground'));
    document.querySelectorAll('nav a').forEach(a=>{
      if(a.hash==='#'+state.route)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');
    });
  }
  function redraw(selector){render();main.querySelector(selector)?.focus({preventScroll:true});}
  function route(){
    const key=location.hash.slice(1);
    if(key==='workspace'){if(!main.childElementCount)render();main.focus();return;}
    const aliases={overview:'product',commands:'demo',task2:'demo',faults:'demo',agent:'technical'};
    state.route=['product','demo','technical'].includes(key)?key:(aliases[key]||'product');
    render();
    if(key==='faults'){main.querySelector('#java-evidence').open=true;main.querySelector('#developer-evidence').open=true;}
    main.focus({preventScroll:true});
    if(state.route==='demo')main.querySelector('#terminal-input').focus({preventScroll:true});
    window.scrollTo(0,0);
  }
  main.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.hasAttribute('data-copy')){copy(button.dataset.copy,button);return;}
    if(button.hasAttribute('data-command')){
      state.command=Number(button.dataset.command);state.exampleMode='preview';
      redraw('[data-command="'+state.command+'"]');return;
    }
    if(button.hasAttribute('data-example-mode')){
      state.exampleMode=button.dataset.exampleMode;redraw('[data-example-mode="'+state.exampleMode+'"]');return;
    }
    if(button.hasAttribute('data-outcome')){
      state.outcome=button.dataset.outcome;redraw('[data-outcome="'+state.outcome+'"]');return;
    }
    if(button.hasAttribute('data-recovery')){
      state.recovery=button.dataset.recovery==='true';redraw('[data-recovery="'+state.recovery+'"]');return;
    }
  });
  main.addEventListener('change',event=>{
    if(event.target.id==='fault-select'){
      state.fault=event.target.value;state.recovery=false;redraw('#fault-select');
    }
  });
  window.addEventListener('hashchange',route);route();
})();
