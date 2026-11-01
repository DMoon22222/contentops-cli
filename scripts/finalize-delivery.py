"""Local-only allowlisted ZIP preparation. Never builds a JAR, pushes, uploads or sends."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
from html.parser import HTMLParser
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
from urllib.parse import unquote, urlsplit
import zipfile

ROOT=Path(__file__).resolve().parents[1]
CONTEXT=ROOT/'.contentops/final-context.json'
FROZEN='2e6b40ece3567579383c777bff31c35bc682bbf5b18a5bf881bfe5c6596940c6'
BASE='c5906402d87ad78e5ea43bd0932cbd97bb08f00e'
ctx=json.loads(CONTEXT.read_text(encoding='utf8'))
WORK=ROOT/ctx['run_relative'];STAGE=ROOT/ctx['stage_relative'];FINAL=ROOT/ctx['final_relative']
USERPATH=re.compile(r'''(?i)([A-Z]:(?:\\+|/+)Users(?:\\+|/+))[^\\/\s"'<>]+''')


def load(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def save(p,x):p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(x,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def files(root):return sorted(p for p in root.rglob('*') if p.is_file())
def clean_text(text):return USERPATH.sub(r'\1[已脱敏_本机用户]',text)
def safe(root,name):
    rel=Path(name);assert not rel.is_absolute() and '..' not in rel.parts and ':' not in name and '\\' not in name,name
    p=root/rel;assert p.resolve().is_relative_to(root.resolve());return p


def source_check():
    candidate=ROOT/'delivery/candidate/ContentOps-CLI';gold=load(ROOT/'evidence/release/candidate-files.json')['files']
    assert {p.relative_to(candidate).as_posix() for p in files(candidate)}=={e['path'] for e in gold}
    assert all(sha(candidate/e['path'])==e['sha256'] for e in gold),'STOP: candidate drift'
    assert sha(ROOT/'target/contentops.jar')==sha(candidate/'target/contentops.jar')==FROZEN,'STOP: frozen JAR drift'
    assert not subprocess.check_output(['git','diff',BASE,'HEAD','--name-only','--','src/main','pom.xml'],cwd=ROOT).strip()
    for p,h in ctx['source_original_sha256'].items():assert sha(ROOT/p)==h
    for f in load(ROOT/'evidence/release/protection.json')['formal_task2']:assert sha(ROOT/f['path'])==f['before']
    return candidate,gold


def assemble():
    candidate,gold=source_check();assert not STAGE.exists(),'Existing stage must not be overwritten'
    STAGE.mkdir(parents=True);decisions=[];renames={}
    sources={e['path']:candidate/e['path'] for e in gold}
    for name in ['docs/09-最终交付文件盘点与目录规划.md','docs/10-交付候选版验收记录.md','scripts/prepare-release.py','scripts/verify-release-browser.cjs','scripts/test-support/release-session.ps1']:
        sources[name]=ROOT/name
    for base in ['delivery/plan','evidence/release']:
        for p in files(ROOT/base):sources[p.relative_to(ROOT).as_posix()]=p
    for name,p in sorted(sources.items()):
        reason=None
        if p.suffix=='.xml' and name!='pom.xml':reason='Redundant JUnit XML embeds host/system properties; retain same suites TXT, test summary and full Maven streams'
        if p.name=='session.started.json':reason='Redundant launcher metadata; retain command args/stdout/stderr/exit files and completed-session results'
        if name.startswith('evidence/release/browser/run-03/') and p.suffix=='.png':reason='Duplicate intermediate screenshot; retain failure.json/logs and successful run-04 screenshots'
        data=p.read_bytes();text=None
        if p.suffix.lower() not in ('.jar','.png','.jpg','.jpeg'):
            text=data.decode('utf-8-sig')
        private=bool(text and re.search(r'(?i)C:(?:\\+|/+)Users(?:\\+|/+)15614',text))
        if private and p.name=='session.finished.json':reason='Host-only failed-launch metadata; failure and command/output evidence retained'
        if reason:
            decisions.append({'source_path':name,'decision':'exclude','reason':reason,'source_sha256':sha(p)});continue
        target=name;modified=False
        if private:
            modified=True
            if p.suffix!='.md':
                q=Path(name);target=(q.parent/(q.stem+'.redacted'+q.suffix)).as_posix();renames[name]=target
            text=clean_text(text)
            if p.suffix=='.md':text='> 交付阅读副本：仅对历史开发机用户目录作标注遮盖；原文件未修改。\n\n'+text
            data=text.encode('utf8')
        dest=safe(STAGE,target);dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(data)
        decisions.append({'source_path':name,'target_path':target,'decision':'redacted_copy' if modified else 'keep',
                          'reason':'Minimal user-directory redaction; original unchanged' if modified else ('Required source/runtime or linked proof; original bytes retained'),
                          'source_sha256':sha(p),'package_sha256':sha(dest)})
    # Historical planning remains historical; only navigation adapts to the distributed layout.
    p=STAGE/'docs/10-交付候选版验收记录.md';t=p.read_text(encoding='utf8')
    t=t.replace('[delivery/candidate/ContentOps-CLI](../delivery/candidate/ContentOps-CLI/)','[当前解压根（原候选结构）](../)')
    p.write_text('> 交付阅读副本：保留原候选验收事实，仅把候选目录导航适配为当前解压根。最终 ZIP 验收见外置报告。\n\n'+t,encoding='utf8')
    p=STAGE/'docs/09-最终交付文件盘点与目录规划.md'
    p.write_text('> 历史规划阅读副本：最终用户已要求 AI 记录同时内置和外置；本包按新要求实施，当前布局见交付说明，原规划事实不改写。\n\n'+p.read_text(encoding='utf8'),encoding='utf8')
    # Update only file references in staged Markdown, never original evidence or runtime JS.
    link=re.compile(r'(\]\()([^\n)]+)(\))')
    for p in STAGE.rglob('*.md'):
        text=p.read_text(encoding='utf-8-sig')
        def adapt(m):
            u=urlsplit(m[2]);
            if u.scheme or not u.path:return m[0]
            oldtarget=(p.parent/unquote(u.path)).resolve()
            if not oldtarget.is_relative_to(STAGE.resolve()):return m[0]
            rel=oldtarget.relative_to(STAGE).as_posix()
            if rel not in renames:return m[0]
            new=os.path.relpath(STAGE/renames[rel],p.parent).replace('\\','/')
            return m[1]+new+('#'+u.fragment if u.fragment else '')+m[3]
        adapted=link.sub(adapt,text)
        if adapted!=text:p.write_text(adapted,encoding='utf8')
    save(WORK/'selection.json',{'decisions':decisions,'notes':['All original candidate/source/evidence files stay unchanged',
        'Candidate 1920 is not final count: per-file selection excludes XML host properties, redundant launch metadata and duplicate failed screenshots',
        'Original stdout/stderr/exit triads, failures, source/tests, interfaces, all Demo assets and necessary documents retained',
        'docs/05 is not invented to fill numbering; README, current delivery guide and external instructions cover use',
        'Raw AI JSONL, old large exports and unchecked/private images never copied'], 'renamed_redacted_copies':renames})
    sync_ai();write_guides();write_manifest();print(json.dumps({'stage':ctx['stage_relative'],'selected_product_files':len(files(STAGE)),
         'source_entries_excluded':sum(x['decision']=='exclude' for x in decisions),'redacted_copies':sum(x['decision']=='redacted_copy' for x in decisions)},indent=2))


def sync_ai():
    source_check();a=ROOT/'delivery/submission-draft/AI协作记录';m=load(a/'会话清单.json');v=load(a/'阅读版校验.json')
    assert v['final_mail_dialogue_complete'] and m.get('user_authorized_final_notice_exclusion')
    assert len(m['files'])==12
    FINAL.mkdir(parents=True,exist_ok=True)
    for destination in (FINAL/'AI协作记录',STAGE/'ai-records/submission'):
        destination.mkdir(parents=True,exist_ok=True)
        expected={p.relative_to(a).as_posix() for p in files(a)}
        existing={p.relative_to(destination).as_posix() for p in files(destination)}
        assert existing<=expected,'Unexpected preexisting AI file'
        for rel in sorted(expected):
            dest=safe(destination,rel);dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(a/rel,dest)
        assert all(sha(a/p)==sha(destination/p) for p in expected)
    text='# AI 协作记录\n\n[打开中文对话索引](submission/索引.md)。3 个真实会话、12 份正文；会话 01 的十部分仍是同一会话。用户已允许最后一条通知暂不收录，其他截至快照的可见文字逐条核对。ZIP 内与外置记录逐文件相同。原始日志和未经审查图像不在本包。\n'
    (STAGE/'ai-records/README.md').write_text(text,encoding='utf8')


def write_guides():
    outer=r'''# ContentOps CLI：运行与查看说明

将“项目代码包.zip”完整解压，得到 ContentOps-CLI 文件夹。无需克隆 GitHub。

## 先看成果

- 双击 ContentOps-CLI/demo/index.html，可离线查看产品方案、CLI Playground、技术设计。
- Playground 输入 help 看帮助，输入命令后按 Enter；快捷按钮只填入。写命令默认预览；刷新或“重置数据”恢复网页内存。
- HTML 文档目录：ContentOps-CLI/demo/docs/index.html。产品/架构看 02/03，任务二实际操作看 06，Agent 100 条方案看 07。
- 任务二真实命令和原始结果在 ContentOps-CLI/evidence/task2/。网页“真实记录”是已保存证据，不是本次网页运行。
- AI 记录见 [索引](AI协作记录/索引.md)，按三个真实会话和十个核心开发阶段阅读；包内 ai-records/submission 内容与外置逐文件相同。

## 运行真正的 Java CLI

已打包 JAR 只需要 JDK 21；Windows 完整验收使用 PowerShell 7。不需要 Maven、Git、数据库、网络或后台服务。Maven 仅供源码构建，试用不必先构建。

在 ContentOps-CLI 根目录打开 PowerShell，同一个窗口依次执行：

```powershell
java -version
.\scripts\enable-contentops.ps1 -NewState
contentops --help

contentops content list --review-status pending --page 1
contentops content get ct_000004
contentops content history ct_000004
contentops tags list

# 三条写命令均只预览
contentops content review ct_000004 --action approve
contentops content tags update ct_000004 --add "悬疑"
contentops content process ct_000004 --action approve --reason "本地演示决定" --add "悬疑"
```

四条查询分别查列表、详情、审核历史和 active 标签；三条写命令分别审核、只加标签、先审核再更新标签。以上 approve 是人工指定的本地演示决定，不是工具自动判定内容合规。

确认刚创建了独立状态目录后，实际执行一次并回读：

```powershell
contentops --output json content process ct_000004 --action approve --reason "本地演示决定" --add "悬疑" --execute --yes
$cliExit = $LASTEXITCODE
$cliExit
contentops --output json content get ct_000004
contentops content history ct_000004
contentops content list --review-status pending
```

应核对 approved、原三标签保留并新增悬疑、历史恰增一条、pending 132→131。以本次真实输出/退出码和回读为准，预览退出 0 不表示执行。重复审核会拒绝；重新体验用 -NewState 创建新副本，不删除旧记录。初始化只改当前会话 PATH，关闭窗口后重新初始化，不改永久环境。

网页仅模拟浏览器内存，environment=browser；真实 Java 操作独立 Mock 文件，environment=mock，两者互不影响。真实 HTTP 尚未接入，标签 remove/set、交互式确认和 Agent 批次执行器未实现。部分成功/4、未知/5、核对失败/6 不能当成功或盲目重试；先查询详情和历史，审核已成功后只恢复标签步骤。

## 常见问题与范围

- Java 不为 21：选择 JDK 21，检查 java -version 后重新打开 PowerShell。
- 缺少 target/contentops.jar：检查是否完整解压。不要用重新构建覆盖本次冻结 JAR。
- contentops 未找到：在准备使用的同一窗口初始化；也可 .\scripts\contentops.cmd --help。
- 执行策略阻止 ps1：不必永久降低策略；按包内 README 的手动当前会话方案，显式选择新状态后用 .cmd。
- 故障变量 CONTENTOPS_MOCK_SCENARIO：确认后仅在当前窗口手动清除，再初始化，不把故障环境用于普通试用。
- reject 必须提供非空 --reason；新增标签须存在且 active，只允许审核 pending。

详细技术边界见 [补充说明](补充说明.md)，本地实测及 ZIP 哈希见 [最终验收报告](最终交付验收报告.md)。所有产物仅在本地准备，没有发送邮件或上传。
'''
    (FINAL/'说明文档.md').write_text(outer,encoding='utf8')
    note=(ROOT/'delivery/submission-draft/补充说明.md').read_text(encoding='utf8')
    note=note.replace('[运行说明](运行与查看说明.md)','[运行说明](说明文档.md)')
    note=note.replace('当前外置材料仍为草稿，最终 ZIP、压缩包解压复验和最终命名尚待后续；没有上传或发送邮件。','本地 ZIP 和独立解压复验的实际状态见最终交付验收报告。名称为中性暂定名，等待用户检查；没有上传或发送邮件。')
    (FINAL/'补充说明.md').write_text(note,encoding='utf8')
    inner='''# ContentOps CLI：交付入口

这是可运行的独立 Mock 原型，不是真实后台联调或已实现的 100 条批量执行器。

1. [打开离线 HTML Demo](demo/index.html)：产品方案、网页 CLI 体验和技术演进。
2. [全部 HTML 阅读文档](demo/docs/index.html)：任务一看产品/架构，任务二看 [真实操作](demo/docs/06-operation-record.html)，任务三看 [Agent 方案](demo/docs/07-agent-plan.html)。
3. 真正的 Java CLI：在当前目录 PowerShell 7 中执行 .\\scripts\\enable-contentops.ps1 -NewState，然后 contentops --help。只需要 JDK 21，无须 Maven/Git/服务。七条命令及一次实际演示步骤见 ZIP 外“说明文档.md”，完整参数见 [README](README.md)。
4. [AI 中文对话索引](ai-records/submission/索引.md)：与 ZIP 外 AI协作记录完全一致，保留三会话和原始发言顺序。
5. [最终文件清单](交付文件清单.json) 与 [冻结 JAR 信息](冻结JAR信息.json) 用于核对本包。新解压复验的结果在 ZIP 外“最终交付验收报告.md / 验收证据”。

写操作默认预览，实际执行必须同时提供 --execute --yes。初始化创建独立 Mock 副本，不修改 seed 或历史证据；网页模拟与 Java 状态分开。先审核核对，再更新标签核对，不存在联合事务；未知结果不自动重试。

README、早期设计与历史验收记录保留其当时的阶段描述，不能把其中“尚未打包”等历史表述作为当前状态。最终打包/复验以 ZIP 外最新报告为准。docs/05 未人为补号，运行说明由本文、README 和外置说明提供。

为减少冗余及隐私暴露，部分 JUnit XML 的本机属性、重复启动器元数据和重复截图未分发；同一测试的 TXT、Maven 完整流、结果计数、失败过程和关键业务三件套仍在。少量路径敏感日志提供明确命名的脱敏副本，源文件未修改。具体取舍见文件清单，原始题目/接口/Mock/任务二和 S5 业务证据不变。

本包只用于本地用户检查，没有自动发送、上传或 Git Push。
'''
    (STAGE/'交付说明.md').write_text(inner,encoding='utf8')
    save(STAGE/'冻结JAR信息.json',{'sha256':FROZEN,'path':'target/contentops.jar','source_commit':BASE,
          'bytes':(STAGE/'target/contentops.jar').stat().st_size,'no_rebuild_this_round':True,
          'historical_task2_jar_sha256':'16859da000d14e9d6b02fe73a330b3a5eedc647f6862d0b20e3ad5675d5091e2',
          'history_not_rewritten':'Different archives are not claimed byte-identical. See evidence/release/jar-version-relationship.json.'})


def write_manifest():
    selection=load(WORK/'selection.json')
    for entry in selection['decisions']:
        if entry.get('target_path'):
            current=sha(STAGE/entry['target_path'])
            if current!=entry.get('package_sha256'):
                entry['staged_document_navigation_or_context_adapted']=True
                entry['reason']+='; staged-only context/navigation adaptation recorded'
            entry['package_sha256']=current
    save(WORK/'selection.json',selection)
    data=[{'path':p.relative_to(STAGE).as_posix(),'bytes':p.stat().st_size,'sha256':sha(p)} for p in files(STAGE) if p.name!='交付文件清单.json']
    save(STAGE/'交付文件清单.json',{'source_commit':BASE,'frozen_jar':FROZEN,'excluded_self':'交付文件清单.json',
          'files':data,'selection':selection,'all_original_candidate_files_unchanged':True,
          'ai_records_identical_to_external':True,'no_raw_ai_logs_or_unchecked_images':True})


def audit(root,allow_test_state=False):
    assert sha(root/'target/contentops.jar')==FROZEN
    paths={p.relative_to(root).as_posix() for p in files(root)}
    test_state={p for p in paths if p.startswith('.contentops/')}
    assert allow_test_state or not test_state
    paths-=test_state
    assert not any(any(q in ('.git','.contentops','node_modules','__pycache__','.venv') for q in Path(p).parts) for p in paths)
    assert {p for p in paths if p.endswith('.jar')}=={'target/contentops.jar'}
    assert '.mvn/maven.config' in paths and 'src/main/java/com/example/contentops/Main.java' in paths
    spec=importlib.util.spec_from_file_location('audit_delivery',ROOT/'scripts/audit-delivery.py');a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
    pages={}
    for name in paths:
        p=root/name
        if p.suffix=='.html':pages[name]=a.Page(p.read_text(encoding='utf-8-sig'))
        if p.suffix=='.md':pages[name]=a.markdown_page(p.read_text(encoding='utf-8-sig'))
    adapter=(ROOT/'scripts/capture-delivery-links.cjs').read_text(encoding='utf8');marker="const root = path.resolve(__dirname, '..');"
    assert marker in adapter;adapter=adapter.replace(marker,'const root = process.argv[1];',1)
    dynamic=json.loads(subprocess.check_output(['node','-e',adapter,str(root)]));main=pages['demo/index.html'];main.ids.update(dynamic['virtual_fragments'])
    for s in dynamic['snapshots']:
        p=a.Page(s['html']);main.ids.update(p.ids);main.links+=p.links
    issues=[];count=0;outside=[];keys=[];private=[]
    for source,p in pages.items():
        for kind,href in p.links:
            u=urlsplit(href)
            if u.scheme and u.scheme!='file':continue
            target=((root/source).parent/unquote(u.path)).resolve() if u.path else root/source;count+=1
            if not target.is_relative_to(root.resolve()) or not target.exists():issues.append({'source':source,'href':href,'reason':'missing/outside'});continue
            rel=target.relative_to(root).as_posix()
            if u.fragment and rel in pages and unquote(u.fragment) not in pages[rel].ids:issues.append({'source':source,'href':href,'reason':'anchor'})
    for name in paths:
        p=root/name
        if p.suffix in ('.png','.jpg','.jar'):continue
        t=p.read_text(encoding='utf-8-sig')
        if re.search(r'(?i)C:(?:\\+|/+)Users(?:\\+|/+)15614',t):private.append(name)
        if re.search(r'(?:ghp_|github_pat_|sk-proj-)[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',t):keys.append(name)
    assert not issues,issues
    assert not private,private
    assert not keys,keys
    sourcehash=load(root/'evidence/demo/source-hashes.json');assert all(sha(root/p).lower()==h.lower() for p,h in sourcehash.items())
    original=ctx['source_original_sha256'];assert all(sha(root/p)==h for p,h in original.items())
    ai=root/'ai-records/submission';external=FINAL/'AI协作记录';ai_files={p.relative_to(ai).as_posix() for p in files(ai)}
    assert ai_files=={p.relative_to(external).as_posix() for p in files(external)}
    assert all(sha(ai/p)==sha(external/p) for p in ai_files)
    result={'root_label':root.name,'files':len(paths),'bytes':sum((root/p).stat().st_size for p in paths),
            'local_reference_checks':count,'dynamic_template_states':len(dynamic['snapshots']),'link_issues':issues,'credential_hits':keys,
            'unmasked_local_user_paths':private,'ai_files_equal_inside_outside':len(ai_files),'demo_source_hashes_verified':len(sourcehash),
            'frozen_jar':FROZEN,'original_attachments_unchanged':True,'cache_state_git_or_duplicate_jar':False}
    return result


def pack():
    source_check();sync_ai();write_guides();write_manifest();result=audit(STAGE);save(WORK/'stage-audit.json',result)
    target=FINAL/'项目代码包.zip';history=WORK/'zip-history';history.mkdir(exist_ok=True)
    if target.exists():shutil.copyfile(target,history/(datetime.now().strftime('%H%M%S-%f')+'.zip'))
    temp=WORK/'working.zip'
    with zipfile.ZipFile(temp,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
        for p in files(STAGE):z.write(p,'ContentOps-CLI/'+p.relative_to(STAGE).as_posix())
    with zipfile.ZipFile(temp) as z:
        assert z.testzip() is None
        assert len(z.namelist())==len(files(STAGE)) and all(n.startswith('ContentOps-CLI/') and '..' not in Path(n).parts for n in z.namelist())
    os.replace(temp,target)
    extraction=WORK/('独立解压验收 '+datetime.now().strftime('%H%M%S-%f'));extraction.mkdir()
    with zipfile.ZipFile(target) as z:z.extractall(extraction)
    extracted=extraction/'ContentOps-CLI';assert all(sha(extracted/p.relative_to(STAGE))==sha(p) for p in files(STAGE))
    actual=audit(extracted);save(WORK/'extracted-audit.json',actual)
    ctx.update(extracted_relative=extracted.relative_to(ROOT).as_posix(),zip_sha256=sha(target),zip_bytes=target.stat().st_size,
               zip_files=len(files(STAGE)),uncompressed_bytes=result['bytes'],last_pack_at=datetime.now(timezone.utc).isoformat())
    save(CONTEXT,ctx);print(json.dumps({k:ctx[k] for k in ('zip_sha256','zip_bytes','zip_files','uncompressed_bytes','extracted_relative')},ensure_ascii=True,indent=2))


def publish():
    source_check();assert sha(FINAL/'项目代码包.zip')==ctx['zip_sha256']
    extracted=ROOT/ctx['extracted_relative'];actual=audit(extracted,allow_test_state=True)
    # Test writes are confined to the extracted copy. Check original ZIP/stage content remains clean.
    assert not (STAGE/'.contentops').exists()
    cli=load(WORK/'raw-evidence/cli/result.json');browser=load(WORK/'raw-evidence/browser-final-01/result.json')
    assert cli['passed'] and browser['passed']
    assert load(WORK/'raw-evidence/cli/session.json')['actual_exit_code']==0
    assert load(WORK/'raw-evidence/browser-process.json')['actual_exit_code']==0
    evidence=FINAL/'验收证据';evidence.mkdir(exist_ok=True)
    sanitizations=[]
    for source in files(WORK/'raw-evidence'):
        rel=source.relative_to(WORK/'raw-evidence');dest=evidence/rel;dest.parent.mkdir(parents=True,exist_ok=True)
        if source.suffix=='.png':shutil.copyfile(source,dest)
        else:
            text=source.read_text(encoding='utf-8-sig');clean=clean_text(text);dest.write_text(clean,encoding='utf8')
            if clean!=text:sanitizations.append({'path':rel.as_posix(),'reason':'Local user-directory marker in distributed diagnostic copy','original_sha256':sha(source),'distributed_sha256':sha(dest)})
    (evidence/'复验脚本').mkdir(exist_ok=True)
    shutil.copyfile(WORK/'final-session.ps1',evidence/'复验脚本/final-session.ps1')
    shutil.copyfile(ROOT/'scripts/verify-final-browser.cjs',evidence/'复验脚本/verify-final-browser.cjs')
    save(evidence/'证据脱敏说明.json',{'original_logs_private':True,'copies_with_minimal_path_redaction':sanitizations,'business_stdout_stderr_not_synthesized':True})
    ai=load(FINAL/'AI协作记录/阅读版校验.json');assert ai['final_mail_dialogue_complete']
    record_manifest=load(FINAL/'AI协作记录/会话清单.json')
    source_private_images=load(FINAL/'AI协作记录/脱敏检查报告.json');assert source_private_images['unreviewed_original_images_in_submission']==0
    selection=load(WORK/'selection.json');excluded=[d for d in selection['decisions'] if d['decision']=='exclude']
    save(FINAL/'文件清单及排除项说明.json',{'archive_root':'ContentOps-CLI/','zip_file_count':ctx['zip_files'],
          'zip_uncompressed_bytes':ctx['uncompressed_bytes'],'zip_sha256':ctx['zip_sha256'],
          'files':load(STAGE/'交付文件清单.json')['files'],'self_manifest_in_zip':'交付文件清单.json (excludes itself)',
          'excluded_source_files':excluded,'explicit_never_copy_rules':['.git/**','.contentops/**','node_modules/**','IDE/credentials/private config','target/** except target/contentops.jar','raw AI JSONL and unchecked originals','duplicate attachment ZIP'],
          'all_original_files_preserved_in_workspace':True,'minimum_redacted_copies':[d for d in selection['decisions'] if d['decision']=='redacted_copy']})
    ai_files=[{'path':p.relative_to(FINAL/'AI协作记录').as_posix(),'bytes':p.stat().st_size,'sha256':sha(p)} for p in files(FINAL/'AI协作记录')]
    save(FINAL/'AI记录文件大小与SHA256.json',{'files':ai_files,'matches_zip_submission_subtree':True,'dialogue_files':12,'core_parts':10,
          'source_user_messages':ai['source_user_total'],'source_codex_messages':ai['source_codex_total'],
          'attachments':ai['total_input_attachments'],'user_allowed_final_notice_excluded':True})
    production={'target/contentops.jar'}|{p.relative_to(STAGE).as_posix() for p in files(STAGE/'src')}|{p.relative_to(STAGE).as_posix() for p in files(STAGE/'demo')}
    assert all(sha(extracted/p)==sha(STAGE/p) for p in production)
    for f in load(STAGE/'交付文件清单.json')['files']:assert sha(extracted/f['path'])==f['sha256']
    assert sha(extracted/'交付文件清单.json')==sha(STAGE/'交付文件清单.json')
    summary={'zip_sha256':ctx['zip_sha256'],'zip_bytes':ctx['zip_bytes'],'zip_files':ctx['zip_files'],
             'uncompressed_bytes':ctx['uncompressed_bytes'],'frozen_jar_sha256':FROZEN,'build_source_commit':BASE,
             'local_tooling_head':ctx['initial_head'],'no_maven_build_this_round':True,
             'cli_checks':len(cli['checks']),'cli_actual_exit':0,'cli_non_admin':not cli['administrator'],
             'browser_checks':browser['check_count'],'browser_version':browser['browser'],'browser_offline':browser['offline'],
             'browser_errors':browser['errors'],'browser_viewports':browser['viewports'],
             'html_links_checked':actual['local_reference_checks'],'link_issues':actual['link_issues'],
             'ai_equal_files':actual['ai_files_equal_inside_outside'],'ai_user_messages':ai['source_user_total'],'ai_codex_messages':ai['source_codex_total'],
             'ai_message_omissions':ai['message_omissions'],'ai_message_duplicates':ai['message_duplicates'],
             'ai_input_attachments':ai['total_input_attachments'],'final_notice_excluded_by_user':True,
             'credential_hits':actual['credential_hits'],'unmasked_local_user_paths':actual['unmasked_local_user_paths'],
             'candidate_and_originals_unchanged':True,'extraction_hashes_match_zip':True,
             'code_demo_jar_unchanged_after_runtime_tests':True,'test_state_only_in_private_extraction':True,
             'known_unimplemented':['HTTP Gateway','remove/set','interactive confirmation','100-item Agent executor'],
             'known_limits':['source tool truncation disclosed; no reconstruction','existing concurrent duplicate review/tag lost-update limits','JDK17 JVM/PS5.1/Edge not independently tested'],
             'new_local_delivery_blockers':[],'no_push_upload_or_email':True}
    save(FINAL/'验收证据/最终验收结果.json',summary)
    report=f'''# 最终交付验收报告

本地交付物已生成，并对最终 ZIP 的全新解压副本进行了实际验证。未发送邮件、上传或 Git Push。文件名是中性暂定名，等待用户检查。

| 项目 | 实际结果 |
| --- | --- |
| AI 协作记录 | 3 个真实会话、12 份正文；{ai['source_user_total']} 条用户输入、{ai['source_codex_total']} 条 Codex 可见回复，遗漏/重复均 0；{ai['total_input_attachments']} 个粘贴输入全文保留 |
| 收尾边界 | 用户明确允许最后一条通知暂不放入；除该通知外，截至快照可见发言逐项覆盖。快照后打包/复验工具结果在本报告与验收证据中保留 |
| 隐私检查 | 常见凭据未命中；无未审查原图/账号头像，AI 仅含 2 张已核查产品截图。历史诊断的本机路径采用标注副本，源记录不改 |
| 项目 ZIP | {ctx['zip_files']:,} 个文件；压缩后 {ctx['zip_bytes']:,} 字节（{ctx['zip_bytes']/1048576:.2f} MiB），解压文件逻辑大小 {ctx['uncompressed_bytes']:,} 字节 |
| JAR 冻结 | 一致，3,054,340 字节；本轮没有重新构建或 Shade |
| Java CLI 独立运行 | {len(cli['checks'])} 项实际检查通过，退出 0；PATH 无 Maven/Git，非管理员。四查询、三预览、显式组合写入、新 JVM 回读及拒绝场景通过 |
| 实际 Mock 变更 | ct_000004 pending→approved，保留恋爱/校园/武侠并加悬疑；历史恰增一条，pending 132→131。不是自动业务合规判断或真实后台联调 |
| HTML 离线运行 | Chrome {browser['browser']}，断网 file://；{browser['check_count']} 项检查通过，控制台警告/错误 0；桌面与 390px、复制/重置/异常/预览/执行、11 份阅读页通过 |
| 文件与导航 | {actual['local_reference_checks']:,} 次本地引用检查无缺失/失效锚点；Jar、src、Demo 与解压前逐文件相同；隐藏 Maven 配置完整 |
| 内外 AI 一致 | {actual['ai_files_equal_inside_outside']} 个 AI 文件逐个 SHA 相同，含索引、12 正文、输入附件、两个安全截图及独立机器报告 |
| ZIP 清洁度 | 无 .git、.contentops、缓存、私人配置或多余 JAR；只在隔离解压副本生成测试状态，不回写暂存或 ZIP |

## 哈希与版本

ZIP SHA-256：`{ctx['zip_sha256']}`  
JAR SHA-256：`{FROZEN}`  
构建源码基线：`{BASE}`。本轮工具基线：`{ctx['initial_head']}`；新增交付工具不改变 src/main 或 pom，也不冒充新的 JAR 构建。

历史任务二 JAR 为 `16859da000d14e9d6b02fe73a330b3a5eedc647f6862d0b20e3ad5675d5091e2`，对应 a726f317。与冻结版不同的事实保留，未取得旧二进制逐条目证明，不声明两个归档完全等价。冻结前 clean verify 的 205 项通过记录保留；本轮没有把它当作重新执行 Maven。

## 目录和复现

- 项目代码包.zip：唯一 ContentOps-CLI 根，保留全部 Java 源码/测试、Maven、Windows 入口、完整 Demo、三项任务、必要历史证据和原始附件。
- AI协作记录/：外置中文 Markdown，多会话分开，核心十阶段连续阅读；ZIP 内 ai-records/submission 与此逐字节一致。
- 说明文档.md / 补充说明.md：从邮件解压开始的查看、运行及限制说明。代码包内“交付说明.md”为直接入口；README 和早期文档中的进度文字是历史记录。
- SHA256SUMS.txt、AI记录文件大小与SHA256.json、文件清单及排除项说明.json：文件/大小/哈希与筛选理由。
- 验收证据/：本次实际 CLI stdout/stderr/退出码、浏览器过程/截图、复验脚本及机器结果。新诊断记录的用户目录遮盖单独列在证据脱敏说明中，原始值仅私有备查。

Java 运行仅需 JDK 21；Windows 实测 PowerShell 7.6.5，不需要 Maven/Git/服务。网页不运行 Java，与 Mock 文件是两种状态。实际命令、参数、进程码和前后事实以验收证据为准，没有用预期值代替运行结果。

## 筛选和边界

按文件类别重新选择，而非直接压缩整个工作区。保留关键 stdout/stderr/退出码三件套、失败和恢复、同批 TXT/JUnit 统计、真实来源哈希。排除 {len(excluded)} 个冗余/本机属性文件（逐项原因在清单），原工作区文件没有删除；含路径的日志以独立 redacted 副本分发，原件不改。早先候选已排除的 10 个重复材料继续不收录。

原始题目、OpenAPI、Mock、任务二和 S5 业务证据不变；候选 1,920 个文件不变。仅新增交付文档、AI、发布证据及最小导航适配副本。未人为补写 docs/05 历史文件，运行说明由 README、交付入口和外置说明提供。公开源码链接只作历史参考，不是邮件交付入口或账号凭据。

来源工具曾有截断、图像残片和 Windows 错误文字编码问题，原状及影响范围已在 AI 记录说明；没有据此删掉已取得的发言、失败或修复，也未编造缺失输出。本轮格式/环境排查原文在私有源记录中保留。

## 未完成项与最终人工检查

未发现新的本地打包/运行阻塞。HTTP、remove/set、交互确认和 Agent 执行器未实现；并发重复审核、标签覆盖、幂等与版本接口不足仍是已知边界，不由串行验收修复。其他系统、Edge、Java 17 JVM、PowerShell 5.1 和真实服务未独立验收。

最后一条通知按用户许可排除；所有后续原始会话继续私有保存。附件中性名称、最后的人工作品审查和是否发送由用户决定。本报告不能视作发送授权，没有实际发送行为。
'''
    (FINAL/'最终交付验收报告.md').write_text(report,encoding='utf8')
    # External artifacts refer to existing siblings; package paths are instructions relative to extracted root.
    for name in ('说明文档.md','补充说明.md'):
        for href in re.findall(r'\]\(([^)]+)\)',(FINAL/name).read_text(encoding='utf8')):assert (FINAL/href).exists(),href
    ext=[{'path':p.relative_to(FINAL).as_posix(),'bytes':p.stat().st_size,'sha256':sha(p)} for p in files(FINAL) if p.name not in ('SHA256SUMS.txt','最终文件清单.json')]
    save(FINAL/'最终文件清单.json',{'files':ext,'excluded_self':['最终文件清单.json','SHA256SUMS.txt'],'no_hash_self_reference':True})
    checksum=''.join(sha(p)+'  '+p.relative_to(FINAL).as_posix()+'\n' for p in files(FINAL) if p.name!='SHA256SUMS.txt')
    (FINAL/'SHA256SUMS.txt').write_text(checksum,encoding='utf8')
    print(json.dumps(summary,ensure_ascii=True,indent=2))


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('phase',choices=['assemble','pack','audit','publish']);args=p.parse_args()
    if args.phase=='assemble':assemble()
    elif args.phase=='pack':pack()
    elif args.phase=='publish':publish()
    else:print(json.dumps(audit(ROOT/ctx['extracted_relative']),ensure_ascii=True,indent=2))
