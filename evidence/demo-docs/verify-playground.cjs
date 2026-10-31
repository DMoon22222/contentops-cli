// Docs edition regression, adapted from the unchanged Playground validator.
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
  const hashes=JSON.parse(fs.readFileSync(path.join(root,'evidence/demo/source-hashes.json'),'utf8'));
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
  const out=path.join(root,'evidence/demo-docs/playground-regression');
  const integrity=JSON.parse(fs.readFileSync(path.join(root,'evidence/demo-playground/integrity.json'),'utf8'));
  check('historical evidence payload unchanged',sha(path.join(root,'demo/data.js'))===integrity.data_js_sha256);
  const originalSeed=JSON.parse(fs.readFileSync(path.join(root,'内容运营后台接口数据/mock_data.json'),'utf8'));
  const seedBox={window:{}};vm.runInNewContext(fs.readFileSync(path.join(root,'demo/seed.js'),'utf8'),seedBox);
  check('complete browser seed equals original',JSON.stringify(seedBox.window.PLAYGROUND_SEED.data)===JSON.stringify(originalSeed));
  check('browser seed source SHA',seedBox.window.PLAYGROUND_SEED.sha256===sha(path.join(root,'内容运营后台接口数据/mock_data.json')));
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-CN',permissions:['clipboard-read','clipboard-write']});await context.setOffline(true);
    const page=await context.newPage(),links=new Set(),dialogs=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(['error','warning'].includes(m.type()))errors.push(m.type()+': '+m.text());});
    page.on('request',r=>requests.push(r.url()));page.on('dialog',async d=>{dialogs.push(d.message());await d.dismiss();});
    const url=pathToFileURL(path.join(root,'demo/index.html')).href;
    const input=()=>page.locator('#terminal-input');
    const commands=()=>page.locator('.terminal-entry[data-terminal-command]');
    const pending=async()=>Number(await page.locator('[data-summary="pending"]').textContent());
    const summaryReview=async()=>page.locator('[data-summary="review"]').textContent();
    const collect=async()=>{for(const href of await page.locator('a[href]').evaluateAll(els=>els.map(e=>e.getAttribute('href'))))if(href&&!href.startsWith('#'))links.add(href);};
    const navigate=async route=>{await page.locator(`nav a[href="#${route}"]`).click();await page.waitForFunction(r=>document.querySelector('nav a[aria-current="page"]')?.hash==='#'+r,route);};
    const open=async id=>{const e=page.locator('#'+id);if(!await e.evaluate(x=>x.open))await e.locator(':scope > summary').click();return e;};
    const close=async id=>{const e=page.locator('#'+id);if(await e.evaluate(x=>x.open))await e.locator(':scope > summary').click();};
    const snap=async(name,fullPage=false)=>{await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(out,name+'.png'),fullPage});};
    const run=async(command,{json=true,click=false}={})=>{
      const raw=json?'--output json '+command:command;
      const before=await commands().count();await input().fill(raw);
      if(click)await page.getByRole('button',{name:'运行',exact:true}).click();else await input().press('Enter');
      await page.waitForFunction(n=>document.querySelectorAll('.terminal-entry[data-terminal-command]').length===Math.min(80,n+1),before);
      const entry=commands().last(),text=await entry.locator('.terminal-response').textContent();
      check('command echo uses input text',(await entry.locator('.terminal-prompt').textContent())==='contentops > '+raw);
      check('input ready after command',await input().inputValue()===''&&await input().evaluate(e=>e===document.activeElement));
      check('latest output scrolled into view',await page.locator('.playground-output').evaluate(e=>e.scrollHeight-e.scrollTop-e.clientHeight<3));
      if(!json)return {text,raw};
      const r=JSON.parse(text);check('simulation origin explicitly browser',r.environment==='browser'&&r.source==='browser_simulator');
      return r;
    };
    const reset=async()=>{await page.getByRole('button',{name:'重置数据',exact:true}).click();if(await page.locator('.reset-confirm').isVisible())await page.getByRole('button',{name:'确认重置',exact:true}).click();check('reset restores pending132',await pending()===132);};
    const rawMatch=async(container,r,label)=>{
      const details=container.locator(':scope > .raw-details');if(!await details.evaluate(e=>e.open))await details.locator(':scope > summary').click();
      check('real complete JSON '+label,JSON.stringify(JSON.parse(await details.locator('.json-view').textContent()))===JSON.stringify(r.result));
      check('real process exit '+label,(await container.locator(':scope > .statusline .exit').textContent())==='exit '+r.exit);
      if(r.stderr.trim())check('real stderr '+label,(await details.textContent()).includes(r.stderr.trim().replace(/\r\n/g,'\n')));await collect();
    };
    await page.goto(url);await page.locator('h1').waitFor();
    check('three main modules',await page.locator('nav a').count()===3);check('product still first',await page.locator('nav a[aria-current="page"]').getAttribute('href')==='#product');
    check('existing MVP scope remains',(await page.locator('main').innerText()).includes('2 周 MVP')&&(await page.locator('main').innerText()).includes('6 项 API'));
    await page.getByRole('link',{name:'打开 CLI 交互体验'}).click();await page.waitForSelector('#terminal-input');
    check('required browser-only label',(await page.locator('.playground-title').textContent()).includes('浏览器模拟环境 · 不调用 Java 或真实后台'));
    check('full original dataset',await pending()===132&&(await page.locator('[data-summary="total"]').textContent())==='300');
    check('initial ct4 snapshot',await summaryReview()==='pending'&&(await page.locator('[data-summary="tags"]').textContent())==='恋爱、校园、武侠');
    check('real evidence initially hidden',!await page.locator('#java-evidence').evaluate(e=>e.open));
    await snap('desktop-initial');
    const beforeQuick=await commands().count();await page.getByRole('button',{name:'填入模拟执行命令',exact:true}).click();
    const filled=await input().inputValue();check('write shortcut only fills',filled.endsWith('--execute --yes')&&await commands().count()===beforeQuick&&await pending()===132);
    await page.getByRole('button',{name:'复制网页命令',exact:true}).click();check('native input clipboard',await page.evaluate(()=>navigator.clipboard.readText())===filled);
    await page.getByRole('button',{name:'查看帮助',exact:true}).click();check('help shortcut only fills',await input().inputValue()==='help'&&await commands().count()===beforeQuick);
    await page.getByRole('button',{name:'运行',exact:true}).click();
    check('help output',(await commands().last().textContent()).includes('网页命令')&&(await commands().last().textContent()).includes('不支持管道'));
    const list=await run('content list --review-status pending',{json:false,click:true});check('human-readable query',list.text.includes('132')&&list.text.includes('ct_000004'));
    let r=await run('content list');check('all300/page20',r.data.total===300&&r.data.items.length===20&&r.data.page_size===20);
    r=await run('content list --review-status pending --page 7');check('page7 last12',r.data.total===132&&r.data.items.length===12);
    r=await run('content list --review-status pending --content-id ct_000004');check('AND exact id',r.data.total===1&&r.data.items[0].content_id==='ct_000004');
    r=await run('content list --review-status approved --content-id ct_000004');check('AND excludes mismatched state',r.data.total===0);
    r=await run('content get ct_000004');check('complete current detail matches seed',JSON.stringify(r.data)===JSON.stringify(originalSeed.contents[3]));const sessionBefore=r;
    r=await run('content history ct_000004');check('initial browser audit empty',r.data.items.length===0);
    r=await run('tags list');check('active23',r.data.total===23&&r.data.items.every(t=>t.status==='active'));
    r=await run('tags list --status all');check('all25/deprecated2',r.data.total===25&&r.data.items.filter(t=>t.status==='deprecated').length===2);
    const previousHistory='--output json tags list --status all';await input().fill('未发送草稿');await input().press('ArrowUp');check('ArrowUp latest',await input().inputValue()===previousHistory);
    await input().press('ArrowUp');check('ArrowUp earlier',await input().inputValue()==='--output json tags list');await input().press('ArrowDown');await input().press('ArrowDown');check('ArrowDown restores draft',await input().inputValue()==='未发送草稿');
    const beforeIme=await commands().count();await input().dispatchEvent('keydown',{key:'Enter',isComposing:true});check('IME confirmation does not submit',await commands().count()===beforeIme);
    const base='content process ct_000004 --action approve --reason "中文 English 审核理由" --add "悬疑"';
    r=await run(base);check('preview no writes',r.status==='previewed'&&Object.values(r.data.steps).every(s=>s.write==='not_sent')&&await pending()===132&&await summaryReview()==='pending');const sessionPreview=r;
    for(const bad of [base+' --execute',base+' --yes','content review ct_000004 --action reject','content review ct_000004 --action reject --reason "  " --execute --yes',
      'content process ct_000004 --action approve --add 不存在 --execute --yes','content process ct_000004 --action approve --add 旧版-悬疑 --execute --yes',
      'content tags update ct_000004 --remove 恋爱','content list --page 1 --page 2','content list --bogus x','content list --env api','content get','content review ct_000004','content tags update ct_000004','content list --page 0',
      'content list | whoami','content review ct_000004 --action "approve']){
      r=await run(bad);check('bad command rejected without write',r.status==='rejected'&&r.exit_code===2&&await pending()===132&&await summaryReview()==='pending');
    }
    r=await run('content get ct_999999');check('unknown ID read failure',r.status==='failed'&&r.exit_code===3);
    await run('content get ct_000004');
    await input().fill('clear');await input().press('Enter');
    const executionText=await run(base+' --execute --yes',{json:false});check('default process output explains actual changes',executionText.text.includes('审核成功')&&executionText.text.includes('标签已更新并核对'));
    check('summary reflects approved and four tags',await pending()===131&&await summaryReview()==='approved'&&(await page.locator('[data-summary="tags"]').textContent())==='恋爱、校园、武侠、悬疑');
    await snap('desktop-after-execute');
    r=await run('content history ct_000004');check('browser-generated audit',r.data.items.length===1&&r.data.items[0].reason==='中文 English 审核理由'&&r.data.items[0].operator_id==='op_browser_demo');const sessionHistory=r;
    r=await run(base+' --execute --yes');check('repeat review rejected',r.status==='rejected'&&r.error.code==='REVIEW_NOT_PENDING');
    r=await run('content tags update ct_000004 --add 悬疑 --execute --yes');check('duplicate tag no_change',r.status==='no_change'&&r.data.steps.tags.write==='skipped');
    await run('contentops content get ct_000004');
    await navigate('technical');check('HTTP future remains',(await page.locator('.future-adapter').textContent()).includes('待实现'));
    check('Agent remains design',(await page.locator('.agent-summary h2').textContent()).includes('后续设计'));await navigate('demo');
    check('route change preserves browser business state',await pending()===131&&await summaryReview()==='approved');
    await input().fill('clear');await input().press('Enter');check('clear only clears output',await commands().count()===0&&await page.locator('.terminal-entry').count()===0&&await pending()===131);
    r=await run('content get ct_000004');check('state remains after clear',r.data.review_status==='approved'&&r.data.tags.includes('悬疑'));
    fs.writeFileSync(path.join(out,'browser-session.json'),JSON.stringify({captured_at:new Date().toISOString(),source:'browser_simulator',
      scope:'Actual browser-input simulation, not Java evidence. Includes rejected invalid/repeated commands and a no_change check; one successful process. Clear only removed display.',
      before:sessionBefore,preview:sessionPreview,execution:{command:base+' --execute --yes',text:executionText.text},
      after:r,history:sessionHistory,pending_after:await pending()},null,2)+'\n');
    await page.getByRole('button',{name:'重置数据',exact:true}).click();check('dirty reset confirmation appears',await page.locator('.reset-confirm').isVisible());
    await page.getByRole('button',{name:'取消',exact:true}).click();check('cancel reset preserves state',await pending()===131);
    await reset();r=await run('content history ct_000004');check('reset removes browser audit',r.data.items.length===0);
    check('reset restores original tags',(await page.locator('[data-summary="tags"]').textContent())==='恋爱、校园、武侠');
    r=await run(base+' --execute --yes');check('JSON process succeeded and ordered',r.status==='succeeded'&&JSON.stringify(r.data.events)===JSON.stringify(['review:submitted','review:verified','tags:submitted','tags:verified']));
    check('no simulated backend API counts',r.data.steps.review.api_result===null&&r.data.steps.tags.api_result===null);await reset();
    const payload='<img src=x onerror="window.__playgroundXss=1">';
    r=await run('content review ct_000004 --action reject --reason '+JSON.stringify(payload)+' --execute --yes');
    check('reject simulated with quote parsing',r.status==='succeeded'&&r.data.observed.review_status==='rejected');
    r=await run('content history ct_000004');check('literal untrusted reason preserved',r.data.items[0].reason===payload);
    check('no HTML/script injection',await page.locator('.playground-output img,.playground-output script,.playground-output iframe').count()===0&&await page.evaluate(()=>window.__playgroundXss===undefined));
    await page.getByRole('button',{name:'查看故障演示',exact:true}).click();
    check('fault shortcut opens independent real records',await page.locator('#java-evidence').evaluate(e=>e.open)&&await page.locator('#developer-evidence').evaluate(e=>e.open));
    check('Java case stays approved despite browser rejection',(await page.locator('.case-comparison > div').nth(1).textContent()).includes('approved')&&await summaryReview()==='rejected');
    for(const [name,f]of Object.entries(D.faults)){
      await page.locator('#fault-select').selectOption(name);await rawMatch(page.locator('#developer-evidence .two-col > section'),f.process,name);
      check('reading Java faults does not change browser state',await summaryReview()==='rejected'&&await pending()===131);
    }
    await page.locator('#fault-select').selectOption('tags-reject-before-write');await page.locator('[data-recovery="true"]').click();
    await rawMatch(page.locator('#developer-evidence .two-col > section'),D.faults['tags-reject-before-write'].recovery,'Java tag-only recovery');
    await page.locator('[data-recovery="false"]').click();check('original Java partial intact',(await page.locator('#developer-evidence .status').textContent())==='partial');
    await close('developer-evidence');await open('case-records');
    for(const key of ['10-process-preview','13-process-execute','14-after-detail'])await rawMatch(page.locator(`#case-records > [data-record-key="${key}"]`),D.task[key],key);
    check('real Java JSON stays mock',D.task['13-process-execute'].result.environment==='mock');
    await open('all-task-records');for(const key of Object.keys(D.task).filter(k=>!['10-process-preview','13-process-execute','14-after-detail'].includes(k)))await rawMatch(page.locator(`#all-task-records > [data-record-key="${key}"]`),D.task[key],key);
    await close('case-records');await close('java-evidence');
    await open('jar-examples');
    const keys=['03-pending-page1-json','05-candidate-ct000004-detail','07-candidate-ct000004-history','08-active-tags',null,null,'10-process-preview'];
    for(let i=0;i<7;i++){
      await page.locator(`[data-command="${i}"]`).click();const panel=page.locator('#jar-examples .example-panel');
      const command=await panel.locator('[data-copy]').getAttribute('data-copy');await panel.locator('[data-copy]').click();
      check('actual JAR command clipboard '+i,command.startsWith('java -jar ./target/contentops.jar ')&&await page.evaluate(()=>navigator.clipboard.readText())===command);
      await open('command-detail');if(keys[i])await rawMatch(page.locator('#command-detail'),D.task[keys[i]],'JAR command '+i);
      else check('standalone JAR example not faked '+i,(await panel.textContent()).includes('命令示例'));
      await collect();await close('command-detail');
    }
    await close('jar-examples');
    check('evidence browsing retained simulation',await summaryReview()==='rejected');
    await page.reload();await page.waitForSelector('#terminal-input');check('refresh resets simulation and input history',await pending()===132&&await summaryReview()==='pending'&&await commands().count()===0);
    await input().fill('草稿');await input().press('ArrowUp');check('fresh history empty',await input().inputValue()==='草稿');
    await page.getByRole('button',{name:'查看示例内容',exact:true}).click();const copyText=await input().inputValue();
    await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined}));await page.getByRole('button',{name:'复制网页命令',exact:true}).click();check('input copy fallback',(await page.locator('.playground-status').textContent()).includes('兼容'));
    await page.evaluate(()=>document.execCommand=()=>false);await page.getByRole('button',{name:'复制网页命令',exact:true}).click();
    check('manual copy fallback',await page.locator('.playground .manual-copy').isVisible()&&await page.locator('.playground .manual-copy').inputValue()===copyText);
    check('manual selection complete',await page.locator('.playground .manual-copy').evaluate(e=>e.selectionStart===0&&e.selectionEnd===e.value.length));await page.keyboard.press('Control+c');
    await input().focus();
    await page.evaluate(()=>{
      const field=document.querySelector('#terminal-input'),form=document.querySelector('.playground-form');
      for(let i=0;i<85;i++){field.value='help';form.requestSubmit();}
    });
    check('bounded terminal output',await page.locator('.terminal-entry').count()===80&&await pending()===132);
    await page.getByRole('button',{name:'重置数据',exact:true}).click();
    check('clean reset needs no confirmation',!await page.locator('.reset-confirm').isVisible());
    for(const viewport of [{width:1440,height:1000},{width:1366,height:768},{width:1024,height:768},{width:390,height:844}]){
      await page.setViewportSize(viewport);
      for(const route of ['product','demo','technical']){
        await navigate(route);await collect();check(`route/layout ${viewport.width} ${route}`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        check(`one h1 ${viewport.width} ${route}`,await page.locator('h1').count()===1);
      }
      await navigate('demo');
      await run('content get ct_000004');check(`terminal font ${viewport.width}`,await page.locator('.terminal-response').last().evaluate(e=>parseFloat(getComputedStyle(e).fontSize)>=14));
      check(`input and run fit ${viewport.width}`,await input().isVisible()&&await page.getByRole('button',{name:'运行',exact:true}).isVisible());
      await run('content list --review-status pending');check(`long JSON layout ${viewport.width}`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await input().fill('clear');await input().press('Enter');await run('content get ct_000004',{json:false});
      check(`input within initial viewport ${viewport.width}`,await input().evaluate(e=>e.getBoundingClientRect().bottom<=innerHeight));
      if(viewport.width===1366)await snap('laptop-terminal');
      if(viewport.width===390){await snap('narrow-terminal',true);await open('java-evidence');await open('developer-evidence');await collect();check('narrow real evidence fits',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await close('java-evidence');}
    }
    await navigate('technical');for(const id of ['technical-notes','agent-notes','original-materials']){await open(id);await collect();}
    for(const a of await page.locator('a[href$=".md"]').all())check('raw Markdown clearly labeled',(await a.textContent()).includes('原始 Markdown 文件'));
    for(const href of links)check('local source '+href,!/^https?:/.test(href)&&fs.existsSync(path.resolve(root,'demo',decodeURI(href.split('#')[0]))));
    const previous=JSON.parse(fs.readFileSync(path.join(root,'evidence/demo-simplified/browser-results.json'),'utf8')).checks.filter(c=>c.name.startsWith('local source ')).map(c=>c.name.slice(13));
    const mapBox={window:{}};vm.runInNewContext(fs.readFileSync(path.join(root,'demo/docs/links.js'),'utf8'),mapBox);
    const retained=p=>links.has(p)||p.startsWith('../')&&mapBox.window.REVIEW_DOCUMENTS[p.slice(3)]&&links.has('docs/'+mapBox.window.REVIEW_DOCUMENTS[p.slice(3)]);
    check('previous77 source paths retained or mapped to HTML',previous.every(retained),JSON.stringify(previous.filter(p=>!retained(p))));
    check('no browser dialogs or XSS',dialogs.length===0&&await page.evaluate(()=>window.__playgroundXss===undefined));
    check('console healthy',errors.length===0,JSON.stringify(errors));check('offline file resources only',requests.every(r=>r.startsWith('file:')),JSON.stringify(requests));
    check('real evidence object unchanged',await page.evaluate(()=>JSON.stringify(window.DEMO_DATA))===JSON.stringify(D));
    check('global seed object unchanged',await page.evaluate(()=>JSON.stringify(window.PLAYGROUND_SEED.data))===JSON.stringify(originalSeed));
    check('no browser business persistence',await page.evaluate(()=>localStorage.length===0&&sessionStorage.length===0));
    const report={captured_at:new Date().toISOString(),passed:true,check_count:checks.length,browser:browser.version(),
      playwright:require((moduleArg<0?'playwright':process.argv[moduleArg+1])+'/package.json').version,url,offline:true,
      browser_plugin:'Absent; used existing local Playwright + Chrome for offline file:// checks.',viewports:['1440x1000','1366x768','1024x768','390x844'],
      unique_source_links:links.size,console_errors:errors,dialogs,requests,checks};
    fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify(report,null,2)+'\n');
    console.log(`PASS: ${checks.length} checks; memory-only terminal; ${links.size} evidence links; Chrome ${browser.version()}.`);
  }finally{await browser.close();}
}
run().catch(e=>{fs.writeFileSync(path.join(root,'evidence/demo-docs/playground-regression/failure-'+Date.now()+'.json'),JSON.stringify({at:new Date().toISOString(),error:e.stack,passed_checks:checks.length},null,2)+'\n');console.error(e);process.exitCode=1;});
