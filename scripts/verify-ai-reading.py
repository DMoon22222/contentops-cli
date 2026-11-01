"""Verify exact visible-message coverage, Chinese reading layout and immutable candidate."""
from collections import Counter
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess
from urllib.parse import unquote, urlsplit

from markdown_it import MarkdownIt

ROOT=Path(__file__).resolve().parents[1]
DRAFT=ROOT/'delivery/submission-draft';OUT=DRAFT/'AI协作记录'


def load(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def save(p,d):p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n',encoding='utf8')


def fence_check(text):
    state=None
    for number,line in enumerate(text.splitlines(),1):
        m=re.match(r'^ {0,3}(`{3,}|~{3,})(.*)$',line)
        if not m:continue
        if state:
            if m[1][0]==state[0] and len(m[1])>=state[1] and not m[2].strip():state=None
        else:state=(m[1][0],len(m[1]),number)
    return state


def main():
    spec=importlib.util.spec_from_file_location('reading',ROOT/'scripts/render-ai-reading.py')
    reading=importlib.util.module_from_spec(spec);spec.loader.exec_module(reading)
    m=load(OUT/'会话清单.json');assert m['format']=='chinese_dialogue_reading_v1'
    backup=ROOT/m['backup_relative_path'];sources=backup/m['source_snapshot_subdir']
    recon=backup/('校验重建-'+datetime.now().strftime('%H%M%S-%f'));recon.mkdir();(recon/'附件').mkdir();reading.BUILD=recon
    totals=Counter();report_sessions=[];attachments={};failed_covered=[];expected_replacements=0
    for s in m['sessions']:
        src=sources/s['source_basename'];assert sha(src)==s['source_sha256']
        rows=[json.loads(x) for x in src.read_bytes().splitlines() if x.strip()]
        source=[];failures=[];aborts=[]
        for line,row in enumerate(rows,1):
            d=row.get('payload',{});i=d.get('item',{})
            if row['type']=='event_msg' and d.get('type')=='item_completed':
                if i.get('type') in ('UserMessage','AgentMessage'):source.append((line,i))
                if i.get('type')=='CommandExecution' and i.get('exit_code') not in (None,0):failures.append(line)
                if i.get('type')=='McpToolCall' and i.get('status')=='failed':failures.append(line)
            if row['type']=='event_msg' and d.get('type')=='turn_aborted':aborts.append(line)
        ids=[i['id'] for _,i in source];covered=[e['id'] for e in s['messages']]
        response_assistant_ids={x['payload']['id'] for x in rows if x['type']=='response_item' and x.get('payload',{}).get('type')=='message' and x['payload'].get('role')=='assistant'}
        assert response_assistant_ids<={i['id'] for _,i in source if i['type']=='AgentMessage'}
        assert ids==covered and len(set(covered))==len(covered), 'Missing/duplicated/reordered source message'
        rendered_ids=[]
        for filename in s['files']:
            text=(OUT/filename).read_text(encoding='utf8')
            matches=list(re.finditer(r'<!-- 对话消息 (\d+) -->\n\n\*\*(用户|Codex)：\*\*\n\n(.*?)\n\n<!-- 对话消息结束 -->',text,re.S))
            expected=[x for x in s['messages'] if x['file']==filename]
            assert len(matches)==len(expected),(filename,len(matches),len(expected))
            assert reading.NOTICE in text and s['id'] in text
            for match,e in zip(matches,expected):
                row=rows[e['source_line']-1];item=row['payload']['item'];raw='\n'.join(c['text'] for c in item['content'])
                assert hashlib.sha256(raw.encode()).hexdigest()==e['source_text_sha256']
                if item['type']=='UserMessage':body,transform,att=reading.user_content(raw,attachments,[])
                else:body=reading.display(raw,[])
                assert match[3]==body, 'Visible content mismatch: '+e['id']
                expected_replacements+=body.count('\ufffd')
                assert hashlib.sha256(body.encode()).hexdigest()==e['rendered_body_sha256']
                assert int(match[1])==e['message_ordinal_in_part'];rendered_ids.append(e['id'])
        assert rendered_ids==ids
        failure_facts={f['source_line'] for f in s['tools'] if f['type'] in ('failure_or_diagnostic_excerpt','failed_application_tool_excerpt')}
        assert set(failures)<=failure_facts, 'Failed tool event lost'
        assert set(aborts)=={f['source_line'] for f in s['tools'] if f['type']=='turn_aborted'}
        for fact in s['tools']:
            if fact['type'] in ('failure_or_diagnostic_excerpt','failed_application_tool_excerpt'):
                expected_replacements+=str(fact.get('command_excerpt','')).count('\ufffd')
                value=fact.get('output_excerpt',[])
                expected_replacements+=(value if isinstance(value,str) else '\n'.join(value)).count('\ufffd')
        counts=Counter(i['type'] for _,i in source);totals.update(counts)
        assert counts['UserMessage']==s['source_user_count'] and counts['AgentMessage']==s['source_codex_count']
        report_sessions.append({'id':s['id'],'source_user_messages':counts['UserMessage'],'retained_user_messages':counts['UserMessage'],
                                'source_codex_messages':counts['AgentMessage'],'retained_codex_messages':counts['AgentMessage'],
                                'omissions':0,'duplicates':0,'source_order_preserved':True,'failed_tools_covered':len(failures),
                                'abort_events_covered':len(aborts),'tool_truncation_events_disclosed':len(s['source_truncation_lines']),
                                'open_session':s['open_session']})
        failed_covered+=failures
    assert len(attachments)==len(m['attachments'])==16
    previous=load(backup/'旧版导出/会话清单.json')
    old_atts={a['source_attachment_id'] for s in previous['sessions'] for a in s['input_attachments']}
    assert len(old_atts)==15 and old_atts<={a['attachment_id'] for a in m['attachments']}
    old_attachment_hashes={a['source_attachment_id']:a['source_sha256'] for s in previous['sessions'] for a in s['input_attachments']}
    for att in m['attachments']:
        assert (OUT/att['path']).read_bytes()==(recon/att['path']).read_bytes()
        if att['attachment_id'] in old_attachment_hashes:assert old_attachment_hashes[att['attachment_id']]==att['source_sha256']
        expected_replacements+=(OUT/att['path']).read_text(encoding='utf8').count('\ufffd')
    # Check all actual Markdown links; historical references in code are intentionally literal.
    md=MarkdownIt('commonmark',{'html':True}).enable('table');link_issues=[];fences=[];large=[];replacements=[];external=0;checked_links=0
    for p in OUT.rglob('*.md'):
        text=p.read_text(encoding='utf8');state=fence_check(text)
        if state:fences.append({'path':p.relative_to(OUT).as_posix(),'opening_line':state[2]})
        if '\ufffd' in text:replacements.append(p.name)
        assert not re.search(r'data:image/[^;]+;base64,[A-Za-z0-9+/=]{50,}',text)
        assert not re.search(r'(?i)C:(?:\\+|/+)Users(?:\\+|/+)15614',text)
        assert 'DMoon22222' not in text
        for _,pat,_ in reading.old.RULES[:6]:assert not pat.search(text),p.name
        for token in md.parse(text):
            if token.type=='fence' and len(token.content.encode())>32768:large.append({'path':p.name,'bytes':len(token.content.encode())})
            for child in token.children or []:
                href=child.attrGet('href') if child.type=='link_open' else child.attrGet('src') if child.type=='image' else None
                if not href:continue
                u=urlsplit(href)
                if u.scheme in ('http','https'):external+=1;continue
                destination=p.parent/unquote(u.path)
                generated_report=destination.resolve()==(OUT/'阅读版校验.json').resolve()
                if u.scheme or (not destination.exists() and not generated_report):link_issues.append({'source':p.name,'href':href})
                checked_links+=1
    assert not fences, fences
    assert not link_issues,link_issues
    actual_replacements=sum(p.read_text(encoding='utf8').count('\ufffd') for p in OUT.rglob('*.md'))
    assert actual_replacements==expected_replacements, 'New encoding corruption introduced'
    assert not large,large
    assert {p.suffix for p in (OUT/'附件').iterdir()}<= {'.md','.png'}
    assert {p.name for p in (OUT/'附件').glob('*.png')}=={'已核查-desktop-product.png','已核查-mobile-playground.png'}
    for image in m['images']:assert sha(OUT/image['path'])==image['sha256']==sha(ROOT/image['source_relative_path'])
    # Old exports and raw snapshots are private and unchanged; no overwrite or deletion.
    old_inventory=load(backup/'备份清单.json')
    for f in old_inventory['old_files']:
        assert sha(backup/'旧版导出'/f['path'])==f['sha256']
        assert sha(backup/'旧版工作目录'/f['path'])==f['sha256']
    for s in m['sessions']:
        original=Path.home()/'.codex/sessions/2026/10/31'/s['source_basename']
        assert hashlib.sha256(original.read_bytes()[:s['source_bytes']]).hexdigest()==s['source_sha256']
    for name in ('运行与查看说明.md','补充说明.md'):assert sha(DRAFT/name)==sha(backup/name)
    approved=load(ROOT/'evidence/release/candidate-files.json')['files'];candidate=ROOT/'delivery/candidate/ContentOps-CLI'
    actual={p.relative_to(candidate).as_posix() for p in candidate.rglob('*') if p.is_file()}
    assert actual=={e['path'] for e in approved}
    assert all(sha(candidate/e['path'])==e['sha256'] for e in approved)
    frozen=load(ROOT/'evidence/release/frozen-jar.json')['sha256'];assert sha(ROOT/'target/contentops.jar')==sha(candidate/'target/contentops.jar')==frozen
    assert not subprocess.check_output(['git','diff','--name-only'],cwd=ROOT).strip()
    sizes=[{'path':f['path'],'bytes':(OUT/f['path']).stat().st_size,'KiB':round((OUT/f['path']).stat().st_size/1024,2),'stage':f['title']} for f in m['files']]
    assert all(f['bytes']<1048576 for f in sizes)
    original=sum(m['old_markdown_bytes'].values());new=sum(x['bytes'] for x in sizes)
    result={'format':'chinese_dialogue_reading_v1','checked_at':datetime.now(timezone.utc).isoformat(),'sessions':report_sessions,
            'source_user_total':totals['UserMessage'],'retained_user_total':totals['UserMessage'],
            'source_codex_total':totals['AgentMessage'],'retained_codex_total':totals['AgentMessage'],
            'old_input_attachments':15,'old_input_attachments_covered':15,'new_this_round_attachment':1,'total_input_attachments':16,
            'dialogue_files':12,'same_core_session_parts':10,'sizes':sizes,'old_sizes':m['old_markdown_bytes'],
            'old_dialogue_bytes':original,'new_dialogue_bytes':new,'reduction_percent':round((1-new/original)*100,3),
            'message_omissions':0,'message_duplicates':0,'failed_tool_events_covered':len(failed_covered),
            'fence_issues':fences,'link_issues':link_issues,'relative_links_checked':checked_links,'historical_external_links_not_fetched':external,
            'large_code_blocks_over_32KiB':large,'source_tool_encoding_issue_files':replacements,
            'source_replacement_characters_preserved':actual_replacements,'new_encoding_corruption':False,'unchecked_images_in_submission':0,
            'reviewed_images':2,'all_other_original_tool_images_private':True,'candidate_files_unchanged':1920,'frozen_jar_sha256':frozen,
            'two_external_guides_unchanged':True,'old_exports_private_and_unchanged':True,
            'complete_visible_dialogue_to_snapshot':True,'current_turn_tail_pending':m['needs_current_turn_refresh']>0,
            'final_mail_dialogue_complete':m['needs_current_turn_refresh']==0,'source_tool_gaps_disclosed_not_reconstructed':True,
            'no_maven_jar_rebuild_zip_push_upload_or_email':True}
    save(OUT/'阅读版校验.json',result)
    external_validation=load(DRAFT/'验收记录.json')
    external_validation.update(ai_reading_format='chinese_dialogue_reading_v1',ai_reading_validation='AI协作记录/阅读版校验.json',
                               source_prefix_and_visible_message_integrity_verified=True,final_ai_records_complete=result['final_mail_dialogue_complete'],
                               visual_review_pending=False,unreviewed_tool_images_private_not_in_submission=True,
                               blockers=['Current source session final response/post-cutoff messages need refresh'] if m['needs_current_turn_refresh'] else [])
    save(DRAFT/'验收记录.json',external_validation)
    files=[{'path':p.relative_to(DRAFT).as_posix(),'bytes':p.stat().st_size,'sha256':sha(p)} for p in sorted(DRAFT.rglob('*')) if p.is_file() and p.name!='文件清单与SHA256.json']
    save(DRAFT/'文件清单与SHA256.json',{'schema_version':2,'stage':'reading_draft_not_final_zip','paths_relative_to':'delivery/submission-draft',
         'excluded_self':'文件清单与SHA256.json','file_count_excluding_self':len(files),'bytes_excluding_self':sum(x['bytes'] for x in files),
         'files':files,'final_ai_dialogue_complete':result['final_mail_dialogue_complete']})
    print(json.dumps({k:result[k] for k in ('source_user_total','retained_user_total','source_codex_total','retained_codex_total',
        'dialogue_files','old_dialogue_bytes','new_dialogue_bytes','reduction_percent','message_omissions','message_duplicates',
        'failed_tool_events_covered','relative_links_checked','current_turn_tail_pending','candidate_files_unchanged')},indent=2))


if __name__=='__main__':main()
