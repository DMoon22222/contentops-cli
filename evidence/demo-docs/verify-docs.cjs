// Actual offline Chrome reading/layout/navigation checks. No Java operations.
// node evidence/demo-docs/verify-docs.cjs --playwright-module <installed package>
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {pathToFileURL,fileURLToPath}=require('node:url');
const arg=process.argv.indexOf('--playwright-module'),packagePath=arg<0?'playwright':process.argv[arg+1];
const {chromium}=require(packagePath);
const root=path.resolve(__dirname,'../..'),out=__dirname,checks=[],errors=[],requests=[],links=new Set();
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function check(name,value,detail=''){assert.ok(value,name+' '+detail);checks.push({name,passed:true,...(detail?{detail}:{})});}
async function main(){
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'demo/docs/manifest.json'),'utf8'));
  check('eleven selected review documents',manifest.documents.length===11);
  for(const d of manifest.documents){
    check('source hash '+d.source,hash(path.join(root,d.source))===d.source_sha256);
    check('generated hash '+d.html,hash(path.join(root,'demo/docs',d.html))===d.html_sha256);
  }
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-CN'});await context.setOffline(true);
    const page=await context.newPage();
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(['error','warning'].includes(m.type()))errors.push(m.type()+': '+m.text());});
    page.on('request',r=>requests.push(r.url()));
    page.on('dialog',async d=>{errors.push('unexpected dialog: '+d.message());await d.dismiss();});
    const demo=pathToFileURL(path.join(root,'demo/index.html')).href;
    const readable=filename=>pathToFileURL(path.join(root,'demo/docs',filename)).href;
    const noOverflow=()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);
    const collect=async()=>{for(const href of await page.locator('a[href]').evaluateAll(es=>es.map(e=>e.href)))links.add(href);};
    await page.goto(demo);await page.locator('h1').waitFor();
    check('home title identifies actual product',await page.locator('h1').textContent()==='内容运营后台 CLI 工具');
    check('home three implemented capabilities',(await page.locator('.product-capabilities h2').allTextContents()).join('|')==='内容查询|内容审核|标签维护');
    check('exactly three main modules',await page.locator('nav a').count()===3);
    check('capabilities precede use, case, progress, plan',await page.evaluate(()=>{
      const selectors=['.product-capabilities','.implemented-features','.product-example','.product-progress','.compact-plan'];
      return selectors.every((s,i)=>!i||Boolean(document.querySelector(selectors[i-1]).compareDocumentPosition(document.querySelector(s))&Node.DOCUMENT_POSITION_FOLLOWING));
    }));
    const homepage=await page.locator('main').innerText();
    for(const text of ['4 条查询命令','3 条写命令','默认预览','JSON','退出码','Mock 跨进程持久化','HTTP Gateway','标签移除/替换','keyword/tag','未来 Agent','尚未实现 100 条执行器','1 名 Java 后端','6 项 API','半日缓冲'])check('home scope '+text,homepage.includes(text));
    check('existing task2 example correct',(await page.locator('.product-example').innerText()).includes('ct_000004')&&(await page.locator('.example-change').innerText()).includes('恋爱、校园、武侠')&&(await page.locator('.example-change').innerText()).includes('＋悬疑'));
    check('five timeline blocks preserved',await page.locator('.timeline > div').count()===5);
    check('human workplan remains source based',fs.readFileSync(path.join(root,'docs/02-第一阶段MVP与CLI产品方案.md'),'utf8').includes('0.50 日缓冲修复'));
    await collect();
    for(const viewport of [{width:1440,height:1000},{width:1366,height:768},{width:1024,height:768},{width:390,height:844}]){
      await page.setViewportSize(viewport);await page.goto(demo);await page.locator('h1').waitFor();
      check('home no horizontal overflow '+viewport.width,await noOverflow());
      if(viewport.width>=1024){
        check('all three capabilities in first viewport '+viewport.width,await page.locator('.product-capabilities').evaluate(e=>e.getBoundingClientRect().bottom<=innerHeight));
        check('Playground button visible in first viewport '+viewport.width,await page.locator('.example-actions .link-button').evaluate(e=>e.getBoundingClientRect().bottom<=innerHeight));
      }
      if(viewport.width===1440)await page.screenshot({path:path.join(out,'product-home.png')});
      if(viewport.width===1366)await page.screenshot({path:path.join(out,'product-laptop.png')});
      if(viewport.width===390)await page.screenshot({path:path.join(out,'product-narrow.png'),fullPage:true});
      await page.getByRole('link',{name:'打开 CLI 交互体验'}).click();await page.locator('#terminal-input').waitFor();
      check('home CTA enters existing terminal '+viewport.width,await page.locator('.playground-title p').textContent()==='浏览器模拟环境 · 不调用 Java 或真实后台');
    }
    await page.setViewportSize({width:1440,height:1000});
    await page.goto(demo+'#technical');await page.locator('h1').waitFor();
    for(const id of ['technical-notes','agent-notes','original-materials'])await page.locator('#'+id).evaluate(e=>e.open=true);
    await collect();
    for(const a of await page.locator('a[href$=".md"]').all())check('only explicit raw Markdown links on main',await a.evaluate(e=>Boolean(e.closest('#original-materials')))&&(await a.textContent()).includes('原始 Markdown 文件'));
    check('default complete technical link is HTML',await page.getByRole('link',{name:'阅读技术架构'}).getAttribute('href')==='docs/03-architecture.html');
    check('default complete Agent link is HTML',await page.getByRole('link',{name:'阅读 Agent 批量方案'}).getAttribute('href')==='docs/07-agent-plan.html');
    await page.getByRole('link',{name:'阅读技术架构'}).click();await page.locator('.markdown-body h1').waitFor();
    check('actual main-to-reading navigation',page.url()===readable('03-architecture.html'));
    await page.getByRole('link',{name:'← 返回主 Demo'}).click();await page.locator('.product-capabilities').waitFor();
    check('actual return-to-demo navigation',await page.locator('nav a[aria-current=page]').getAttribute('href')==='#product');
    const perDocument=[];
    for(const d of manifest.documents){
      const facts={source:d.source,html:d.html,viewports:[]};
      for(const viewport of [{width:1440,height:1000},{width:1366,height:768},{width:1024,height:768},{width:390,height:844}]){
        await page.setViewportSize(viewport);await page.goto(readable(d.html));await page.locator('.markdown-body h1').waitFor();
        const label=d.html+' '+viewport.width;
        check('real document identity '+label,(await page.title()).includes(d.headings[0].title));
        check('rendered full heading hierarchy '+label,JSON.stringify(await page.locator('.markdown-body :is(h1,h2,h3,h4,h5,h6)').allTextContents())===JSON.stringify(d.headings.map(h=>h.title)));
        check('real table elements '+label,await page.locator('.markdown-body table').count()===d.tables);
        check('real fenced and indented code blocks '+label,await page.locator('.markdown-body pre').count()===d.code_blocks);
        check('history note accurate '+label,await page.locator('.stage-note').count()===(d.historical?1:0));
        check('not raw table source '+label,!await page.locator('.markdown-body p').evaluateAll(es=>es.some(e=>/\|\s*---\s*\|/.test(e.textContent))));
        check('no executable document scripts '+label,await page.locator('script,iframe,object,embed,img').count()===0);
        check('CSP installed '+label,(await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')).includes("default-src 'none'"));
        check('document page fits '+label,await noOverflow());
        check('tables have bounded scrolling region '+label,await page.locator('.markdown-body table').evaluateAll(es=>es.every(e=>e.parentElement.classList.contains('table-scroll')&&e.parentElement.getBoundingClientRect().right<=innerWidth+1)));
        check('long code has scroll container '+label,await page.locator('.markdown-body pre').evaluateAll(es=>es.every(e=>getComputedStyle(e).overflowX==='auto'&&e.getBoundingClientRect().right<=innerWidth+1)));
        check('readable code font '+label,await page.locator('.markdown-body pre code').evaluateAll(es=>es.every(e=>parseFloat(getComputedStyle(e).fontSize)>=14)));
        check('readable body width '+label,await page.locator('.markdown-body').evaluate(e=>e.getBoundingClientRect().width<=1035));
        check('source Markdown remains explicit '+label,await page.locator('.document-meta a').textContent()==='原始 Markdown 文件');
        const toc=page.locator('.reading-toc nav a').first();await toc.click();
        const target=decodeURIComponent(new URL(await toc.getAttribute('href'),page.url()).hash.slice(1));
        check('actual TOC anchor navigation '+label,decodeURIComponent(new URL(page.url()).hash.slice(1))===target&&await page.locator('[id]').evaluateAll((es,id)=>es.some(e=>e.id===id&&e.getBoundingClientRect().top<innerHeight),target));
        await collect();
        facts.viewports.push({width:viewport.width,tables:d.tables,code_blocks:d.code_blocks,anchor_clicked:target});
        if(d.html==='02-product-plan.html'&&viewport.width===1440){await page.goto(readable(d.html));await page.screenshot({path:path.join(out,'product-plan-reading.png')});}
        if(d.html==='03-architecture.html'&&viewport.width===1366){
          const heading=page.locator('h3').filter({hasText:'10.4 '});await heading.evaluate(e=>window.scrollTo(0,window.scrollY+e.getBoundingClientRect().top-24));
          await page.screenshot({path:path.join(out,'architecture-table.png')});
          const codeHeading=page.locator('h3').filter({hasText:'7.4 '});await codeHeading.evaluate(e=>window.scrollTo(0,window.scrollY+e.getBoundingClientRect().top-24));await page.screenshot({path:path.join(out,'architecture-code.png')});
        }
        if(d.html==='03-architecture.html'&&viewport.width===390){
          const table=page.locator('.markdown-body .table-scroll').first();await table.scrollIntoViewIfNeeded();
          check('narrow complex table really scrolls',await table.evaluate(e=>{e.scrollLeft=e.scrollWidth;return e.scrollWidth>e.clientWidth&&e.scrollLeft>0;}));
          await table.evaluate(e=>e.scrollLeft=0);
          await page.screenshot({path:path.join(out,'document-narrow.png')});
        }
      }
      perDocument.push(facts);
    }
    await page.setViewportSize({width:1440,height:1000});await page.goto(readable('02-product-plan.html'));
    await page.locator('.markdown-body a[href="01-requirements.html"]').first().click();await page.locator('.markdown-body h1').waitFor();
    check('actual cross-document relative navigation',page.url()===readable('01-requirements.html'));
    await page.goto(readable('06-operation-record.html'));
    const evidence=page.locator('a[href$="13-process-execute.stdout.txt"]').first();await evidence.click();
    check('actual evidence navigation opens saved stdout',page.url().endsWith('13-process-execute.stdout.txt')&&(await page.locator('body').innerText()).includes('87d52d34-050a-42b3-a20c-451da52c9548'));
    await page.goto(readable('index.html'));check('document directory has eleven reading links',await page.locator('.document-index li').count()===11);await collect();
    let localLinks=0;
    for(const href of links){
      const u=new URL(href);if(u.protocol!=='file:')continue;
      const file=fileURLToPath(u);check('local navigation target '+href,fs.existsSync(file));localLinks++;
      if(u.hash&&file.endsWith('.html')){
        // Static ID lookup avoids navigating raw evidence or executing anything.
        const text=fs.readFileSync(file,'utf8'),id=decodeURIComponent(u.hash.slice(1));
        check('static fragment target '+href,text.includes('id="'+id+'"')||file.endsWith(path.join('demo','index.html'))&&['product','demo','technical'].includes(id));
      }
    }
    check('zero console/page/dialog errors',errors.length===0,JSON.stringify(errors));
    check('offline file resources only',requests.every(u=>u.startsWith('file:')),JSON.stringify(requests.filter(u=>!u.startsWith('file:'))));
    const report={captured_at:new Date().toISOString(),passed:true,check_count:checks.length,browser:browser.version(),playwright:require(packagePath+'/package.json').version,
      browser_plugin:'Absent; used installed Playwright + Chrome.',offline:true,protocol:'file:',viewports:['1440x1000','1366x768','1024x768','390x844'],
      opened_documents:perDocument,local_navigation_targets:localLinks,external_hyperlinks_not_requested:[...links].filter(u=>!u.startsWith('file:')),console_errors:errors,requests:[...new Set(requests)],checks};
    fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify(report,null,2)+'\n');
    console.log(`PASS: ${checks.length} checks; 11 actual reading pages x 4 viewports; ${localLinks} local link/fragment targets; Chrome ${browser.version()}.`);
  }finally{await browser.close();}
}
main().catch(e=>{fs.writeFileSync(path.join(out,'failure-'+Date.now()+'.json'),JSON.stringify({captured_at:new Date().toISOString(),error:e.stack,passed_checks:checks.length},null,2)+'\n');console.error(e);process.exitCode=1;});
