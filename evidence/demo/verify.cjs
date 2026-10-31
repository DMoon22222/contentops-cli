// Review edition (three routes). Writes only evidence/demo-review/; S6 reports stay immutable.
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
  const out=path.join(root,'evidence/demo-review');
  const integrity=JSON.parse(fs.readFileSync(path.join(out,'integrity.json'),'utf8'));
  check('embedded payload unchanged since review baseline',sha(path.join(root,'demo/data.js'))===integrity.data_js_sha256);
  const planDoc=fs.readFileSync(path.join(root,'docs/02-第一阶段MVP与CLI产品方案.md'),'utf8');
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-CN',permissions:['clipboard-read','clipboard-write']});
    await context.setOffline(true);
    const page=await context.newPage();
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(['error','warning'].includes(m.type()))errors.push(m.type()+': '+m.text());});
    page.on('request',r=>requests.push(r.url()));
    const url=pathToFileURL(path.join(root,'demo/index.html')).href;
    const links=new Set();
    const collect=async()=>{
      for(const h of await page.locator('a[href]').evaluateAll(els=>els.map(e=>e.getAttribute('href'))))if(h&&!h.startsWith('#'))links.add(h);
      check('no accidental undefined text',!(await page.locator('main').textContent()).includes('undefined'));
    };
    const navigate=async route=>{
      await page.locator(`nav a[href="#${route}"]`).click();
      await page.waitForFunction(key=>document.querySelector('nav a[aria-current="page"]')?.getAttribute('href')==='#'+key,route);
    };
    const open=async id=>{const el=page.locator('#'+id);if(!await el.evaluate(e=>e.open))await el.locator(':scope > summary').click();return el;};
    const close=async id=>{const el=page.locator('#'+id);if(await el.evaluate(e=>e.open))await el.locator(':scope > summary').click();};
    const primary=()=>page.locator('#walkthrough .workflow-primary');
    const jsonMatches=async(container,record,label)=>{
      const details=container.locator(':scope > .raw-details');
      if(!await details.evaluate(e=>e.open))await details.locator(':scope > summary').click();
      const actual=JSON.parse(await details.locator('.json-view').textContent());
      check('complete JSON '+label,JSON.stringify(actual)===JSON.stringify(record.result));
      check('actual exit '+label,(await container.locator(':scope > .statusline .exit').textContent())==='exit '+record.exit);
      if(record.stderr.trim())check('stderr preserved '+label,(await details.textContent()).includes(record.stderr.trim().replace(/\r\n/g,'\n')));
      await collect();
    };
    await page.goto(url);
    await page.locator('h1').waitFor();
    check('local file page identity',page.url()===url&&(await page.title()).includes('CLI 评审台'));
    check('three main routes',await page.locator('nav a').count()===3);
    check('default product review',await page.locator('nav a[aria-current="page"]').getAttribute('href')==='#product');
    check('first screen product positioning',(await page.locator('h1').textContent()).includes('封装为可复用的 CLI'));
    for(const fact of ['1 名 Java 后端','2 周 MVP','6 项现有 API'])check('resource constraint '+fact,(await page.locator('.constraints').textContent()).includes(fact));
    check('planned vs implemented scopes',(await page.locator('.scope-plan').textContent()).includes('两周 MVP')&&(await page.locator('.scope-now').textContent()).includes('48 小时'));
    check('HTTP/remove/set/human confirm remain unimplemented',(await page.locator('.scope-now').textContent()).includes('HTTP、标签 remove/set、人工输入 ID 确认及完整筛选尚未实现'));
    check('five workflow stages',await page.locator('.workflow-strip li').count()===5);
    await page.screenshot({path:path.join(out,'desktop-product.png')});
    await page.setViewportSize({width:1505,height:1045});
    await page.screenshot({path:path.join(out,'concept-size-product.png')});
    await page.setViewportSize({width:1440,height:1000});
    await open('api-scope');
    check('six APIs and combination row',await page.locator('#api-scope tbody tr').count()===7);
    await open('full-plan');
    check('all ten days retained',await page.locator('.day-plan tbody tr').count()===10);
    for(const row of await page.locator('.day-plan tbody tr').all()){
      const cells=await row.locator('td').allTextContents();
      check('schedule verbatim '+cells[0],planDoc.includes('| '+cells[0]+' | '+cells[1]+' |'));
    }
    await collect();
    await close('full-plan');await close('api-scope');
    await page.getByRole('link',{name:'体验一次 CLI 操作'}).click();
    await page.waitForFunction(()=>document.querySelector('nav a[aria-current="page"]')?.hash==='#demo');
    check('review flow CTA enters demo',await page.locator('#walkthrough').isVisible());
    check('auxiliary command reference collapsed',!await page.locator('#command-reference').evaluate(e=>e.open));
    check('all fault evidence collapsed',!await page.locator('#all-faults').evaluate(e=>e.open));
    check('initial queue full page',await page.locator('.queue-table tbody tr').count()===20);
    check('initial 132 and 20 actual results',(await page.locator('.queue-summary').textContent()).includes('132')&&(await page.locator('.queue-summary').textContent()).includes('20'));
    check('real target is second row',(await page.locator('.queue-table tbody tr').nth(1).textContent()).includes('ct_000004'));
    check('previous disabled at start',await page.locator('[data-move="-1"]').isDisabled());
    await jsonMatches(primary(),D.task['03-pending-page1-json'],'initial queue');
    await page.locator('[data-select-content="ct_000004"]').click();
    check('select target moves to detail',await page.locator('[data-step="1"]').getAttribute('aria-pressed')==='true');
    check('actual title/body/tags',(await page.locator('#walkthrough .inspector').textContent()).includes(D.task['05-candidate-ct000004-detail'].result.data.body)&&await page.locator('#walkthrough .inspector .tag').count()===3);
    await page.locator('[data-step="0"]').click();
    check('target stays highlighted',await page.locator('.queue-table tr.selected').count()===1);
    await page.locator('[data-step="1"]').click();
    await jsonMatches(primary(),D.task['05-candidate-ct000004-detail'],'before detail');
    for(let i=2;i<5;i++){
      await page.locator('[data-move="1"]').click();
      check('next step '+i,await page.locator(`[data-step="${i}"]`).getAttribute('aria-pressed')==='true');
      if(i===2){
        await jsonMatches(primary(),D.task['10-process-preview'],'default preview');
        check('not_sent review and tags',(await primary().locator('.steps-table').textContent()).match(/not_sent/g).length===2);
        check('preview plan labels target uncommitted',(await page.locator('.plan-panel').textContent()).includes('计划，尚未写入'));
        await primary().locator(':scope > .raw-details > summary').click();
        await page.locator('main').focus();await page.evaluate(()=>window.scrollTo(0,0));
        await page.screenshot({path:path.join(out,'desktop-preview.png')});
        await page.setViewportSize({width:1505,height:1045});
        await page.screenshot({path:path.join(out,'concept-size-preview.png')});
        await page.setViewportSize({width:1440,height:1000});
      }
      if(i===3){
        check('execution result initially explicit disclosure',await primary().locator(':scope > .statusline').count()===0);
        check('execution command includes both permissions',(await primary().locator('[data-copy]').getAttribute('data-copy')).endsWith('--execute --yes'));
        await page.locator('[data-show-execution]').click();
        await jsonMatches(primary(),D.task['13-process-execute'],'recorded execution');
        check('two acknowledged matched steps',(await primary().locator('.steps-table').textContent()).match(/acknowledged/g).length===2&&(await primary().locator('.steps-table').textContent()).match(/matched/g).length===2);
      }
      if(i===4){
        await jsonMatches(primary(),D.task['14-after-detail'],'new JVM readback');
        check('side by side comparison states',(await page.locator('.comparison-grid').textContent()).includes('pending')&&(await page.locator('.comparison-grid').textContent()).includes('approved'));
        check('comparison retains original tags then suspense',await page.locator('.comparison-grid > div').nth(0).locator('.tag').count()===3&&await page.locator('.comparison-grid > div').nth(1).locator('.tag').count()===4);
        check('business metrics 132 to131/history0to1/revision2',(await page.locator('.metrics').textContent()).includes('132 → 131')&&(await page.locator('.metrics').textContent()).includes('0 → 1')&&(await page.locator('.metrics').textContent()).includes('revision 2'));
        check('next disabled at end',await page.locator('[data-move="1"]').isDisabled());
        await primary().locator(':scope > .raw-details > summary').click();
        await page.locator('main').focus();await page.evaluate(()=>window.scrollTo(0,0));
        await page.screenshot({path:path.join(out,'desktop-comparison.png')});
      }
    }
    await page.locator('[data-move="-1"]').click();
    check('previous step works',await page.locator('[data-step="3"]').getAttribute('aria-pressed')==='true');
    await page.locator('[data-step="4"]').click();
    for(const snapshot of ['after','before']){
      await page.locator(`[data-snapshot="${snapshot}"]`).click();
      check('snapshot '+snapshot,(await page.locator('#walkthrough .inspector .state-label').textContent())===(snapshot==='after'?'approved':'pending'));
      check('snapshot tags '+snapshot,await page.locator('#walkthrough .inspector .tag').count()===(snapshot==='after'?4:3));
    }
    await open('command-reference');
    check('process default in command reference',await page.locator('[data-command="6"]').getAttribute('aria-pressed')==='true');
    for(let i=0;i<7;i++){
      await page.locator(`[data-command="${i}"]`).click();
      check('command reference remains open '+i,await page.locator('#command-reference').evaluate(e=>e.open));
      const scope=page.locator('#command-reference .command-layout > section');
      const button=scope.locator('[data-copy]');const cmd=await button.getAttribute('data-copy');
      check('complete Java command '+i,cmd.startsWith('java -jar ./target/contentops.jar --env mock --output json'));
      await button.click();check('native clipboard roundtrip '+i,await page.evaluate(()=>navigator.clipboard.readText())===cmd);
      if([0,1,2,3,6].includes(i)){
        const key=['03-pending-page1-json','05-candidate-ct000004-detail','07-candidate-ct000004-history','08-active-tags',null,null,'10-process-preview'][i];
        await jsonMatches(scope,D.task[key],'command '+i);
      }else check('unexecuted template and structure '+i,(await scope.textContent()).includes('本页没有执行此命令')&&(await scope.textContent()).includes('data.steps.'+(i===4?'review':'tags')));
      await collect();
    }
    const copyButton=page.locator('#command-reference [data-copy]');
    await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined}));
    await copyButton.click();check('compatibility fallback',(await page.locator('#toast').textContent()).includes('兼容模式'));
    await page.evaluate(()=>document.execCommand=()=>false);
    await copyButton.click();check('manual copy available',await page.locator('.manual-copy').isVisible());
    check('manual full selection',await page.locator('.manual-copy').evaluate(e=>e.selectionStart===0&&e.selectionEnd===e.value.length&&e.value.length>0));
    await page.keyboard.press('Control+c');check('manual copy instructions',(await page.locator('#toast').textContent()).includes('Ctrl+C'));
    await page.reload();
    await page.locator('[data-step="2"]').click();
    const representatives={normal:D.task['13-process-execute'],partial:D.faults['tags-reject-before-write'].process,unknown:D.faults['tags-commit-response-lost'].process};
    for(const [name,record]of Object.entries(representatives)){
      await page.locator(`[data-outcome="${name}"]`).click();
      await jsonMatches(page.locator('.outcome-view'),record,'representative '+name);
      check('source split '+name,(await page.locator('.outcome-view .source-label').textContent()).includes(name==='normal'?'悬疑':'轻松'));
      check('representative never changes core preview',(await primary().locator('.status').textContent())==='previewed');
    }
    await open('all-faults');
    for(const [name,f]of Object.entries(D.faults)){
      await page.locator('#fault-select').selectOption(name);
      await jsonMatches(page.locator('#all-faults .two-col > section'),f.process,'S5 '+name);
      check('S5 disk revision '+name,(await page.locator('#all-faults .inspector').textContent()).includes('revision '+f.facts.disk_revision_after_process));
      check('all fault evidence stays open '+name,await page.locator('#all-faults').evaluate(e=>e.open));
    }
    await page.locator('[data-outcome="partial"]').click();
    await page.locator('[data-show-recovery]').click();
    await jsonMatches(page.locator('#all-faults .two-col > section'),D.faults['tags-reject-before-write'].recovery,'tag-only recovery');
    check('recovery tags only',!(await page.locator('#all-faults .steps-table tbody').textContent()).includes('review'));
    check('recovery history still one',(await page.locator('#all-faults .inspector').textContent()).includes('历史 1 条'));
    await page.locator('[data-recovery="false"]').click();
    check('original partial retained',(await page.locator('#all-faults .status').textContent())==='partial');
    await close('all-faults');
    await page.locator('main .page-actions a[href="#technical"]').click();
    await page.waitForFunction(()=>document.querySelector('nav a[aria-current="page"]')?.hash==='#technical');
    check('next review CTA technical',await page.locator('.architecture').isVisible());
    check('HTTP is visibly future',(await page.locator('.future-adapter').textContent()).includes('HTTP · 尚未实现'));
    check('five design choices',await page.locator('.technical-choices tbody tr').count()===5);
    for(const name of ['current','future','upstream']){
      await page.locator(`[data-capability="${name}"]`).click();
      check('Agent boundary '+name,await page.locator(`[data-capability="${name}"]`).getAttribute('aria-pressed')==='true');
      check('Agent always unexecuted',(await page.locator('.future-label').textContent()).includes('未执行'));
      await collect();
    }
    await open('technical-details');await collect();await close('technical-details');
    await page.locator('main').focus();await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:path.join(out,'desktop-technical.png'),fullPage:true});
    await page.locator('[data-capability="future"]').focus();await page.keyboard.press('Enter');
    check('keyboard Enter activates capability',await page.locator('[data-capability="future"]').getAttribute('aria-pressed')==='true');
    check('focus retained',await page.evaluate(()=>document.activeElement.dataset.capability==='future'));
    await page.keyboard.press('Tab');check('keyboard Tab next',await page.evaluate(()=>document.activeElement.dataset.capability==='upstream'));
    await navigate('demo');await page.locator('#command-reference > summary').focus();await page.keyboard.press('Enter');
    check('keyboard disclosure toggles',await page.locator('#command-reference').evaluate(e=>e.open));await close('command-reference');
    await page.locator('.skip-link').focus();await page.keyboard.press('Enter');
    await page.waitForFunction(()=>document.activeElement.id==='workspace');
    check('skip link keeps current review module',await page.locator('nav a[aria-current="page"]').getAttribute('href')==='#demo');
    check('skip link focuses main content',await page.locator('main').evaluate(e=>e===document.activeElement));
    for(const viewport of [{width:1440,height:1000},{width:1366,height:768},{width:1024,height:768},{width:390,height:844}]){
      await page.setViewportSize(viewport);
      for(const route of ['product','demo','technical']){
        await navigate(route);await collect();
        check(`main route ${viewport.width} ${route}`,await page.locator('nav a[aria-current="page"]').getAttribute('href')==='#'+route);
        check(`no page overflow ${viewport.width} ${route}`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        check(`single h1 ${viewport.width} ${route}`,await page.locator('h1').count()===1);
      }
      await navigate('demo');
      for(let i=0;i<5;i++){
        await page.locator(`[data-step="${i}"]`).click();
        check(`step layout ${viewport.width} ${i}`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      }
      await open('command-reference');
      for(let i=0;i<7;i++){
        await page.locator(`[data-command="${i}"]`).click();
        check(`command layout ${viewport.width} ${i}`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      }
      await close('command-reference');await open('all-faults');
      for(const name of Object.keys(D.faults)){
        await page.locator('#fault-select').selectOption(name);
        check(`fault layout ${viewport.width} ${name}`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        await collect();
      }
      await close('all-faults');await page.locator('[data-step="2"]').click();
      await page.locator('[data-outcome="normal"]').click();
      check(`readable command type ${viewport.width}`,await primary().locator('.terminal pre').first().evaluate(e=>parseFloat(getComputedStyle(e).fontSize)>=14));
      check(`prominent status type ${viewport.width}`,await primary().locator('.status').evaluate(e=>parseFloat(getComputedStyle(e).fontSize)>=22));
      await page.locator('main').focus();await page.evaluate(()=>window.scrollTo(0,0));
      if(viewport.width===1366)await page.screenshot({path:path.join(out,'laptop-preview.png')});
      if(viewport.width===390){
        await page.screenshot({path:path.join(out,'narrow-preview.png'),fullPage:true});
        await navigate('product');await page.screenshot({path:path.join(out,'narrow-product.png'),fullPage:true});
      }
    }
    for(const href of links)check('local source link '+href,!/^https?:/.test(href)&&fs.existsSync(path.resolve(root,'demo',decodeURI(href.split('#')[0]))));
    check('console healthy',errors.length===0,JSON.stringify(errors));
    check('file resources only while offline',requests.every(r=>r.startsWith('file:')),JSON.stringify(requests));
    check('no framework overlay',await page.locator('vite-error-overlay,nextjs-portal').count()===0);
    const unchanged=await page.evaluate(()=>JSON.stringify(window.DEMO_DATA));
    check('browser interactions do not mutate embedded evidence',unchanged===JSON.stringify(D));
    await page.emulateMedia({reducedMotion:'reduce'});
    check('larger type also with reduced motion',await page.evaluate(()=>getComputedStyle(document.body).fontSize==='16px'));
    const sizes=await page.locator('h1,.intro,.constraints strong').evaluateAll(els=>els.map(e=>({text:e.textContent,size:getComputedStyle(e).fontSize})));
    const report={captured_at:new Date().toISOString(),passed:true,check_count:checks.length,
      browser:browser.version(),playwright:require((moduleArg<0?'playwright':process.argv[moduleArg+1])+'/package.json').version,
      url,offline:true,viewports:['1440x1000','1505x1045','1366x768','1024x768','390x844'],
      browser_plugin:'Absent; Browser plugin not available. Existing MCP Playwright blocks file navigation; used existing local Playwright and Chrome.',
      console_errors:errors,requests,unique_source_links:links.size,computed_mobile_type:sizes,checks};
    fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify(report,null,2)+'\n');
    console.log(`PASS: ${checks.length} assertions; three review modules; ${links.size} links; offline file; Chrome ${browser.version()}.`);
  }finally{await browser.close();}
}
run().catch(e=>{
  const p=path.join(root,'evidence/demo-review','failure-'+Date.now()+'.json');
  fs.writeFileSync(p,JSON.stringify({at:new Date().toISOString(),error:e.stack,passed_checks:checks.length},null,2)+'\n');
  console.error(e);process.exitCode=1;
});
