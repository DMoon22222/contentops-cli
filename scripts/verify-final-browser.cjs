'use strict';
// Development-only offline Chrome acceptance; never writes product files or historical evidence.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL,fileURLToPath}=require('node:url');
function option(name){const i=process.argv.indexOf(name);assert.ok(i>=0&&process.argv[i+1],name+' required');return path.resolve(process.argv[i+1]);}
const root=option('--project'),out=option('--evidence'),modulePath=option('--playwright-module');
assert.ok(!fs.existsSync(out),'Use a new evidence directory');fs.mkdirSync(out,{recursive:true});
const {chromium}=require(modulePath),checks=[],errors=[],requests=[],sessions=[],localLinks=new Set();
function check(name,value){assert.ok(value,name);checks.push({name,passed:true});}
function save(name,value){fs.writeFileSync(path.join(out,name),JSON.stringify(value,null,2)+'\n');}
async function main(){
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-CN',permissions:['clipboard-read','clipboard-write']});
    await context.setOffline(true);
    context.on('page',p=>{p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(['error','warning'].includes(m.type()))errors.push(m.type()+': '+m.text());});p.on('request',r=>requests.push(r.url()));});
    const page=await context.newPage(),url=pathToFileURL(path.join(root,'demo/index.html')).href;
    const collect=async p=>{for(const href of await p.locator('a[href],script[src],link[href],img[src]').evaluateAll(a=>a.map(e=>e.href||e.src)))if(href.startsWith('file:'))localLinks.add(href);};
    const snap=async name=>{await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(out,name+'.png')});};
    const navigate=async route=>{await page.locator(`nav a[href="#${route}"]`).click();await page.waitForSelector(`nav a[aria-current="page"][href="#${route}"]`);await collect(page);};
    const pending=async()=>Number(await page.locator('[data-summary="pending"]').textContent());
    const open=async id=>{const e=page.locator('#'+id);if(!await e.evaluate(x=>x.open))await e.locator(':scope > summary').click();await collect(page);};
    const run=async command=>{
      await page.locator('#terminal-input').fill('--output json '+command);
      await page.locator('#terminal-input').press('Enter');
      const result=JSON.parse(await page.locator('.terminal-entry[data-terminal-command] .terminal-response').last().textContent());
      check('Browser origin '+command,result.environment==='browser'&&result.source==='browser_simulator');
      sessions.push({command,result});return result;
    };
    await page.goto(url);await page.locator('h1').waitFor();
    check('Correct copied file URL and title',page.url()===url&&(await page.title()).toLowerCase().includes('contentops'));
    check('Meaningful product screen, no blank shell',(await page.locator('main').innerText()).includes('6 项 API'));
    check('Three navigation entries',await page.locator('nav a').count()===3);
    await collect(page);await snap('desktop-product');
    await navigate('technical');check('Technical and Agent content visible',(await page.locator('main').innerText()).includes('Agent'));
    for(const id of ['technical-notes','agent-notes','original-materials'])await open(id);
    check('Default design references are HTML',await page.locator('a[href*="docs/02-product-plan.html"]').count()>0);
    await navigate('demo');check('Playground can receive input',await page.locator('#terminal-input').isVisible());
    await page.locator('#terminal-input').fill('content get ct_000004 --output json');
    await page.getByRole('button',{name:'复制网页命令',exact:true}).click();
    check('Clipboard copies actual input',await page.evaluate(()=>navigator.clipboard.readText())==='content get ct_000004 --output json');
    for(const invalid of ['content review ct_000004 --action reject','content tags update ct_000004 --add 不存在','content process ct_000004 --action approve --add 悬疑 --execute','content list --page 0']){
      const rejected=await run(invalid);check('Invalid simulated input rejected without writes '+invalid,rejected.status==='rejected'&&rejected.exit_code===2&&await pending()===132);
    }
    let r=await run('content list --review-status pending');check('Simulated pending132, page20',r.data.total===132&&r.data.items.length===20);
    r=await run('content get ct_000004');check('Simulated initial tags and pending',r.data.review_status==='pending'&&r.data.tags.join('|')==='恋爱|校园|武侠');
    r=await run('content history ct_000004');check('Simulated initial empty audit',r.data.items.length===0);
    r=await run('tags list');check('Simulated active23',r.data.total===23);
    for(const cmd of ['content review ct_000004 --action approve','content tags update ct_000004 --add 悬疑','content process ct_000004 --action approve --reason "网页候选验收" --add 悬疑']){
      r=await run(cmd);check('Preview zero writes '+cmd,r.status==='previewed'&&r.mode==='preview'&&await pending()===132);
    }
    r=await run('content get ct_000004');check('Three previews preserve all tags/review',r.data.review_status==='pending'&&r.data.tags.join('|')==='恋爱|校园|武侠');
    r=await run('content history ct_000004');check('Three previews append no audit',r.data.items.length===0);
    r=await run('content process ct_000004 --action approve --reason "网页候选验收" --add 悬疑 --execute --yes');check('Simulated process succeeded',r.status==='succeeded'&&await pending()===131);
    r=await run('content get ct_000004');check('Simulated new state query',r.data.review_status==='approved'&&r.data.tags.join('|')==='恋爱|校园|武侠|悬疑');
    r=await run('content history ct_000004');check('Simulated new audit',r.data.items.length===1&&r.data.items[0].reason==='网页候选验收');
    await snap('desktop-playground-after');
    await page.getByRole('button',{name:'重置数据',exact:true}).click();check('Dirty reset confirms',await page.locator('.reset-confirm').isVisible());
    await page.getByRole('button',{name:'取消',exact:true}).click();check('Cancel reset keeps modified data',await pending()===131);await page.getByRole('button',{name:'重置数据',exact:true}).click();
    await page.getByRole('button',{name:'确认重置',exact:true}).click();
    r=await run('content get ct_000004');check('Reset restores initial view',await pending()===132&&r.data.review_status==='pending'&&r.data.tags.length===3);
    r=await run('content history ct_000004');check('Reset clears simulated audit',r.data.items.length===0);
    await open('java-evidence');await open('case-records');await open('all-task-records');
    check('Task2 original success record readable',(await page.locator('#case-records').textContent()).includes('succeeded'));
    await page.getByRole('button',{name:'查看故障演示',exact:true}).click();
    const faultOptions=await page.locator('#fault-select option').evaluateAll(a=>a.map(e=>e.value));
    check('Five S5 fault cases available',faultOptions.length===5);
    for(const fault of faultOptions){await page.locator('#fault-select').selectOption(fault);await collect(page);check('S5 raw record available '+fault,await page.locator('#developer-evidence .two-col > section').count()===1);}
    await page.locator('#fault-select').selectOption('tags-reject-before-write');await page.locator('[data-recovery="true"]').click();
    check('Independent tags recovery readable',(await page.locator('#developer-evidence').textContent()).includes('succeeded'));
    await collect(page);
    await page.locator('#java-evidence > summary').click();
    await page.setViewportSize({width:390,height:844});
    for(const route of ['product','demo','technical']){await navigate(route);check('Mobile layout no page overflow '+route,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
    await navigate('demo');await snap('mobile-playground');
    check('Mobile input usable',await page.locator('#terminal-input').isVisible());
    const doc=await context.newPage(),docIndex=pathToFileURL(path.join(root,'demo/docs/index.html')).href;
    await doc.goto(docIndex);check('Reading index loads',await doc.locator('h1').count()===1);await collect(doc);
    const docs=await doc.locator('a[href$=".html"]').evaluateAll(a=>a.map(e=>e.href));
    const reading=docs.filter(h=>h.includes('/demo/docs/')&&!h.endsWith('/index.html'));
    check('Eleven reading pages available',new Set(reading).size===11);
    for(const href of new Set(reading)){
      await doc.goto(href);check('Nonblank reading '+path.basename(fileURLToPath(href)),(await doc.locator('main').innerText()).trim().length>100);await collect(doc);
      const anchors=await doc.locator('a[href^="#"]').evaluateAll(a=>a.map(e=>decodeURIComponent(e.hash.slice(1))));
      check('Reading internal anchors '+path.basename(fileURLToPath(href)),await doc.evaluate(ids=>ids.every(id=>!!document.getElementById(id)),anchors));
    }
    await doc.goto(pathToFileURL(path.join(root,'demo/docs/02-product-plan.html')).href);
    check('Reading semantic tables and code present',await doc.locator('table').count()>0&&await doc.locator('pre code').count()>0);
    const anchor=doc.locator('a[href^="#"]:not(.skip-link)').first();await anchor.click();check('Reading TOC anchor navigates',new URL(doc.url()).hash.length>1);
    await doc.setViewportSize({width:390,height:844});check('Mobile reading no page overflow',await doc.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await doc.screenshot({path:path.join(out,'mobile-reading.png')});
    const recordUrl=pathToFileURL(path.join(root,'evidence/task2/commands/13-process-execute.stdout.txt')).href;
    await doc.goto(recordUrl);check('Actual task2 raw evidence opens from copied folder',(await doc.locator('body').innerText()).includes('succeeded'));
    // Discover the recorded recovery path from immutable data, so no historic filenames are invented.
    const recovery=await page.evaluate(()=>window.DEMO_DATA.faults['tags-reject-before-write'].recovery.source);
    await doc.goto(pathToFileURL(path.join(root,recovery+'.stdout.txt')).href);
    check('Actual S5 recovery raw evidence opens',(await doc.locator('body').innerText()).includes('succeeded'));
    for(const href of localLinks){const u=new URL(href);const target=fileURLToPath(u);check('Copied local reference exists '+u.pathname,fs.existsSync(target)&&path.resolve(target).startsWith(root+path.sep));}
    check('No JavaScript errors/warnings',errors.length===0);
    check('Offline: only file requests',requests.every(u=>u.startsWith('file:')));
    save('browser-session.json',{source:'browser_simulator',scope:'Actual browser interactions in copied offline HTML; not Java CLI process evidence',sessions});
    save('result.json',{passed:true,at:new Date().toISOString(),browser:browser.version(),playwright:require(modulePath+'/package.json').version,
      browser_plugin:'Absent: Browser plugin not available; reused existing local Playwright + Chrome',url,doc_index:docIndex,offline:true,
      viewports:['1440x1000','390x844'],checks,check_count:checks.length,local_link_count:localLinks.size,errors,requests});
    console.log(`PASS: ${checks.length} checks; offline Chrome ${browser.version()}; ${localLinks.size} local references`);
  }finally{await browser.close();}
}
main().catch(e=>{save('failure.json',{error:e.stack,passed_checks:checks,errors,requests,sessions});console.error(e);process.exitCode=1;});
