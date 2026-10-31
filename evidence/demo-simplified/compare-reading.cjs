const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {pathToFileURL}=require('node:url');
// Optional offline comparison against the prior UI; no Java or business-state access.
const {chromium}=require(process.argv[2]||'playwright');
const root=path.resolve(__dirname,'../..');
const baseline=path.join(root,'.contentops/demo-simplified-qa/baseline');fs.mkdirSync(baseline,{recursive:true});
for(const name of ['index.html','app.js','style.css','data.js']){
  fs.writeFileSync(path.join(baseline,name),cp.execFileSync('git',['show','77d329242fef593879dfe4eea378a810a784a735:demo/'+name],{cwd:root,maxBuffer:5*1024*1024}));
}
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});await context.setOffline(true);
    const rows={};
    for(const [version,file]of [['previous',path.join(baseline,'index.html')],['current',path.join(root,'demo/index.html')]]){
      const page=await context.newPage();await page.goto(pathToFileURL(file).href);rows[version]={};
      for(const route of ['product','demo','technical']){
        await page.locator('nav a[href="#'+route+'"]').click();
        await page.waitForFunction(r=>document.querySelector('nav a[aria-current="page"]')?.hash==='#'+r,route);
        rows[version][route]=await page.locator('main').evaluate(e=>({
          visible_characters:e.innerText.replace(/\s/g,'').length,
          visible_tables:[...e.querySelectorAll('table')].filter(t=>t.checkVisibility()).length,
          visible_result_panels:[...e.querySelectorAll('.statusline')].filter(t=>t.checkVisibility()).length,
          folded_sections:e.querySelectorAll('details:not([open])').length
        }));
      }
      await page.close();
    }
    const report={captured_at:new Date().toISOString(),baseline_commit:'77d329242fef593879dfe4eea378a810a784a735',
      method:'Actual offline Chrome at 1440x1000. main.innerText excluding whitespace, closed details hidden. Includes code, captions and scrollable content; not a reading-time measurement.',
      browser:browser.version(),versions:rows};
    fs.writeFileSync(path.join(root,'evidence/demo-simplified/reading-comparison.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report,null,2));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
