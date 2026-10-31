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
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-CN',permissions:['clipboard-read','clipboard-write']});
    await context.setOffline(true);
    const page=await context.newPage();
    const navigate=async route=>{
      await page.locator(`nav a[href="#${route}"]`).click();
      await page.waitForFunction(key=>document.querySelector('nav a[aria-current="page"]')?.getAttribute('href')==='#'+key,route);
    };
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(['error','warning'].includes(m.type()))errors.push(m.type()+': '+m.text());});
    page.on('request',r=>requests.push(r.url()));
    const url=pathToFileURL(path.join(root,'demo/index.html')).href;
    await page.goto(url);
    await page.locator('h1').waitFor();
    check('identity / local file',page.url()===url&&(await page.title()).includes('内容运营 CLI'));
    check('meaningful first screen',(await page.locator('h1').textContent()).includes('一次审核'));
    check('default preview / no execution',(await page.locator('.status').textContent())==='previewed');
    await page.screenshot({path:path.join(__dirname,'desktop-task2.png')});
    await page.setViewportSize({width:1505,height:1045});
    await page.screenshot({path:path.join(__dirname,'concept-size-task2.png')});
    await page.setViewportSize({width:1440,height:1000});
    const raw=page.locator('main > .two-col > section .raw-details');
    await raw.locator('summary').click();
    const preview=JSON.parse(await raw.locator('.json-view').textContent());
    check('preview JSON full fields',preview.data.steps.review.write==='not_sent'&&preview.data.steps.tags.write==='not_sent'&&preview.exit_code===0);
    await raw.locator('summary').click();
    for(let i=0;i<5;i++){
      await page.locator(`[data-step="${i}"]`).click();
      check('task step '+(i+1),await page.locator(`[data-step="${i}"]`).getAttribute('aria-pressed')==='true');
      const expected=['succeeded','succeeded','previewed','succeeded','succeeded'][i];
      check('task step result '+(i+1),await page.locator('.status').textContent()===expected);
      if(i===0){check('queue 20 actual rows',await page.locator('.queue-table tbody tr').count()===20);check('ct4 actual second row',(await page.locator('.queue-table tbody tr').nth(1).textContent()).includes('ct_000004'));}
    }
    await page.getByRole('button',{name:'操作后',exact:true}).click();
    check('after snapshot approved and four tags',(await page.locator('.inspector .state-label').textContent())==='approved'&&await page.locator('.inspector .tag').count()===4);
    await page.getByRole('button',{name:'操作前',exact:true}).click();
    check('before snapshot pending and three tags',(await page.locator('.inspector .state-label').textContent())==='pending'&&await page.locator('.inspector .tag').count()===3);
    for(const route of ['overview','commands','task2','faults','agent']){
      await navigate(route);
      check('navigation '+route,await page.locator('nav a[aria-current="page"]').getAttribute('href')==='#'+route);
    }
    await navigate('commands');
    for(let i=0;i<7;i++){
      await page.locator(`[data-command="${i}"]`).click();
      check('command '+i+' selection',await page.locator(`[data-command="${i}"]`).getAttribute('aria-pressed')==='true');
      const copy=page.getByRole('button',{name:'复制命令',exact:true});
      const command=await copy.getAttribute('data-copy');
      check('command '+i+' valid prefix',command.startsWith('java -jar ./target/contentops.jar --env mock --output json'));
      if(i===4||i===5)check('independent templates are labeled unexecuted',(await page.locator('main').textContent()).includes('本页没有执行此命令'));
    }
    const copyButton=page.getByRole('button',{name:'复制命令',exact:true});
    const command=await copyButton.getAttribute('data-copy');
    await copyButton.click();
    check('native clipboard copy',(await page.evaluate(()=>navigator.clipboard.readText()))===command);
    check('copy does not execute',(await page.locator('#toast').textContent()).includes('没有执行'));
    // Explicitly force both fallback branches. These are test-only browser overrides.
    await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined}));
    await copyButton.click();
    check('compatibility copy fallback',(await page.locator('#toast').textContent()).includes('兼容模式'));
    await page.evaluate(()=>document.execCommand=()=>false);
    await copyButton.click();
    check('manual copy fallback visible',await page.locator('textarea.manual-copy').isVisible());
    check('manual copy complete selection',await page.locator('textarea.manual-copy').evaluate(e=>e.value.length>0&&e.selectionStart===0&&e.selectionEnd===e.value.length));
    await page.keyboard.press('Control+c');
    check('manual fallback has clear instructions',(await page.locator('#toast').textContent()).includes('Ctrl+C'));
    await page.reload();
    await navigate('faults');
    for(const [name,f]of Object.entries(D.faults)){
      await page.locator('#fault-select').selectOption(name);
      check('fault status '+name,(await page.locator('.status').textContent())===f.process.result.status);
      check('fault exit '+name,(await page.locator('.exit').textContent())==='exit '+f.process.exit);
      const details=page.locator('section .raw-details');
      await details.locator('summary').click();
      const actual=JSON.parse(await details.locator('.json-view').textContent());
      check('fault JSON '+name,JSON.stringify(actual)===JSON.stringify(f.process.result));
      check('steps '+name,(await page.locator('.steps-table').textContent()).includes(f.process.result.data.steps.review.write));
      check('disk facts '+name,(await page.locator('.inspector').textContent()).includes('revision '+f.facts.disk_revision_after_process));
    }
    await page.locator('#fault-select').selectOption('tags-reject-before-write');
    await page.getByRole('button',{name:'查看独立补标签回放'}).click();
    check('recovery result real succeeded',(await page.locator('.status').textContent())==='succeeded'&&(await page.locator('.exit').textContent())==='exit 0');
    check('recovery never re-audits',(await page.locator('.steps-table').textContent()).includes('tags')&&!(await page.locator('.steps-table tbody').textContent()).includes('review'));
    await page.getByRole('button',{name:'查看部分失败',exact:true}).click();
    check('original partial unchanged',(await page.locator('.status').textContent())==='partial');
    await page.locator('#fault-select').selectOption('tags-commit-response-lost');
    await page.screenshot({path:path.join(__dirname,'desktop-unknown.png')});
    await navigate('agent');
    for(const k of ['current','future','upstream']){
      await page.locator(`[data-capability="${k}"]`).click();
      check('Agent capability '+k,await page.locator(`[data-capability="${k}"]`).getAttribute('aria-pressed')==='true');
      check('Agent always marked future',(await page.locator('.sourcebar').textContent()).includes('未实现 / 未执行 100 条'));
    }
    // Native buttons remain keyboard-operable after redraw.
    await page.locator('[data-capability="future"]').focus();
    await page.keyboard.press('Enter');
    check('keyboard Enter changes capability',await page.locator('[data-capability="future"]').getAttribute('aria-pressed')==='true');
    check('focus restored after rendering',await page.evaluate(()=>document.activeElement.dataset.capability==='future'));
    await page.keyboard.press('Tab');
    check('keyboard Tab reaches next control',await page.evaluate(()=>document.activeElement.dataset.capability==='upstream'));
    const links=new Set();
    const captureLinks=async()=>{
      for(const href of await page.locator('a[href]').evaluateAll(a=>a.map(x=>x.getAttribute('href'))))if(href&&!href.startsWith('#'))links.add(href);
      check('no accidental undefined text',!(await page.locator('main').textContent()).includes('undefined'));
    };
    for(const route of ['overview','commands','task2','faults','agent']){
      await navigate(route);
      await captureLinks();
    }
    await navigate('task2');
    for(let i=0;i<5;i++){await page.locator(`[data-step="${i}"]`).click();await captureLinks();}
    await page.locator('[data-snapshot="after"]').click();await captureLinks();
    await navigate('commands');
    for(let i=0;i<7;i++){await page.locator(`[data-command="${i}"]`).click();await captureLinks();}
    await navigate('faults');
    for(const name of Object.keys(D.faults)){await page.locator('#fault-select').selectOption(name);await captureLinks();}
    await page.locator('#fault-select').selectOption('tags-reject-before-write');
    await page.locator('[data-recovery="true"]').click();await captureLinks();
    for(const href of links){check('local link '+href,!/^https?:/.test(href)&&fs.existsSync(path.resolve(root,'demo',decodeURI(href.split('#')[0]))));}
    for(const viewport of [{width:1366,height:768},{width:1024,height:768},{width:390,height:844}]){
      await page.setViewportSize(viewport);
      for(const route of ['overview','commands','task2','faults','agent']){
        await navigate(route);
        check(`no document overflow ${viewport.width} ${route}`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        check(`visible heading ${viewport.width} ${route}`,await page.locator('h1').isVisible());
        if(route==='commands')for(let i=0;i<7;i++){
          await page.locator(`[data-command="${i}"]`).click();
          check(`command layout ${viewport.width} ${i}`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        }
        if(route==='faults')for(const name of Object.keys(D.faults)){
          await page.locator('#fault-select').selectOption(name);
          check(`fault layout ${viewport.width} ${name}`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        }
      }
      await navigate('task2');
      await page.locator('[data-step="2"]').click();
      await page.locator('[data-snapshot="before"]').click();
      if(viewport.width===1366)await page.screenshot({path:path.join(__dirname,'laptop-task2.png')});
      if(viewport.width===390)await page.screenshot({path:path.join(__dirname,'narrow-task2.png'),fullPage:true});
    }
    check('console healthy',errors.length===0,JSON.stringify(errors));
    check('offline resources / no network',requests.every(u=>u.startsWith('file:')),JSON.stringify(requests));
    check('no overlay',await page.locator('vite-error-overlay,nextjs-portal').count()===0);
    const sizes=await page.locator('h1, button').evaluateAll(els=>els.slice(0,10).map(e=>({text:e.textContent.trim(),size:getComputedStyle(e).fontSize,lineHeight:getComputedStyle(e).lineHeight})));
    const report={captured_at:new Date().toISOString(),passed:true,check_count:checks.length,
      browser:browser.version(),channel:'local Chrome / headless / Playwright',playwright:require((moduleArg<0?'playwright':process.argv[moduleArg+1])+'/package.json').version,
      url,offline:true,viewports:['1440x1000','1505x1045','1366x768','1024x768','390x844'],
      browser_plugin:'Absent; Browser plugin not available. MCP Playwright file navigation was blocked, so used existing local Playwright + Chrome.',
      console_errors:errors,resource_requests:requests,computed_mobile_typography:sizes,checks};
    fs.writeFileSync(path.join(__dirname,'browser-results.json'),JSON.stringify(report,null,2)+'\n');
    console.log(`PASS: ${checks.length} assertions, local file offline, ${browser.version()}, zero console errors.`);
  }finally{await browser.close();}
}
run().catch(e=>{fs.writeFileSync(path.join(__dirname,'last-failure.json'),JSON.stringify({at:new Date().toISOString(),error:e.stack,passed_checks:checks.length},null,2)+'\n');console.error(e);process.exitCode=1;});
