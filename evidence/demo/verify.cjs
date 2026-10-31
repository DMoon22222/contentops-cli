// Simplified edition. Writes only evidence/demo-simplified/; historical reports stay immutable.
// Optional development QA only; not needed to open demo/index.html.
// node evidence/demo/verify.cjs --playwright-module <existing playwright package directory>
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
const assert=require('node:assert/strict');
const moduleArg=process.argv.indexOf('--playwright-module');
const {chromium}=require(moduleArg<0?'playwright':process.argv[moduleArg+1]);
const root=path.resolve(__dirname,'../..');
const checks=[];
const errors=[];
const requests=[];
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function check(name,condition,detail=''){assert.ok(condition,name+': '+detail);checks.push({name,passed:true,...(detail?{detail}:{})});}
async function run(){
  const sandbox={window:{}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'demo/data.js'),'utf8'),sandbox);
  const D=sandbox.window.DEMO_DATA;
  const hashes=JSON.parse(fs.readFileSync(path.join(__dirname,'source-hashes.json'),'utf8'));
  for(const [p,expected]of Object.entries(hashes))check('immutable source: '+p,sha(path.join(root,p))===expected);
  for(const r of [...Object.values(D.task),...Object.values(D.faults).flatMap(f=>[f.process,f.query,f.history,...(f.recovery?[f.recovery,f.recoveredQuery,f.recoveredHistory]:[])])]){
    check('raw stdout matches: '+r.source,r.stdout===fs.readFileSync(path.join(root,r.source+'.stdout.txt'),'utf8'));
    check('actual exit matches: '+r.source,r.exit===Number(fs.readFileSync(path.join(root,r.source+'.exit-code.txt'),'utf8').trim()));
  }
  check('initial pending total',D.task['03-pending-page1-json'].result.data.total===132);
  check('page size and selected second row',D.task['03-pending-page1-json'].result.data.items.length===20&&D.task['03-pending-page1-json'].result.data.items[1].content_id==='ct_000004');
  check('task2 after tags are distinct from S5',D.task['14-after-detail'].result.data.tags.join('|')==='恋爱|校园|武侠|悬疑');
  check('task2 history 0 to 1',D.task['07-candidate-ct000004-history'].result.data.items.length===0&&D.task['15-after-history'].result.data.items.length===1);
  check('task2 pending 131 / revision 2',D.task['17-after-pending-total'].result.data.total===131&&D.taskFacts.revision===2);
  const out=path.join(root,'evidence/demo-simplified');
  const integrity=JSON.parse(fs.readFileSync(path.join(out,'integrity.json'),'utf8'));
  check('payload bytes unchanged',sha(path.join(root,'demo/data.js'))===integrity.data_js_sha256);
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-CN',permissions:['clipboard-read','clipboard-write']});
    await context.setOffline(true);
    const page=await context.newPage();
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(['error','warning'].includes(m.type()))errors.push(m.type()+': '+m.text());});
    page.on('request',r=>requests.push(r.url()));
    const url=pathToFileURL(path.join(root,'demo/index.html')).href;
    const links=new Set(),readingMetrics={};
    const collect=async()=>{
      for(const href of await page.locator('a[href]').evaluateAll(els=>els.map(e=>e.getAttribute('href'))))if(href&&!href.startsWith('#'))links.add(href);
      check('no accidental undefined text',!(await page.locator('main').textContent()).includes('undefined'));
    };
    const navigate=async route=>{
      await page.locator(`nav a[href="#${route}"]`).click();
      await page.waitForFunction(key=>document.querySelector('nav a[aria-current="page"]')?.getAttribute('href')==='#'+key,route);
    };
    const open=async id=>{const el=page.locator('#'+id);if(!await el.evaluate(e=>e.open))await el.locator(':scope > summary').click();return el;};
    const close=async id=>{const el=page.locator('#'+id);if(await el.evaluate(e=>e.open))await el.locator(':scope > summary').click();};
    const snap=async(name,fullPage=false)=>{
      await page.locator('main').focus();await page.evaluate(()=>window.scrollTo(0,0));
      await page.screenshot({path:path.join(out,name+'.png'),fullPage});
    };
    const jsonMatches=async(container,record,label)=>{
      const raw=container.locator(':scope > .raw-details');
      if(!await raw.evaluate(e=>e.open))await raw.locator(':scope > summary').click();
      check('complete JSON '+label,JSON.stringify(JSON.parse(await raw.locator('.json-view').textContent()))===JSON.stringify(record.result));
      check('actual exit '+label,(await container.locator(':scope > .statusline .exit').textContent())==='exit '+record.exit);
      if(record.stderr.trim())check('stderr text '+label,(await raw.textContent()).includes(record.stderr.trim().replace(/\r\n/g,'\n')));
      await collect();
    };
    await page.goto(url);await page.locator('h1').waitFor();
    check('file page identity',page.url()===url&&(await page.title()).includes('内容运营 CLI'));
    check('three review routes',await page.locator('nav a').count()===3);
    check('default product page',await page.locator('nav a[aria-current="page"]').getAttribute('href')==='#product');
    check('clear product purpose',(await page.locator('h1').textContent()).includes('查询、审核和标签维护'));
    for(const fact of ['1 名后端','2 周 MVP','6 项 API'])check('resource '+fact,(await page.locator('.constraints').textContent()).includes(fact));
    check('three business capabilities',await page.locator('.capabilities li').count()===3);
    check('planned capabilities remain future',(await page.locator('.current-scope').textContent()).includes('仍需补齐真实后台接入（HTTP）、标签移除/替换、人工交互确认'));
    const ranges=await page.locator('.timeline strong').allTextContents();
    check('existing ten day phase ranges',JSON.stringify(ranges)===JSON.stringify(['D1–2','D3–4','D5–6','D7–8','D9–10']));
    check('no ten-row schedule copy',await page.locator('.day-plan').count()===0);
    readingMetrics.product={visible_characters:(await page.locator('main').innerText()).length};
    await snap('desktop-product');await open('product-notes');
    check('product supplement is readable HTML',await page.locator('#product-notes .reading-note h3').count()===2);
    await collect();await close('product-notes');
    await page.getByRole('link',{name:'看看七条命令怎样用'}).click();
    await page.waitForFunction(()=>document.querySelector('nav a[aria-current="page"]')?.hash==='#demo');
    check('seven commands visible as main content',await page.locator('.feature-menu button:visible').count()===7);
    check('five-step wizard removed',await page.locator('[data-step],[data-move],.step-rail').count()===0);
    check('default technical results hidden',await page.locator('.statusline:visible,.json-view:visible,.steps-table:visible').count()===0);
    check('case immediately visible',await page.locator('.case-comparison').isVisible());
    const columns=page.locator('.case-comparison > div');
    check('case before pending',(await columns.nth(0).locator('.business-status').textContent()).includes('pending'));
    check('case after approved',(await columns.nth(1).locator('.business-status').textContent()).includes('approved'));
    check('case original tags preserved',JSON.stringify(await columns.nth(0).locator('.tag').allTextContents())===JSON.stringify(D.task['05-candidate-ct000004-detail'].result.data.tags));
    check('case after tags exact',JSON.stringify(await columns.nth(1).locator('.tag').allTextContents())===JSON.stringify(D.task['14-after-detail'].result.data.tags));
    check('case history zero to one',(await columns.nth(0).textContent()).includes('审核历史 0 条')&&(await columns.nth(1).textContent()).includes('审核历史 1 条'));
    check('case logs initially collapsed',!await page.locator('#case-records').evaluate(e=>e.open));
    check('developer logs initially collapsed',!await page.locator('#developer-evidence').evaluate(e=>e.open));
    check('actual case command complete',await page.locator('.real-case > .panel-head [data-copy]').getAttribute('data-copy')===D.task['13-process-execute'].command);
    readingMetrics.demo={visible_characters:(await page.locator('main').innerText()).length};
    await snap('desktop-demo');
    await page.setViewportSize({width:1435,height:1096});await snap('concept-size-demo');await page.setViewportSize({width:1440,height:1000});
    const keys=['03-pending-page1-json','05-candidate-ct000004-detail','07-candidate-ct000004-history','08-active-tags',null,null,'10-process-preview'];
    for(let i=0;i<7;i++){
      await page.locator(`[data-command="${i}"]`).click();
      check('command selected '+i,await page.locator(`[data-command="${i}"]`).getAttribute('aria-pressed')==='true');
      const example=page.locator('.example-panel');
      const cmd=await example.locator('[data-copy]').getAttribute('data-copy');
      check('complete supported prefix '+i,cmd.startsWith('java -jar ./target/contentops.jar --env mock --output json'));
      if(i>=4){
        check('write starts in preview '+i,!cmd.includes('--execute')&&!cmd.includes('--yes'));
        check('preview note '+i,(await example.locator('.mode-note').textContent()).includes('不修改数据'));
        if(i===4)check('review required action',cmd.includes('--action approve')&&cmd.includes('--reason'));
        if(i===5)check('tags required addition',cmd.includes('--add'));
        if(i===6)check('process required parameters',cmd.includes('--action approve')&&cmd.includes('--add'));
      }
      await example.locator('[data-copy]').click();check('native clipboard command '+i,await page.evaluate(()=>navigator.clipboard.readText())===cmd);
      await open('command-detail');
      check('API available on demand '+i,(await example.locator('.api').textContent()).length>10);
      if(keys[i])await jsonMatches(page.locator('#command-detail'),D.task[keys[i]],'command '+i);
      else check('independent example clearly unexecuted '+i,(await example.locator('.example-label').textContent()).includes('命令示例'));
      if(i>=4){
        await example.locator('[data-example-mode="execute"]').click();
        const exec=await page.locator('.example-panel [data-copy]').getAttribute('data-copy');
        check('execute has both authorizations '+i,exec.endsWith('--execute --yes'));
        await page.locator('.example-panel [data-copy]').click();
        check('native clipboard execute '+i,await page.evaluate(()=>navigator.clipboard.readText())===exec);
        if(i===6)await jsonMatches(page.locator('#command-detail'),D.task['13-process-execute'],'process execute');
        else check('no invented independent result '+i,await page.locator('#command-detail .statusline').count()===0);
        await page.locator('[data-example-mode="preview"]').click();
      }
      await collect();await close('command-detail');
    }
    const copy=page.locator('.example-panel [data-copy]');
    await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined}));await copy.click();
    check('copy compatibility fallback',(await page.locator('#toast').textContent()).includes('兼容模式'));
    await page.evaluate(()=>document.execCommand=()=>false);await copy.click();
    check('manual fallback visible',await page.locator('.manual-copy').isVisible());
    check('manual complete selection',await page.locator('.manual-copy').evaluate(e=>e.selectionStart===0&&e.selectionEnd===e.value.length&&e.value.length>0));
    await page.keyboard.press('Control+c');check('manual Ctrl+C instructions',(await page.locator('#toast').textContent()).includes('Ctrl+C'));
    await page.reload();
    await open('case-records');
    for(const key of ['10-process-preview','13-process-execute','14-after-detail']){
      await jsonMatches(page.locator(`#case-records > [data-record-key="${key}"]`),D.task[key],key);
    }
    await open('all-task-records');
    for(const key of Object.keys(D.task).filter(k=>!['10-process-preview','13-process-execute','14-after-detail'].includes(k))){
      await jsonMatches(page.locator(`#all-task-records > [data-record-key="${key}"]`),D.task[key],key);
    }
    check('preview still no writes',D.task['10-process-preview'].result.data.steps.review.write==='not_sent'&&D.task['10-process-preview'].result.data.steps.tags.write==='not_sent');
    check('execution review and tags confirmed',Object.values(D.task['13-process-execute'].result.data.steps).every(s=>s.write==='acknowledged'&&s.verification==='matched'));
    await close('case-records');
    for(const [k,meaning] of [['normal','继续处理下一条'],['partial','不要重复审核'],['unknown','不能直接重试']]){
      await page.locator(`[data-outcome="${k}"]`).click();
      check('business meaning '+k,(await page.locator('.business-advice').textContent()).includes(meaning));
      check('outcome hides technical codes '+k,await page.locator('.statusline:visible').count()===0);
    }
    await open('developer-evidence');
    for(const [name,f]of Object.entries(D.faults)){
      await page.locator('#fault-select').selectOption(name);
      await jsonMatches(page.locator('#developer-evidence .two-col > section'),f.process,'S5 '+name);
      const disk=page.locator('#developer-evidence .inspector');
      check('disk review state '+name,(await disk.textContent()).includes(f.query.result.data.review_status));
      check('disk revision '+name,(await disk.textContent()).includes('revision '+f.facts.disk_revision_after_process));
      const details=disk.locator(':scope > details');if(!await details.evaluate(e=>e.open))await details.locator('summary').click();
      check('disk JSON '+name,JSON.stringify(JSON.parse(await details.locator('.json-view').textContent()))===JSON.stringify(f.query.result));
      check('developer disclosure stays open '+name,await page.locator('#developer-evidence').evaluate(e=>e.open));
    }
    await page.locator('#fault-select').selectOption('tags-reject-before-write');await page.locator('[data-recovery="true"]').click();
    await jsonMatches(page.locator('#developer-evidence .two-col > section'),D.faults['tags-reject-before-write'].recovery,'tag-only recovery');
    check('recovery avoids repeat review',!(await page.locator('#developer-evidence .steps-table tbody').textContent()).includes('review'));
    check('recovery history remains one',(await page.locator('#developer-evidence .inspector').textContent()).includes('历史 1 条'));
    await page.locator('[data-recovery="false"]').click();check('original partial preserved',(await page.locator('#developer-evidence .status').textContent())==='partial');
    await close('developer-evidence');
    await navigate('technical');
    check('five concise design choices',await page.locator('.design-decisions dt').count()===5);
    check('HTTP branch future',(await page.locator('.future-adapter').textContent()).includes('待实现'));
    check('Agent design clearly future',(await page.locator('.agent-summary h2').textContent()).includes('后续设计'));
    check('Agent main summary not whole document',(await page.locator('.agent-summary').innerText()).length<350);
    readingMetrics.technical={visible_characters:(await page.locator('main').innerText()).length};
    await snap('desktop-technical',true);
    const technicalUrl=page.url();
    for(const [button,id]of [['技术说明','technical-notes'],['Agent 方案','agent-notes']]){
      await page.locator('#'+id+' > summary').click();
      check('readable HTML opens '+id,await page.locator('#'+id).evaluate(e=>e.open));
      check('HTML headings instead of Markdown '+id,await page.locator('#'+id+' .reading-note h3').count()===3);
      check('reading stays on HTML '+id,page.url()===technicalUrl&&!page.url().endsWith('.md'));
      check('focus on readable summary '+id,await page.locator('#'+id+' > summary').evaluate(e=>e===document.activeElement));
      await page.locator('#'+id).screenshot({path:path.join(out,'readable-'+id+'.png')});
      await close(id);
    }
    await open('original-materials');
    check('available original materials',await page.locator('#original-materials a').count()===7);await collect();await close('original-materials');
    await page.locator('#technical-notes > summary').focus();await page.keyboard.press('Enter');
    check('keyboard opens supplement',await page.locator('#technical-notes').evaluate(e=>e.open));await page.keyboard.press('Enter');
    check('keyboard folds supplement',!await page.locator('#technical-notes').evaluate(e=>e.open));
    await navigate('demo');await page.locator('[data-command="4"]').focus();await page.keyboard.press('Enter');
    check('keyboard selects command',await page.locator('[data-command="4"]').getAttribute('aria-pressed')==='true');
    check('selection retains focus',await page.evaluate(()=>document.activeElement.dataset.command==='4'));
    await page.keyboard.press('Tab');check('Tab moves to next feature',await page.evaluate(()=>document.activeElement.dataset.command==='5'));
    await page.locator('.skip-link').focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>document.activeElement.id==='workspace');
    check('skip link keeps current page',await page.locator('nav a[aria-current="page"]').getAttribute('href')==='#demo');
    for(const viewport of [{width:1440,height:1000},{width:1366,height:768},{width:1024,height:768},{width:390,height:844}]){
      await page.setViewportSize(viewport);
      for(const route of ['product','demo','technical']){
        await navigate(route);await collect();
        check(`route ${viewport.width} ${route}`,await page.locator('nav a[aria-current="page"]').getAttribute('href')==='#'+route);
        check(`single h1 ${viewport.width} ${route}`,await page.locator('h1').count()===1);
        check(`no page overflow ${viewport.width} ${route}`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        check(`readable body ${viewport.width} ${route}`,await page.locator('body').evaluate(e=>parseFloat(getComputedStyle(e).fontSize)>=16));
      }
      await navigate('demo');
      for(let i=0;i<7;i++){
        await page.locator(`[data-command="${i}"]`).click();
        check(`feature layout ${viewport.width} ${i}`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        check(`code font ${viewport.width} ${i}`,await page.locator('.example-panel > .terminal pre').evaluate(e=>parseFloat(getComputedStyle(e).fontSize)>=14));
      }
      await open('developer-evidence');
      for(const name of Object.keys(D.faults)){
        await page.locator('#fault-select').selectOption(name);await collect();
        check(`fault layout ${viewport.width} ${name}`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      }
      await close('developer-evidence');await page.locator('[data-command="0"]').click();await page.locator('[data-outcome="normal"]').click();
      if(viewport.width===1366)await snap('laptop-demo');
      if(viewport.width===390){await snap('narrow-demo',true);await navigate('technical');await snap('narrow-technical',true);await navigate('product');await snap('narrow-product',true);}
    }
    for(const href of links)check('local source '+href,!/^https?:/.test(href)&&fs.existsSync(path.resolve(root,'demo',decodeURI(href.split('#')[0]))));
    const previous=JSON.parse(fs.readFileSync(path.join(root,'evidence/demo-review/browser-results.json'),'utf8')).checks.filter(c=>c.name.startsWith('local source link ')).map(c=>c.name.slice(18));
    check('old seventy source paths preserved',previous.every(p=>links.has(p)),JSON.stringify(previous.filter(p=>!links.has(p))));
    for(const route of ['product','demo','technical']){
      await navigate(route);
      for(const a of await page.locator('a[href$=".md"]').all())check('raw Markdown link explicitly labeled',(await a.textContent()).includes('原始 Markdown 文档'));
      check('default page has no visible raw Markdown link '+route,await page.locator('a[href$=".md"]:visible').count()===0);
      check('default page has no visible JSON '+route,await page.locator('.json-view:visible').count()===0);
    }
    check('no console errors',errors.length===0,JSON.stringify(errors));
    check('offline file resources only',requests.every(r=>r.startsWith('file:')),JSON.stringify(requests));
    check('evidence object unchanged',await page.evaluate(()=>JSON.stringify(window.DEMO_DATA))===JSON.stringify(D));
    await page.emulateMedia({reducedMotion:'reduce'});check('reduced motion body font',await page.locator('body').evaluate(e=>getComputedStyle(e).fontSize==='16px'));
    const report={captured_at:new Date().toISOString(),passed:true,check_count:checks.length,browser:browser.version(),
      playwright:require((moduleArg<0?'playwright':process.argv[moduleArg+1])+'/package.json').version,url,offline:true,
      browser_plugin:'Absent; Browser plugin not available. Existing local Playwright + Chrome used for file:// validation.',
      viewports:['1440x1000','1435x1096','1366x768','1024x768','390x844'],console_errors:errors,requests,
      unique_source_links:links.size,reading_metrics:readingMetrics,checks};
    fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify(report,null,2)+'\n');
    console.log(`PASS: ${checks.length} assertions; seven visible commands; ${links.size} local links; offline Chrome ${browser.version()}.`);
  }finally{await browser.close();}
}
run().catch(e=>{fs.writeFileSync(path.join(root,'evidence/demo-simplified/failure-'+Date.now()+'.json'),JSON.stringify({at:new Date().toISOString(),error:e.stack,passed_checks:checks.length},null,2)+'\n');console.error(e);process.exitCode=1;});
