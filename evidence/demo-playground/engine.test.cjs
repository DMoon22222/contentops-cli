const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {DemoCliEngine,tokenize,parseCommand}=require('../../demo/cli-engine.js');
const root=path.resolve(__dirname,'../..');
const bytes=fs.readFileSync(path.join(root,'内容运营后台接口数据/mock_data.json'));
const seed=JSON.parse(bytes.toString('utf8'));
const fresh=()=>new DemoCliEngine(seed,{clock:()=> '2030-01-02T03:04:05.000Z'});
const process='content process ct_000004 --action approve --reason "网页演示决定" --add 悬疑';
const execute=' --execute --yes';
const result=(e,s)=>e.run(s).envelope;
const serialized=e=>JSON.stringify(e.exportState());
const rejects=(e,s,code=2)=>{const r=result(e,s);assert.equal(r.exit_code,code);assert.ok(r.error);return r;};

test('export retains all original seed data and source SHA',()=>{
  const sandbox={window:{}};vm.runInNewContext(fs.readFileSync(path.join(root,'demo/seed.js'),'utf8'),sandbox);
  assert.equal(JSON.stringify(sandbox.window.PLAYGROUND_SEED.data),JSON.stringify(seed));
  assert.equal(sandbox.window.PLAYGROUND_SEED.sha256,crypto.createHash('sha256').update(bytes).digest('hex'));
  assert.equal(seed.contents.length,300);assert.equal(seed.tags.length,25);
});
test('tokenizer supports whitespace, Chinese and both quote styles',()=>{
  assert.deepEqual(tokenize('content review ct_000004 --reason "中文 English 理由"'),['content','review','ct_000004','--reason','中文 English 理由']);
  assert.deepEqual(tokenize("--add '悬疑' --reason \"a\\\"b\\\\c\""),['--add','悬疑','--reason','a"b\\c']);
});
test('quoted empty values remain tokens for business validation',()=>assert.deepEqual(tokenize('--reason ""'),['--reason','']));
test('unclosed quotes, input limits and controls rejected',()=>{
  for(const s of ['content get "abc','x'.repeat(2049),'content\nget','content\u0000get',Array(129).fill('x').join(' ')])assert.throws(()=>tokenize(s));
});
test('shell features rejected, quoted characters stay literal text',()=>{
  for(const tail of ['| whoami','; whoami','&& help','> out.txt','< input','$HOME','`whoami`'])assert.throws(()=>tokenize('help '+tail));
  assert.deepEqual(tokenize('content review id --reason "<img src=x onerror=alert(1)>; $HOME"'),['content','review','id','--reason','<img src=x onerror=alert(1)>; $HOME']);
});
test('prefix and inherited global options accepted',()=>{
  const p=parseCommand(tokenize('contentops --output=json content get ct_000004 --env mock --non-interactive'));
  assert.equal(p.command,'content.get');assert.equal(p.output,'json');
});
test('unknown, unsupported and duplicate single options rejected',()=>{
  const e=fresh();
  for(const s of ['echo test','java -jar ./target/contentops.jar','content get ct_000004 --page 2','content list --bogus x','content list --page 1 --page 2','content review ct_000004 --action approve --action reject','content review ct_000004 --action approve --execute --execute --yes','tags list --status active --status all'])rejects(e,s);
});
test('missing required values and extra positional arguments rejected',()=>{
  const e=fresh();
  for(const s of ['content get','content get ct_000004 ct_000005','content list extra','content review ct_000004','content tags update ct_000004','content process ct_000004 --action approve','content list --page','content review ct_000004 --action approve --reason --execute'])rejects(e,s);
});
test('unsupported remove/set, bool values and environments rejected',()=>{
  const e=fresh();
  for(const s of ['content tags update ct_000004 --remove 恋爱','content tags update ct_000004 --set 悬疑','content review ct_000004 --action approve --yes=true','content list --env api','content list --env prod','content list --output xml','content process ct_000004 --action approve --add 悬疑 --scenario timeout'])rejects(e,s);
});
test('help and clear never modify business data',()=>{
  const e=fresh(),before=serialized(e);
  for(const s of ['help','--help','content process --help','clear']){const r=e.run(s);assert.equal(r.envelope,null);assert.ok(['help','clear'].includes(r.kind));}
  assert.equal(serialized(e),before);assert.equal(e.changed,false);
});
test('full dataset is queryable in fixed 20-item pages',()=>{
  const e=fresh(),ids=[];
  for(let page=1;page<=15;page++){const r=result(e,'content list --page '+page);assert.equal(r.data.total,300);assert.equal(r.data.items.length,20);ids.push(...r.data.items.map(c=>c.content_id));}
  assert.deepEqual(ids,seed.contents.map(c=>c.content_id));
  const outside=result(e,'content list --page 16');assert.equal(outside.data.total,300);assert.equal(outside.data.items.length,0);
});
test('pending count 132, final page 12 and AND filters',()=>{
  const e=fresh();assert.equal(result(e,'content list --review-status pending').data.total,132);
  assert.equal(result(e,'content list --review-status pending --page 7').data.items.length,12);
  assert.equal(result(e,'content list --review-status pending --content-id ct_000004').data.total,1);
  assert.equal(result(e,'content list --review-status approved --content-id ct_000004').data.total,0);
  assert.equal(result(e,'content list --content-id no_such_id').data.total,0);
});
test('invalid page/status/ID inputs fail without writes',()=>{
  const e=fresh(),before=serialized(e);
  for(const s of ['content list --page 0','content list --page -1','content list --page 1.5','content list --page 99999999999999999','content list --review-status draft','content list --content-id ""','content get "a b"'])rejects(e,s);
  assert.equal(serialized(e),before);
});
test('details preserve full fields, Chinese body and anomalies',()=>{
  const e=fresh();assert.deepEqual(result(e,'content get ct_000004').data,seed.contents[3]);
  for(const c of seed.contents)assert.deepEqual(result(e,'content get '+c.content_id).data,c);
});
test('unknown get/history fail with read code3',()=>{
  const e=fresh();rejects(e,'content get no_such_id',3);rejects(e,'content history no_such_id',3);
});
test('history sorted on a copy, retains all original actions',()=>{
  const e=fresh(),before=serialized(e),id=Object.keys(seed.review_logs).find(id=>seed.review_logs[id].length>1);
  const logs=result(e,'content history '+id).data.items;
  assert.deepEqual(logs,JSON.parse(JSON.stringify(seed.review_logs[id])).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)));
  assert.equal(serialized(e),before);assert.deepEqual(result(e,'content history ct_000004').data.items,[]);
});
test('tags default23 active, all25 includes two deprecated',()=>{
  const e=fresh();const active=result(e,'tags list').data;assert.equal(active.total,23);assert.ok(active.items.every(t=>t.status==='active'));
  const all=result(e,'tags list --status all').data;assert.equal(all.total,25);assert.equal(all.items.filter(t=>t.status==='deprecated').length,2);
  rejects(e,'tags list --status deprecated');
});
test('all three write previews are zero-write, clock not called',()=>{
  let clocks=0;const e=new DemoCliEngine(seed,{clock:()=>{clocks++;return '2030-01-01T00:00:00Z';}}),before=serialized(e);
  for(const s of ['content review ct_000004 --action approve','content tags update ct_000004 --add 悬疑',process]){
    const r=result(e,s);assert.equal(r.status,'previewed');assert.equal(r.mode,'preview');assert.ok(Object.values(r.data.steps).every(s=>s.write==='not_sent'));assert.equal(serialized(e),before);
  }
  assert.equal(clocks,0);assert.equal(e.changed,false);
});
test('each one-sided authorization rejected before writing',()=>{
  for(const suffix of [' --execute',' --yes']){const e=fresh(),before=serialized(e);rejects(e,process+suffix);assert.equal(serialized(e),before);}
});
test('review approve changes only state and one matching browser log',()=>{
  const e=fresh(),r=result(e,'content review ct_000004 --action approve --reason " 人工 决定 "'+execute);
  assert.equal(r.status,'succeeded');assert.equal(r.environment,'browser');assert.equal(r.data.steps.review.api_result,null);
  const after=e.inspect('ct_000004');assert.equal(after.review_status,'approved');
  const original=JSON.parse(JSON.stringify(after));original.review_status='pending';assert.deepEqual(original,seed.contents[3]);
  const logs=result(e,'content history ct_000004').data.items;assert.equal(logs.length,1);assert.equal(logs[0].operator_id,'op_browser_demo');assert.equal(logs[0].reason,'人工 决定');assert.equal(logs[0].action,'approve');
  assert.equal(result(e,'content list --review-status pending').data.total,131);
});
test('reject requires a nonempty reason, then records correct action',()=>{
  const e=fresh(),before=serialized(e);
  for(const s of ['content review ct_000004 --action reject','content review ct_000004 --action reject --reason "  "','content review ct_000004 --action reject --reason "　"'])rejects(e,s+execute);
  assert.equal(serialized(e),before);
  const r=result(e,'content review ct_000004 --action reject --reason "信息 待补"'+execute);assert.equal(r.status,'succeeded');assert.equal(e.inspect('ct_000004').review_status,'rejected');
  assert.equal(result(e,'content history ct_000004').data.items[0].reason,'信息 待补');
});
test('invalid action rejected and tags-only rejects reason',()=>{
  const e=fresh();rejects(e,'content review ct_000004 --action force'+execute);rejects(e,'content tags update ct_000004 --add 悬疑 --reason why'+execute);
});
test('omitted approve reason matches Java plan null and stored empty log reason',()=>{
  const e=fresh();assert.equal(result(e,'content review ct_000004 --action approve').data.plan.review.reason,null);
  const r=result(e,'content review ct_000004 --action approve'+execute);assert.equal(r.data.plan.review.reason,null);
  assert.equal(result(e,'content history ct_000004').data.items[0].reason,'');
});
test('tags add keeps all old tags and never changes review status',()=>{
  const e=fresh(),before=e.inspect('ct_000004');const r=result(e,'content tags update ct_000004 --add 悬疑'+execute);
  assert.equal(r.status,'succeeded');const c=e.inspect('ct_000004');assert.deepEqual(c.tags,[...before.tags,'悬疑']);c.tags=before.tags;assert.deepEqual(c,before);
  assert.deepEqual(result(e,'content history ct_000004').data.items,[]);
});
test('repeated --add deduplicates requested tags and warns',()=>{
  const e=fresh();const r=result(e,'content tags update ct_000004 --add " 悬疑 " --add 悬疑 --add 轻松'+execute);
  assert.deepEqual(e.inspect('ct_000004').tags,['恋爱','校园','武侠','悬疑','轻松']);assert.equal(r.warnings.length,1);
});
test('unknown, deprecated and empty additions block process before review',()=>{
  for(const tag of ['"不存在标签"','"旧版-悬疑"','""']){
    const e=fresh(),before=serialized(e);rejects(e,'content process ct_000004 --action approve --add '+tag+execute);assert.equal(serialized(e),before);
  }
});
test('controlled fixtures: existing unknown/deprecated tags retained unchanged',()=>{
  // Explicit controlled fixtures exercise retained-value combinations without rewriting the original seed.
  for(const t of ['旧版-悬疑','受控存量未知标签']){
    const fixture=JSON.parse(JSON.stringify(seed)),c=fixture.contents[3];c.tags.push(t);
    const e=new DemoCliEngine(fixture);
    const r=result(e,'content tags update '+c.content_id+' --add "'+t+'"'+execute);
    assert.equal(r.status,'no_change');assert.deepEqual(e.inspect(c.content_id),c);assert.ok(r.warnings.some(w=>w.includes(t)));
  }
});
test('no_change only on execute; duplicate add never reorders original data',()=>{
  const e=fresh(),before=serialized(e),cmd='content tags update ct_000004 --add 恋爱';
  assert.equal(result(e,cmd).status,'previewed');const r=result(e,cmd+execute);assert.equal(r.status,'no_change');assert.equal(r.data.steps.tags.write,'skipped');assert.equal(serialized(e),before);assert.equal(e.changed,false);
});
test('process performs ordered review/verify/tags/verify with one log',()=>{
  const e=fresh(),r=result(e,process+execute);assert.equal(r.status,'succeeded');assert.equal(r.exit_code,0);
  assert.deepEqual(r.data.events,['review:submitted','review:verified','tags:submitted','tags:verified']);
  assert.equal(r.data.steps.review.verification,'matched');assert.equal(r.data.steps.tags.verification,'matched');
  assert.deepEqual(e.inspect('ct_000004').tags,['恋爱','校园','武侠','悬疑']);assert.equal(e.inspect('ct_000004').review_status,'approved');
  assert.equal(result(e,'content history ct_000004').data.items.length,1);assert.equal(result(e,'content list --review-status pending').data.total,131);
});
test('process can skip unchanged tags after review',()=>{
  const e=fresh(),r=result(e,'content process ct_000004 --action approve --add 恋爱'+execute);
  assert.equal(r.status,'succeeded');assert.equal(r.data.steps.tags.write,'skipped');assert.deepEqual(r.data.events,['review:submitted','review:verified','tags:skipped']);
});
test('repeated rapid executions cannot add review logs again',()=>{
  const e=fresh();const runs=Array.from({length:10},()=>result(e,process+execute));
  assert.equal(runs.filter(r=>r.status==='succeeded').length,1);assert.ok(runs.slice(1).every(r=>r.status==='rejected'&&r.exit_code===2));
  assert.equal(result(e,'content history ct_000004').data.items.length,1);
});
test('tags remain independently editable after approved review',()=>{
  const e=fresh();result(e,'content review ct_000004 --action approve'+execute);
  assert.equal(result(e,'content tags update ct_000004 --add 悬疑'+execute).status,'succeeded');
  assert.equal(result(e,'content history ct_000004').data.items.length,1);
});
test('reset restores complete original business state, seed never mutates',()=>{
  const original=JSON.stringify(seed),e=fresh();result(e,process+execute);assert.equal(e.changed,true);
  e.reset();assert.equal(serialized(e),original);assert.equal(e.changed,false);assert.equal(JSON.stringify(seed),original);
});
test('results and exported views do not alias engine memory',()=>{
  const e=fresh();const c=result(e,'content get ct_000004');c.data.tags.push('bad');
  const state=e.exportState();state.contents[3].review_status='approved';assert.deepEqual(e.inspect('ct_000004'),seed.contents[3]);
});
test('unrelated collections and the other299 contents remain unchanged',()=>{
  const e=fresh();result(e,process+execute);const after=e.exportState();
  for(const key of Object.keys(seed).filter(k=>!['contents','review_logs'].includes(k)))assert.deepEqual(after[key],seed[key]);
  assert.deepEqual(after.contents.filter(c=>c.content_id!=='ct_000004'),seed.contents.filter(c=>c.content_id!=='ct_000004'));
});
test('JSON envelope identifies browser simulation and does not invent API acknowledgements',()=>{
  const e=fresh(),r=e.run(process+execute+' --output json');assert.equal(r.output,'json');
  const json=JSON.parse(JSON.stringify(r.envelope));assert.equal(json.environment,'browser');assert.equal(json.source,'browser_simulator');assert.equal(json.mode,'execute');
  for(const key of ['command','status','exit_code','content_id','data','error','warnings'])assert.ok(Object.hasOwn(json,key));
  assert.ok(Object.values(json.data.steps).every(s=>s.api_result===null));
  const rejected=e.run('--output json content list --unknown x');assert.equal(rejected.output,'json');assert.equal(rejected.envelope.command,null);assert.equal(rejected.envelope.mode,null);
});
test('HTML-looking reasons are stored as literal browser text',()=>{
  const e=fresh(),reason='<img src=x onerror=alert(1)>; $HOME';
  result(e,'content review ct_000004 --action approve --reason "'+reason+'"'+execute);
  assert.equal(result(e,'content history ct_000004').data.items[0].reason,reason);
});
test('recognized JSON preference survives later lexical rejection',()=>{
  const e=fresh();
  for(const command of ['--output json content list | whoami','--output=json content review ct_000004 --reason "unclosed']){
    const r=e.run(command);assert.equal(r.output,'json');assert.equal(r.envelope.exit_code,2);assert.equal(r.envelope.command,null);assert.equal(r.envelope.mode,null);
  }
});
test('local preparation errors do not pretend that Java wrote anything',()=>{
  const e=new DemoCliEngine(seed,{clock:()=>{throw Error('controlled clock failure');}}),before=serialized(e);
  const r=result(e,process+execute);assert.equal(r.status,'failed');assert.equal(r.exit_code,1);assert.equal(serialized(e),before);
});
