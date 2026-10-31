/* DOM adapter only. User text never becomes HTML, script, a shell call or a URL. */
(function(){
  'use strict';
  const {DemoCliEngine,MAX_INPUT}=window.ContentOpsDemo;
  const engine=new DemoCliEngine(window.PLAYGROUND_SEED.data);
  const entries=[],history=[];
  let selectedId='ct_000004',draft='',cursor=0,savedDraft='',mounted=null,busy=false;
  const quickCommands=[
    ['查看帮助','help'],['查询待审核','content list --review-status pending'],
    ['查看示例内容','content get ct_000004'],
    ['预览审核与标签','content process ct_000004 --action approve --reason "网页模拟决定" --add 悬疑'],
    ['填入模拟执行命令','content process ct_000004 --action approve --reason "网页模拟决定" --add 悬疑 --execute --yes']
  ];
  function status(message){if(mounted)mounted.querySelector('.playground-status').textContent=message;}
  function summary(){
    if(!mounted)return;
    const s=engine.summary(selectedId),set=(key,value)=>{mounted.querySelector('[data-summary="'+key+'"]').textContent=value;};
    set('pending',String(s.pending));set('total',String(s.total));set('id',s.content?.content_id||'未选择');
    set('review',s.content?.review_status||'—');set('tags',s.content?.tags.join('、')||'—');
    set('dirty',s.changed?'有模拟修改':'初始样例');
  }
  function logView(){
    if(!mounted)return;
    const log=mounted.querySelector('.playground-output');log.replaceChildren();
    for(const entry of entries){
      const block=document.createElement('section');block.className='terminal-entry';block.dataset.origin='browser_simulator';
      if(entry.command!==null){const prompt=document.createElement('div');prompt.className='terminal-prompt';prompt.textContent='contentops > '+entry.command;block.append(prompt);block.dataset.terminalCommand=entry.command;}
      const text=document.createElement('pre');text.className='terminal-response';text.textContent=entry.text;
      if(entry.envelope){text.dataset.status=entry.envelope.status;text.dataset.exit=String(entry.envelope.exit_code);text.dataset.output=entry.output;if(entry.envelope.exit_code!==0)text.classList.add('response-error');}
      block.append(text);log.append(block);
    }
    log.scrollTop=log.scrollHeight;
  }
  function add(entry){entries.push(entry);if(entries.length>80)entries.shift();logView();}
  function welcome(){
    const s=engine.summary(selectedId);
    add({command:null,text:'已载入 '+s.total+' 条初始内容，其中 '+s.pending+' 条待审核。\n输入 help 查看命令，或用下方按钮填入示例。\n写命令默认预览；clear 只清屏，重置数据才恢复样例。'});
  }
  function submit(){
    if(!mounted||busy)return;
    const input=mounted.querySelector('#terminal-input'),raw=input.value;
    if(!raw.trim()){status('请输入命令，例如 help。');input.focus();return;}
    busy=true;
    try{
      history.push(raw);if(history.length>100)history.shift();cursor=history.length;savedDraft='';draft='';input.value='';
      const result=engine.run(raw);
      if(result.kind==='clear'){entries.length=0;logView();status('终端已清空，业务数据和命令历史保留。');}
      else{
        if(result.envelope?.content_id&&engine.inspect(result.envelope.content_id))selectedId=result.envelope.content_id;
        if(result.envelope?.command==='content.list'&&result.envelope.data?.items?.length===1)selectedId=result.envelope.data.items[0].content_id;
        add({command:raw,text:result.output==='json'&&result.envelope?JSON.stringify(result.envelope,null,2):result.text,envelope:result.envelope,output:result.output});
        status(result.envelope?.error?'命令未完成，可检查提示后重新输入。':'可继续输入命令；↑↓ 查看输入历史。');
      }
      summary();input.focus({preventScroll:true});
    }finally{busy=false;}
  }
  function reset(){
    engine.reset();selectedId='ct_000004';entries.length=0;draft='';savedDraft='';cursor=history.length;
    mounted.querySelector('#terminal-input').value='';mounted.querySelector('.reset-confirm').hidden=true;
    welcome();summary();status('已重置数据：审核、标签和新增模拟记录均恢复初始状态。命令历史保留。');
    mounted.querySelector('#terminal-input').focus({preventScroll:true});
  }
  async function copyInput(button){
    const input=mounted.querySelector('#terminal-input'),text=input.value||history.at(-1);
    if(!text){status('先输入或填入一条命令，再复制。');return;}
    try{if(!navigator.clipboard?.writeText)throw Error('unavailable');await navigator.clipboard.writeText(text);status('已复制网页短命令，尚未运行。');return;}catch{/* File permission fallback. */}
    const box=document.createElement('textarea');box.value=text;box.readOnly=true;box.className='manual-copy';box.setAttribute('aria-label','手动复制网页命令');
    mounted.querySelector('.playground-form').after(box);box.focus();box.select();
    let copied=false;try{copied=document.execCommand('copy');}catch{/* Visible manual selection remains. */}
    if(copied){box.remove();button.focus();status('已用兼容方式复制，尚未运行。');}
    else{status('浏览器未允许复制，请在已选文本中按 Ctrl+C。');box.addEventListener('blur',()=>box.remove(),{once:true});}
  }
  function mount(container){
    mounted=container;
    container.innerHTML=`<section class="playground" aria-label="CLI Playground">
      <div class="playground-title"><div><h2>CLI Playground</h2><p>浏览器模拟环境 · 不调用 Java 或真实后台</p></div><button type="button" data-reset>重置数据</button></div>
      <div class="playground-grid"><div class="terminal-workspace">
        <div class="playground-output" role="log" aria-label="浏览器模拟输出" aria-live="polite" aria-relevant="additions" tabindex="0"></div>
        <form class="playground-form"><label for="terminal-input">contentops &gt;</label><input id="terminal-input" type="text" spellcheck="false" autocomplete="off" autocapitalize="off" aria-label="输入网页 CLI 命令" placeholder="help 或 content list --review-status pending"><button type="submit">运行</button><button type="button" data-terminal-copy aria-label="复制网页命令">复制</button></form>
        <div class="quick-commands" role="group" aria-label="填入命令示例"></div>
        <p class="terminal-hint">Enter 运行 · ↑↓ 输入历史 · clear 清屏</p>
        <div class="playground-status" role="status" aria-live="polite"></div>
        <div class="reset-confirm" role="group" aria-label="确认重置模拟数据" hidden><p>这会恢复初始样例并清除模拟写入，命令历史保留。</p><button type="button" data-reset-confirm>确认重置</button><button type="button" data-reset-cancel>取消</button></div>
      </div><aside class="playground-summary" aria-label="浏览器当前状态"><h3>当前模拟状态</h3><dl><dt>待审核 / 全部</dt><dd><strong data-summary="pending"></strong> / <span data-summary="total"></span></dd><dt>当前查看内容</dt><dd data-summary="id"></dd><dt>审核状态</dt><dd data-summary="review"></dd><dt>标签</dt><dd data-summary="tags"></dd></dl><p data-summary="dirty"></p><p class="muted">修改只在本页内存中保留，刷新或重置即恢复。</p><button type="button" data-open-faults>查看故障演示</button></aside></div></section>`;
    const input=container.querySelector('#terminal-input');input.maxLength=MAX_INPUT;input.value=draft;
    for(const [label,command]of quickCommands){
      const button=document.createElement('button');button.type='button';button.textContent=label;button.dataset.quickCommand=command;
      container.querySelector('.quick-commands').append(button);
    }
    container.querySelector('form').addEventListener('submit',event=>{event.preventDefault();submit();});
    input.addEventListener('input',()=>{draft=input.value;cursor=history.length;});
    input.addEventListener('keydown',event=>{
      if(event.isComposing){if(event.key==='Enter')event.preventDefault();return;}
      if(event.key!=='ArrowUp'&&event.key!=='ArrowDown')return;
      event.preventDefault();if(!history.length)return;
      if(event.key==='ArrowUp'){if(cursor===history.length)savedDraft=input.value;cursor=Math.max(0,cursor-1);input.value=history[cursor];}
      else{cursor=Math.min(history.length,cursor+1);input.value=cursor===history.length?savedDraft:history[cursor];}
      draft=input.value;input.setSelectionRange(input.value.length,input.value.length);
    });
    container.addEventListener('click',event=>{
      const b=event.target.closest('button');if(!b)return;
      if(b.hasAttribute('data-quick-command')){draft=b.dataset.quickCommand;input.value=draft;cursor=history.length;input.focus({preventScroll:true});status('命令已填入，按 Enter 或点击运行。');}
      if(b.hasAttribute('data-terminal-copy'))copyInput(b);
      if(b.hasAttribute('data-reset')){if(engine.changed){container.querySelector('.reset-confirm').hidden=false;container.querySelector('[data-reset-cancel]').focus();}else reset();}
      if(b.hasAttribute('data-reset-confirm'))reset();
      if(b.hasAttribute('data-reset-cancel')){container.querySelector('.reset-confirm').hidden=true;input.focus();status('已取消重置。');}
      if(b.hasAttribute('data-open-faults')){
        const evidence=document.querySelector('#java-evidence'),faults=document.querySelector('#developer-evidence');evidence.open=true;faults.open=true;
        faults.querySelector('summary').focus();faults.scrollIntoView({block:'start'});
      }
    });
    if(!entries.length&&!history.length)welcome();else logView();
    summary();status('快捷按钮只填入命令，不会自动运行。');
  }
  window.ContentOpsTerminal={mount};
})();
