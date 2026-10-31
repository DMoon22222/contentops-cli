// Development-time export. Opening the HTML needs neither Node nor a server.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..');
const source='内容运营后台接口数据/mock_data.json';
const bytes=fs.readFileSync(path.join(root,source));
const data=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
const sha256=crypto.createHash('sha256').update(bytes).digest('hex');
if(data.contents.length!==300||data.tags.length!==25)throw Error('Unexpected original seed shape');
const exported={source,sha256,data};
fs.writeFileSync(path.join(root,'demo/seed.js'),
  '// Read-only original seed export. Browser writes use a separate memory copy.\n'+
  '"use strict";\nwindow.PLAYGROUND_SEED = '+JSON.stringify(exported,null,2)+';\n');
fs.writeFileSync(path.join(__dirname,'seed-integrity.json'),JSON.stringify({source,sha256,
  root_keys:Object.keys(data),contents:data.contents.length,pending:data.contents.filter(c=>c.review_status==='pending').length,
  tags:data.tags.length,active_tags:data.tags.filter(t=>t.status==='active').length},null,2)+'\n');
console.log('Exported original seed unchanged: 300 contents, 132 pending, 25 tags; '+sha256);
