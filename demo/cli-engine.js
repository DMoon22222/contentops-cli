/* Browser-only business simulation; shared with dependency-free Node tests. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.ContentOpsDemo=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const clone=value=>JSON.parse(JSON.stringify(value));
  const MAX_INPUT=2048,MAX_TOKENS=128;
  const HELP=`网页命令（可选 contentops 前缀）
content list [--review-status pending|approved|rejected] [--page 1] [--content-id ID]
content get ID
content history ID
tags list [--status active|all]
content review ID --action approve|reject [--reason "理由"]
content tags update ID --add "标签" [--add "另一个标签"]
content process ID --action approve|reject --add "标签" [--reason "理由"]

写命令默认预览；同时添加 --execute --yes 才修改网页内存。
--output table|json 选择输出；--non-interactive 可接受，不等待输入。
--env mock 可接受；api 拒绝，不会联网。
help 或 --help：帮助。clear：只清屏。重置数据：恢复初始样例。
双引号和单引号可包含空格；引号内 \\" 和 \\\\ 表示引号和反斜线。
不支持管道、重定向、命令连接、变量展开、系统命令或 Java 启动语句。
网页短命令不代表 Windows 已安装 contentops 启动器。
模拟 JSON 的 environment=browser，退出码不是 JVM 进程码。
输入上限 2048 字符；界面保留最近 80 次输出、100 条命令历史。`;
  class CliError extends Error {
    constructor(code,message,exit=2){super(message);this.code=code;this.exit=exit;}
  }
  function tokenize(input){
    if(typeof input!=='string'||input.length>MAX_INPUT)throw new CliError('INPUT_TOO_LONG','命令最多 2048 个字符。');
    if(/[\u0000-\u0008\u000a-\u001f\u007f]/u.test(input))throw new CliError('INVALID_CONTROL','请每次输入一行命令，不使用换行或控制字符。');
    const tokens=[];let value='',quote=null,started=false;
    const fail=(code,message)=>{const error=new CliError(code,message);error.tokens=tokens.slice();throw error;};
    const push=()=>{if(started){tokens.push(value);value='';started=false;if(tokens.length>MAX_TOKENS)throw new CliError('TOO_MANY_ARGUMENTS','参数过多，最多 128 项。');}};
    for(let i=0;i<input.length;i++){
      const c=input[i];
      if(quote){
        if(c===quote){quote=null;continue;}
        if(c==='\\'&&(input[i+1]===quote||input[i+1]==='\\')){value+=input[++i];continue;}
        value+=c;continue;
      }
      if(c==='"'||c==="'"){quote=c;started=true;continue;}
      if(/\s/u.test(c)){push();continue;}
      if(/[|&;<>`$]/u.test(c))fail('SHELL_UNSUPPORTED','网页不支持管道、重定向、连接符或变量展开；普通文字请放在引号内。');
      value+=c;started=true;
    }
    if(quote)fail('UNCLOSED_QUOTE','引号没有闭合，请检查理由或标签两侧的引号。');
    push();return tokens;
  }
  const GLOBAL=['--env','--output','--non-interactive','--help'];
  const VALUES=new Set(['--env','--output','--review-status','--page','--content-id','--status','--action','--reason','--add']);
  const FLAGS=new Set(['--execute','--yes','--non-interactive','--help']);
  const SPECS=[
    {path:['content','tags','update'],command:'content.tags.update',id:true,write:true,tags:true,options:['--add','--execute','--yes']},
    {path:['content','list'],command:'content.list',options:['--review-status','--page','--content-id']},
    {path:['content','get'],command:'content.get',id:true,options:[]},
    {path:['content','history'],command:'content.history',id:true,options:[]},
    {path:['tags','list'],command:'tags.list',options:['--status']},
    {path:['content','review'],command:'content.review',id:true,write:true,review:true,options:['--action','--reason','--execute','--yes']},
    {path:['content','process'],command:'content.process',id:true,write:true,review:true,tags:true,options:['--action','--reason','--add','--execute','--yes']}
  ];
  function parseCommand(tokens){
    const words=tokens.slice();if(words[0]==='contentops')words.shift();
    const options=Object.create(null),positionals=[];
    for(let i=0;i<words.length;i++){
      const token=words[i];
      if(!token.startsWith('-')){positionals.push(token);continue;}
      const eq=token.indexOf('=');let name=eq<0?token:token.slice(0,eq),value=eq<0?undefined:token.slice(eq+1);
      if(name==='-h')name='--help';
      if(!VALUES.has(name)&&!FLAGS.has(name))throw new CliError('UNKNOWN_OPTION','未知参数：'+name+'。输入 help 查看支持范围。');
      if(name!=='--add'&&Object.hasOwn(options,name))throw new CliError('DUPLICATE_OPTION','参数只能提供一次：'+name);
      if(FLAGS.has(name)){
        if(eq>=0)throw new CliError('FLAG_VALUE','参数 '+name+' 不接收值。');
        options[name]=true;continue;
      }
      if(eq<0){value=words[++i];if(value===undefined||value.startsWith('--'))throw new CliError('MISSING_VALUE','参数 '+name+' 缺少值。');}
      if(name==='--add'){(options[name]??=[]).push(value);}else options[name]=value;
    }
    const output=options['--output']??'table';
    if(!['table','json'].includes(output))throw new CliError('INVALID_OUTPUT','--output 只支持 table 或 json。');
    if(options['--env']!==undefined&&!['mock','api'].includes(options['--env']))throw new CliError('INVALID_ENVIRONMENT','--env 只支持 mock 或 api；网页输出仍标为 browser。');
    if(options['--env']==='api')throw new CliError('API_UNAVAILABLE','网页不接入 API，请使用浏览器模拟环境。');
    if((positionals[0]==='help'||positionals[0]==='clear')&&positionals.length===1){
      if(Object.keys(options).some(k=>!GLOBAL.includes(k)))throw new CliError('UNSUPPORTED_OPTION','help/clear 不接收业务参数。');
      return {kind:positionals[0],options,output};
    }
    if(!positionals.length&&options['--help'])return {kind:'help',options,output};
    const spec=SPECS.find(s=>s.path.every((part,i)=>positionals[i]===part));
    if(!spec)throw new CliError('UNKNOWN_COMMAND','未知命令。输入 help 查看七条业务命令；网页不能运行 Java 或系统程序。');
    for(const key of Object.keys(options))if(!GLOBAL.includes(key)&&!spec.options.includes(key))throw new CliError('UNSUPPORTED_OPTION',spec.command+' 不支持参数 '+key+'。');
    if(options['--help'])return {kind:'help',options,output};
    const expected=spec.path.length+(spec.id?1:0);
    if(positionals.length!==expected)throw new CliError('CONTENT_ID_REQUIRED',spec.id?'请提供一个明确的内容 ID，且不要增加多余位置参数。':'此命令不接收额外位置参数。');
    if(spec.review&&!Object.hasOwn(options,'--action'))throw new CliError('ACTION_REQUIRED','审核需要 --action approve 或 --action reject。');
    if(spec.tags&&!options['--add']?.length)throw new CliError('TAG_REQUIRED','请用 --add 指定新增标签。');
    return {...spec,kind:'business',options,output,id:spec.id?positionals[spec.path.length]:null,mode:spec.write?(options['--execute']?'execute':'preview'):'read'};
  }
  const snapshot=c=>({content_id:c.content_id,review_status:c.review_status,quality_status:c.quality_status,visibility:c.visibility,tags:c.tags.slice()});
  const sameTags=(a,b)=>new Set(a).size===new Set(b).size&&a.every(t=>b.includes(t));
  class DemoCliEngine {
    #seed;#data;#writes=0;#sequence=0;#clock;
    constructor(seed,{clock=()=>new Date().toISOString()}={}){
      if(!seed||!Array.isArray(seed.contents)||!Array.isArray(seed.tags)||!seed.review_logs)throw new Error('Invalid browser seed');
      this.#seed=clone(seed);this.#clock=clock;this.reset();
    }
    reset(){this.#data=clone(this.#seed);this.#writes=0;}
    get changed(){return this.#writes>0;}
    exportState(){return clone(this.#data);}
    inspect(id){const c=this.#data.contents.find(c=>c.content_id===id);return c?clone(c):null;}
    summary(id){const c=this.inspect(id);return {total:this.#data.contents.length,pending:this.#data.contents.filter(c=>c.review_status==='pending').length,content:c,changed:this.changed};}
    #find(id){
      if(!id||/[\s\p{Cc}]/u.test(id))throw new CliError('INVALID_CONTENT_ID','内容 ID 不能为空或包含空白/控制字符。');
      const found=this.#data.contents.find(c=>c.content_id===id);
      if(!found)throw new CliError('CONTENT_NOT_FOUND','没有找到内容 '+id+'，请检查 ID。',3);
      return found;
    }
    #result(spec,status,exit,data=null,error=null,warnings=[]){
      return {schema_version:'1',invocation_id:'browser-'+(++this.#sequence),environment:'browser',source:'browser_simulator',
        command:spec?.command??null,mode:spec?.mode??null,status,exit_code:exit,content_id:spec?.id??null,data:clone(data),error,warnings:warnings.slice()};
    }
    run(input){
      let spec=null,output='table';
      try{
        const tokens=tokenize(input);
        output=tokens.some((t,i)=>t==='--output=json'||t==='--output'&&tokens[i+1]==='json')?'json':'table';
        spec=parseCommand(tokens);output=spec.output;
        if(spec.kind!=='business')return {kind:spec.kind,output,envelope:null,text:spec.kind==='help'?HELP:'',mutated:false};
        const count=this.#writes;
        const envelope=spec.write?this.#write(spec):this.#read(spec);
        return {kind:'result',output,envelope,text:formatResult(envelope),mutated:this.#writes!==count};
      }catch(error){
        if(error.tokens?.some((t,i)=>t==='--output=json'||t==='--output'&&error.tokens[i+1]==='json'))output='json';
        const known=error instanceof CliError;
        const exit=known?error.exit:1;
        const envelope=this.#result(spec,exit===2?'rejected':'failed',exit,null,{code:known?error.code:'INTERNAL_ERROR',message:known?error.message:'模拟器内部异常，请重查当前状态，不要自动重试。',step:null,details:null});
        return {kind:'result',output,envelope,text:formatResult(envelope),mutated:false};
      }
    }
    #read(spec){
      const o=spec.options;let data;
      if(spec.command==='content.list'){
        const raw=o['--page']??'1';
        if(!/^\d+$/u.test(raw)||!Number.isSafeInteger(Number(raw))||Number(raw)<1||Number(raw)>2147483647)throw new CliError('INVALID_PAGE','--page 必须是大于等于 1 的整数。');
        const status=o['--review-status'];
        if(status!==undefined&&!['pending','approved','rejected'].includes(status))throw new CliError('INVALID_REVIEW_STATUS','--review-status 只支持 pending、approved、rejected。');
        const id=o['--content-id'];if(id!==undefined&&(!id||/[\s\p{Cc}]/u.test(id)))throw new CliError('INVALID_CONTENT_ID','--content-id 不能包含空白。');
        const matches=this.#data.contents.filter(c=>(id===undefined||c.content_id===id)&&(status===undefined||c.review_status===status));
        const page=Number(raw),fields=['content_id','title','creator_id','review_status','quality_status','visibility','tags','created_at'];
        data={page,page_size:20,total:matches.length,items:matches.slice((page-1)*20,page*20).map(c=>Object.fromEntries(fields.map(k=>[k,clone(c[k])])))};
      }else if(spec.command==='content.get')data=clone(this.#find(spec.id));
      else if(spec.command==='content.history'){
        this.#find(spec.id);
        const logs=this.#data.review_logs[spec.id]??[];
        data={content_id:spec.id,items:clone(logs).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at))};
      }else{
        const status=o['--status']??'active';
        if(!['active','all'].includes(status))throw new CliError('INVALID_TAG_STATUS','--status 只支持 active 或 all。');
        const items=this.#data.tags.filter(t=>status==='all'||t.status==='active');data={total:items.length,items:clone(items)};
      }
      return this.#result(spec,'succeeded',0,data);
    }
    #write(spec){
      const o=spec.options;
      if(Boolean(o['--execute'])!==Boolean(o['--yes']))throw new CliError('EXECUTION_AUTHORIZATION_REQUIRED','模拟执行必须同时添加 --execute --yes；本次没有写入。');
      const reason=o['--reason']===undefined?null:o['--reason'].trim(),action=o['--action'];
      if(spec.review&&!['approve','reject'].includes(action))throw new CliError('INVALID_ACTION','--action 只支持 approve 或 reject。');
      if(spec.review&&action==='reject'&&!reason)throw new CliError('REJECT_REASON_REQUIRED','驳回必须提供非空 --reason。');
      const current=this.#find(spec.id),before=snapshot(current);
      if(spec.review&&current.review_status!=='pending')throw new CliError('REVIEW_NOT_PENDING','只能审核 pending 内容；请查看当前详情，不会重复审核。');
      const warnings=[],after=current.tags.slice(),requested=[];
      if(spec.tags){
        for(const raw of o['--add']){
          const tag=raw.trim();
          if(!tag||/\p{Cc}/u.test(tag))throw new CliError('INVALID_TAG','新增标签不能为空或包含控制字符。');
          if(requested.includes(tag)){warnings.push('重复的 --add 已去重：'+tag);continue;}
          requested.push(tag);
          if(current.tags.includes(tag))continue;
          const matches=this.#data.tags.filter(t=>t.tag===tag);
          if(!matches.length)throw new CliError('UNKNOWN_TAG','标签库中没有：'+tag+'。请先运行 tags list。');
          if(matches.some(t=>t.status!=='active'))throw new CliError('INACTIVE_TAG','只能新增 active 标签：'+tag);
          after.push(tag);
        }
        if(!after.length)throw new CliError('EMPTY_TAGS_NOT_SUPPORTED','当前不支持清空全部标签。');
        for(const t of new Set(before.tags)){
          const matches=this.#data.tags.filter(x=>x.tag===t);
          if(!matches.length)warnings.push('保留存量未知标签：'+t);
          else if(matches.some(x=>x.status!=='active'))warnings.push('保留存量废弃标签：'+t);
        }
      }
      const plan={review:spec.review?{before:before.review_status,action,reason}:null,tags:spec.tags?{before:before.tags.slice(),after:after.slice()}:null};
      const steps={},events=[];
      if(spec.review)steps.review={write:'not_sent',verification:'not_checked',api_result:null};
      if(spec.tags)steps.tags={write:'not_sent',verification:'not_checked',api_result:null};
      const data={plan,steps,observed:before,events};
      if(spec.mode==='preview')return this.#result(spec,'previewed',0,data,null,warnings);
      if(!sameTags(this.#find(spec.id).tags,before.tags)||spec.review&&this.#find(spec.id).review_status!=='pending')throw new CliError('STATE_CHANGED','状态已变化，请重新查询和预览。');
      let active='preflight';
      try{
        if(spec.review){
          active='review';
          // Clock and log preparation precede mutation; these are browser records, never Java audit rows.
          const created=this.#clock();if(!Number.isFinite(Date.parse(created)))throw new Error('Invalid simulation clock');
          const log={action,reason:reason??'',operator_id:'op_browser_demo',created_at:created};
          steps.review.write='unknown';
          current.review_status=action==='approve'?'approved':'rejected';
          (this.#data.review_logs[spec.id]??=[]).push(log);this.#writes++;
          events.push('review:submitted');steps.review.write='acknowledged';
          data.observed=snapshot(this.#find(spec.id));
          steps.review.verification=data.observed.review_status===(action==='approve'?'approved':'rejected')?'matched':'mismatched';
          events.push('review:verified');
          if(steps.review.verification!=='matched')return this.#result(spec,'verification_failed',6,data,{code:'LOCAL_REVIEW_MISMATCH',message:'模拟审核后的状态不匹配，未继续标签写入。',step:'review',details:null},warnings);
        }
        if(spec.tags){
          active='tags';
          if(sameTags(before.tags,after)){
            steps.tags={write:'skipped',verification:'matched',api_result:null};events.push('tags:skipped');
            return this.#result(spec,spec.review?'succeeded':'no_change',0,data,null,warnings);
          }
          steps.tags.write='unknown';current.tags=after.slice();this.#writes++;
          events.push('tags:submitted');steps.tags.write='acknowledged';
          data.observed=snapshot(this.#find(spec.id));steps.tags.verification=sameTags(data.observed.tags,after)?'matched':'mismatched';events.push('tags:verified');
          const reviewMatched=!spec.review||data.observed.review_status===(action==='approve'?'approved':'rejected');
          if(spec.review)steps.review.verification=reviewMatched?'matched':'mismatched';
          if(steps.tags.verification!=='matched'||!reviewMatched)return this.#result(spec,'verification_failed',6,data,{code:'LOCAL_FINAL_MISMATCH',message:'模拟最终状态核对失败。',step:'tags',details:null},warnings);
        }
        return this.#result(spec,'succeeded',0,data,null,warnings);
      }catch(error){
        const unknown=Object.values(steps).some(s=>s.write==='unknown');
        const unverified=Object.values(steps).some(s=>s.write==='acknowledged'&&s.verification==='not_checked');
        const partial=steps.review?.verification==='matched';
        const status=unknown?'unknown':unverified?'verification_failed':partial?'partial':'failed';
        const code=unknown?5:unverified?6:partial?4:1;
        return this.#result(spec,status,code,data,{code:'LOCAL_SIMULATION_ERROR',message:'网页计算异常；保留已记录步骤，请查询当前状态，不自动重试。',step:active,details:null},warnings);
      }
    }
  }
  function formatResult(r){
    if(r.error)return '未完成：'+r.error.message+'\n状态 '+r.status+' · 模拟退出码 '+r.exit_code;
    const d=r.data;
    if(r.mode==='preview'){
      const lines=['操作预览（尚未执行）','内容：'+r.content_id];
      if(d.plan.review)lines.push('审核：'+d.plan.review.before+' → '+(d.plan.review.action==='approve'?'approved':'rejected'), '理由：'+(d.plan.review.reason||'未填写'));
      if(d.plan.tags)lines.push('原标签：'+d.plan.tags.before.join('、'),'目标标签：'+d.plan.tags.after.join('、'));
      lines.push('本次没有修改数据。添加 --execute --yes 才模拟执行。');
      return lines.join('\n')+(r.warnings.length?'\n提示：'+r.warnings.join('；'):'');
    }
    if(r.mode==='execute'){
      const lines=[];
      if(d.steps.review)lines.push('审核成功：'+r.content_id+' 已'+(d.plan.review.action==='approve'?'通过审核':'驳回')+'，状态已核对。');
      if(d.steps.tags)lines.push(d.steps.tags.write==='skipped'?'标签已包含，无需修改。':'标签已更新并核对，原有标签已保留。');
      lines.push('当前标签：'+d.observed.tags.join('、'));
      if(r.warnings.length)lines.push('提示：'+r.warnings.join('；'));
      return lines.join('\n');
    }
    if(r.command==='content.list')return '查询成功\n匹配总数：'+d.total+'；当前第 '+d.page+' 页，每页最多 20 条\n\nID            审核状态     标题\n'+(d.items.length?d.items.map(c=>c.content_id.padEnd(14)+c.review_status.padEnd(13)+c.title).join('\n'):'（这一页没有内容）');
    if(r.command==='content.get')return ['内容：'+d.content_id,'标题：'+d.title,'审核状态：'+d.review_status,'标签：'+d.tags.join('、'),'正文：'+(d.body||'（正文为空）'),'创作者：'+d.creator_id,'创建时间：'+d.created_at,'来源：'+d.source].join('\n');
    if(r.command==='content.history')return '内容 '+d.content_id+' · 审核记录 '+d.items.length+' 条\n'+(d.items.length?d.items.map(h=>h.created_at+'  '+h.action+'  '+h.operator_id+'\n理由：'+(h.reason||'（未填写）')).join('\n\n'):'暂无审核记录。');
    return '标签 '+d.total+' 个\n\n'+d.items.map(t=>t.tag+'  / '+t.group+'  / '+t.status).join('\n');
  }
  return {DemoCliEngine,tokenize,parseCommand,formatResult,HELP,MAX_INPUT};
});
