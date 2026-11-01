"""Build Chinese dialogue from three exact, privately snapshotted project sessions."""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timedelta, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'delivery/submission-draft/AI协作记录'
BACKUP = ROOT / json.loads((ROOT / '.contentops/submission-qa/reading-backup-location.json').read_text(encoding='utf8'))['backup_relative_path']
SOURCE = BACKUP / json.loads((ROOT / '.contentops/submission-qa/reading-backup-location.json').read_text(encoding='utf8')).get('source_subdir','原始记录快照')
BUILD = BACKUP / ('阅读版构建-' + datetime.now().strftime('%H%M%S-%f'))
spec = importlib.util.spec_from_file_location('old_export', ROOT / 'scripts/export-project-records.py')
old = importlib.util.module_from_spec(spec)
spec.loader.exec_module(old)
PARTS = [
    (1, 1, '需求与接口分析'), (2, 3, 'MVP产品方案'), (4, 9, '技术架构与工程规划'),
    (10, 10, 'JavaCLI基础开发'), (11, 11, '审核与标签开发'), (12, 14, '故障注入与任务二'),
    (15, 15, 'Agent批量处理方案'), (16, 20, 'HTMLDemo与交互优化'),
    (21, 23, '可靠性与命令体验'), (24, 10000, '最终交付准备')]
NOTICE = '本文件完整保留可取得的用户输入与 Codex 可见文本回复；底层工具日志经过阅读化整理，关键命令、错误、失败修复和验证结果保留。原始记录未修改，工具原始输出不属于本阅读版全文。'
LINK = re.compile(r'!?\[(?:[^\[\]\n]|\[[^\]\n]*\])*\]\(([^)\n]+)\)')
FENCE = re.compile(r'^ {0,3}(`{3,}|~{3,})(.*)$')
ERROR = re.compile(r'^Traceback|^\s*(?:[\w.]*Error|[\w.]*Exception|Exception in thread|CHECK FAILED|browserType\.launch|locator\.click):|^\[ERROR\]|^Get-Content:|^Set-Content:|^Remove-Item:|spawn EPERM', re.I)
RESULT = re.compile(r'^\[INFO\] (?:Tests run:|BUILD |Total time:)|^PASS:|^Tests run:|^Maven actual exit:|^Ran \d+ tests|^OK$', re.I)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def redact(text):
    text = text.replace('\r\n','\n').replace('\r','\n')
    for _, pattern, replacement in old.RULES:
        text = pattern.sub(replacement, text)
    return text


def literal(text):
    ticks = '`' * max(1, max((len(s) for s in re.findall(r'`+', text)), default=0) + 1)
    return ticks + text + ticks


def local_time(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00')).astimezone(timezone(timedelta(hours=8))).strftime('%Y-%m-%d %H:%M:%S UTC+8')


def display(text, edits):
    """Keep code fences and inline code intact. Historical local links become literal references."""
    text = redact(text)
    lines, opened = [], None
    for line in text.splitlines(keepends=True):
        m = FENCE.match(line)
        if opened:
            lines.append(line)
            if m and m[1][0] == opened[0] and len(m[1]) >= opened[1] and not m[2].strip():
                opened = None
            continue
        if m:
            opened = (m[1][0], len(m[1])); lines.append(line); continue
        pieces = re.split(r'(`+[^`\n]*`+)', line)
        for i in range(0, len(pieces), 2):
            def replace(match):
                href = match[1]
                if re.match(r'^https?://', href, re.I) and '[已脱敏_' not in href:
                    return match[0]
                edits.append({'original_reference': match[0], 'reason': 'Historical local/image/app reference shown literally; no unchecked image loaded'})
                return literal(match[0])
            pieces[i] = LINK.sub(replace, pieces[i])
        lines.append(''.join(pieces))
    return ''.join(lines)


def user_content(text, attachments, edits):
    match = old.ATTACHMENT.search(text)
    if match:
        source = Path(match[1])
        assert source.is_file() and source.resolve().is_relative_to((Path.home()/'.codex/attachments').resolve())
        raw = source.read_bytes(); body = raw.decode('utf-8-sig')
        name = '附件/粘贴输入-' + source.parent.name + '.md'
        formatted = display(body, edits)
        (BUILD / name).write_text('# 原始粘贴输入全文\n\n编排说明：这是对应用户消息实际提交的附件全文，仅做已声明的隐私遮盖、行尾统一和历史链接展示处理。\n\n' + formatted + '\n', encoding='utf8',newline='\n')
        attachments[name] = {'path': name, 'attachment_id': source.parent.name, 'source_sha256': sha(raw),
                             'source_bytes': len(raw), 'rendered_text_sha256': sha(formatted.encode()), 'included_inline': True}
        tail = text.split('## My request:', 1)[1].strip() if '## My request:' in text else ''
        content = '> 编排说明：本条输入原通过粘贴附件提交，以下恢复附件全文。\n\n' + formatted
        if tail:
            content += '\n\n' + display(tail, edits)
        content += '\n\n附件原文亦可单独打开：[' + name + '](' + name + ')。\n'
        return content, 'pasted_attachment_restored', name
    if text.startswith('<send_user_message_question_reply>'):
        closing = '</send_user_message_question_reply>'
        body, separator, trailing = text.partition(closing)
        assert separator, 'Missing reply control closing tag'
        body = body.removeprefix('<send_user_message_question_reply>').strip()
        answers = json.loads(body)
        content = '> 编排说明：以下将问题控件的传输包装显示为问题和回答；措辞按源内容保留。\n\n'
        for answer in answers:
            content += '**问题：**\n\n' + display(answer['question'], edits) + '\n\n**回答：**\n\n' + display(answer['answer'], edits) + '\n\n'
        if trailing.strip():
            content += display(trailing, edits)
        return content, 'question_control_unwrapped', None
    return display(text, edits), 'visible_text', None


def command_text(item):
    cmd = item.get('command', [])
    return str(cmd[-1]) if isinstance(cmd, list) and cmd else str(cmd)


def tool_summary(events, facts):
    counts = Counter(i['type'] for _, _, i in events)
    commands = [(line, ts, i) for line, ts, i in events if i['type'] == 'CommandExecution']
    failed = [(line, ts, i) for line, ts, i in commands if i.get('exit_code') not in (None, 0)]
    changes = []
    for line, ts, item in events:
        entry = {'source_line': line, 'timestamp': ts, 'type': item['type'], 'id': item.get('id')}
        if item['type'] == 'CommandExecution':
            entry.update(exit_code=item.get('exit_code'), status=item.get('status'), command_sha256=sha(command_text(item).encode()))
        if item['type'] == 'FileChange':
            entry['paths'] = [redact(p) for p in item.get('changes', {})]
            changes += entry['paths']
        if item['type'] == 'McpToolCall':
            entry.update(status=item.get('status'), tool=item.get('tool'), server=item.get('server'))
        facts.append(entry)
    bullets = []
    if commands:
        bullets.append(f'记录到 {len(commands)} 次终端调用，其中 {len(failed)} 次外层退出码非 0。退出码仅指对应终端调用，不将它等同于内层业务结果。')
    if changes:
        names = list(dict.fromkeys(changes))
        readable = [p.replace(str(ROOT)+'\\', '').replace(ROOT.as_posix()+'/', '') for p in names]
        bullets.append('记录到文件变更：' + '、'.join(literal(x) for x in readable[:10]) + (f' 等 {len(names)} 个路径' if len(names)>10 else '') + '。')
    if counts['McpToolCall']:
        bullets.append(f'记录到 {counts["McpToolCall"]} 次资料/应用/浏览器工具调用；不重复其底层事件包装。')
    if counts['Extension']:
        bullets.append(f'记录到 {counts["Extension"]} 次资料检索事件；大体积检索载荷留在私有备查。')
    if counts['ImageView']:
        bullets.append(f'记录到 {counts["ImageView"]} 次图像查看；未经签收的工具原图不进入阅读版附件。')
    details = []
    for line, ts, item in events:
        if item['type']=='McpToolCall' and item.get('status')=='failed':
            error=redact(json.dumps(item.get('result'),ensure_ascii=False))
            excerpt=error if len(error)<=800 else error[:800]+' ……（工具错误节选）'
            details.append('- 工具调用 '+literal(str(item.get('tool')))+' 返回 failed，原始错误节选：\n\n'+old.fence(excerpt,'text'))
            facts.append({'source_line':line,'type':'failed_application_tool_excerpt','tool':item.get('tool'),'output_excerpt':excerpt})
    for line, ts, item in commands:
        output = item.get('aggregated_output', '') or ''
        error_lines = [s for s in output.splitlines() if ERROR.search(s) and s.strip()]
        result_lines = [s for s in output.splitlines() if RESULT.search(s)]
        failed_call = item.get('exit_code') not in (None, 0)
        if failed_call or error_lines:
            cmd = redact(command_text(item)).strip()
            cmd_excerpt = cmd if len(cmd)<=420 else cmd[:420]+' ……（命令节选）'
            excerpt = []
            for s in error_lines[:8] or output.splitlines()[-5:]:
                s=redact(s)
                excerpt.append(s if len(s)<=500 else s[:500]+' ……（工具输出节选）')
            encoding_note='源错误输出本来含有乱码/替换字符；保留原文，不据此改写错误内容。\n\n' if any('\ufffd' in s for s in excerpt) else ''
            details.append('- 终端调用外层退出码：' + str(item.get('exit_code')) + '；原命令/脚本节选：\n\n' + old.fence(cmd_excerpt, 'powershell') + '\n返回中的错误/诊断节选（不推断整次业务是否成功）：\n\n' + encoding_note + old.fence('\n'.join(excerpt), 'text'))
            facts.append({'source_line': line, 'type': 'failure_or_diagnostic_excerpt', 'exit_code': item.get('exit_code'),
                          'command_excerpt': cmd_excerpt, 'output_excerpt': excerpt})
        elif result_lines:
            details.append('- 终端返回中的结果行（原文节选，是否为本次验证需结合上述实际命令与对话）：\n\n' + old.fence('\n'.join(redact(s) for s in result_lines[:5]), 'text'))
    # Each actual nonzero terminal call is retained; diagnostic matches may include quoted historical failures.
    if not bullets and not details:
        return ''
    return '**执行过程（依据工具记录整理，非 Codex 原始发言）：**\n\n' + '\n'.join('- '+b for b in bullets) + '\n\n' + '\n\n'.join(details) + '\n'


def main():
    assert BACKUP.resolve().is_relative_to((ROOT/'.contentops').resolve()) and not BUILD.exists()
    BUILD.mkdir();(BUILD/'附件').mkdir()
    old_inventory = json.loads((BACKUP/'备份清单.json').read_text(encoding='utf8'))
    summary = {'format': 'chinese_dialogue_reading_v1', 'generated_at': datetime.now(timezone.utc).isoformat(),
               'confirmed_sessions': 3, 'acquired': 3, 'ended_message_exports': 2, 'pending_manual_export': 0,
               'needs_current_turn_refresh': 0, 'sessions': [], 'files': [], 'attachments': [], 'images': [],
               'old_markdown_bytes': {x['path']:x['bytes'] for x in old_inventory['old_files'] if x['path'].startswith('会话') and x['path'].endswith('.md')},
               'backup_relative_path': BACKUP.relative_to(ROOT).as_posix(), 'source_snapshot_subdir': SOURCE.relative_to(BACKUP).as_posix(), 'tools_are_reading_summaries_not_full_outputs': True}
    all_attachments = {}
    for sid, oldname, title, scope in old.SESSIONS:
        src = next(SOURCE.glob('*'+sid+'.jsonl'));raw = src.read_bytes();rows = [json.loads(s) for s in raw.splitlines() if s.strip()]
        meta = next(x['payload'] for x in rows if x['type']=='session_meta');assert meta['id']==sid and Path(meta['cwd']).resolve()==ROOT
        lifecycle=[x['payload']['type'] for x in rows if x['type']=='event_msg' and x.get('payload',{}).get('type') in ('task_started','task_complete','turn_aborted')]
        session_active=bool(lifecycle and lifecycle[-1]=='task_started')
        summary['needs_current_turn_refresh']+=int(session_active)
        groups = {};user_number=0;current_round=None;current_part=None;counts=Counter();coverage=[];events=[];tool_facts=[];round_meta=[];edits=[]
        filenames = [f'会话01-{n:02d}-{p[2]}.md' for n,p in enumerate(PARTS,1)] if sid==old.SESSIONS[0][0] else [oldname]
        def flush():
            nonlocal events
            if events:
                groups[current_part].append(tool_summary(events, tool_facts));events=[]
        for line,row in enumerate(rows,1):
            d=row.get('payload',{})
            if row['type']=='event_msg' and d.get('type')=='item_completed':
                item=d.get('item',{});typ=item.get('type')
                if typ in ('UserMessage','AgentMessage'):
                    flush()
                    text='\n'.join(c['text'] for c in item['content']);counts[typ]+=1
                    if typ=='UserMessage':
                        user_number+=1;current_round=user_number
                        current_part=next(n for n,(a,b,_) in enumerate(PARTS) if a<=user_number<=b) if sid==old.SESSIONS[0][0] else 0
                        groups.setdefault(current_part,[])
                        groups[current_part].append(f'\n---\n\n### 第 {user_number} 轮\n\n')
                        body,transform,att=user_content(text,all_attachments,edits)
                        round_meta.append({'number':current_round,'part':current_part+1,'user_source_line':line,'attachment':att})
                    else:
                        assert current_part is not None;body=display(text,edits);transform='visible_text';att=None
                    ordinal=sum(1 for m in coverage if m['part']==current_part+1)+1
                    marker=f'<!-- 对话消息 {ordinal:03d} -->'
                    rendered=marker+'\n\n**'+('用户' if typ=='UserMessage' else 'Codex')+'：**\n\n'+body+'\n\n<!-- 对话消息结束 -->\n\n'
                    groups[current_part].append(rendered)
                    coverage.append({'id':item['id'],'role':typ,'source_line':line,'timestamp':row['timestamp'],'round':current_round,
                                     'part':current_part+1,'file':filenames[current_part],'message_ordinal_in_part':ordinal,
                                     'source_text_sha256':sha(text.encode()),'rendered_body_sha256':sha(body.encode()),
                                     'transform':transform,'attachment':att,'rendered_block_sha256':sha(rendered.encode())})
                elif current_part is not None and typ in ('CommandExecution','FileChange','McpToolCall','Extension','ImageView'):
                    events.append((line,row['timestamp'],item))
            elif row['type']=='event_msg' and d.get('type')=='turn_aborted' and current_part is not None:
                flush();groups[current_part].append('**执行过程与问题（源事件）：本轮出现中断，未将未完成操作标为成功。**\n\n')
                tool_facts.append({'source_line':line,'type':'turn_aborted','timestamp':row['timestamp']})
        flush()
        for part,body in groups.items():
            msgs=[m for m in coverage if m['part']==part+1];users=sum(m['role']=='UserMessage' for m in msgs);ai=len(msgs)-users
            name=filenames[part];parttitle=PARTS[part][2] if len(filenames)>1 else scope
            nav=[]
            if part:nav.append('[上一部分]('+filenames[part-1]+')')
            nav.append('[返回索引](索引.md)')
            if part+1<len(filenames):nav.append('[下一部分]('+filenames[part+1]+')')
            head=f'# AI 协作记录｜会话 {"01" if len(filenames)>1 else ("02" if sid==old.SESSIONS[1][0] else "03")}' + (f'·第 {part+1:02d} 部分' if len(filenames)>1 else '') + f'\n\n## {parttitle}\n\n'
            head+='**AI 工具：** Codex  \n**原始会话：** `'+sid+'`  \n'
            head+='**实际消息时间：** '+local_time(msgs[0]['timestamp'])+' 至 '+local_time(msgs[-1]['timestamp'])+'  \n'
            head+=f'**原始消息范围：** 该会话用户消息第 {msgs[0]["round"]}–{msgs[-1]["round"]} 条所对应的连续可见对话；本部分用户 {users} 条、Codex 文本 {ai} 条。源事件定位仅放机器清单。\n\n'
            head+=NOTICE+'\n\n编排说明：轮次按用户消息顺序编号，补充答复也单列；保留原始 Markdown 正文，行尾统一为 LF。历史本机/图片引用仅显示原引用文字，不自动加载；问题控件仅展开问题和回答，粘贴输入恢复全文。上述展示与隐私处理均在机器清单中可核对。\n\n'
            head+=' · '.join(nav)+'\n\n'
            active=session_active and part+1==len(filenames)
            if active:head+='**快照限制：本部分包含本轮阅读版整理要求，但本轮仍在进行；截止点之后的消息及最终回复待补。**\n\n'
            (BUILD/name).write_text(head+''.join(body),encoding='utf8',newline='\n')
            summary['files'].append({'path':name,'session_id':sid,'part':part+1,'title':parttitle,'user_messages':users,'codex_messages':ai,
                                     'first_timestamp':msgs[0]['timestamp'],'last_timestamp':msgs[-1]['timestamp'],'open_part':active})
        source_trunc=[]
        for line,row in enumerate(rows,1):
            if row['type'] in ('response_item','event_msg') and row.get('payload',{}).get('type') not in ('reasoning',):
                d=json.dumps(row.get('payload',{}),ensure_ascii=False)
                if any(s in d for s in ['Warning: truncated output','Output exceeded the available','chars truncated']):source_trunc.append(line)
        summary['sessions'].append({'id':sid,'title':title,'scope':scope,'source_basename':src.name,'source_bytes':len(raw),'source_sha256':sha(raw),
                                    'snapshot_last_timestamp':rows[-1]['timestamp'],'source_user_count':counts['UserMessage'],'source_codex_count':counts['AgentMessage'],
                                    'messages':coverage,'rounds':round_meta,'tools':tool_facts,'presentation_reference_edits':edits,
                                    'source_truncation_lines':source_trunc,'files':filenames,'open_session':session_active})
    summary['attachments']=list(all_attachments.values())
    summary['ended_message_exports']=sum(not s['open_session'] for s in summary['sessions'])
    # Only two already visually reviewed product screenshots are copied; all other tool images stay private.
    for rel in ('evidence/release/browser/run-04/desktop-product.png','evidence/release/browser/run-04/mobile-playground.png'):
        p=ROOT/rel;h=sha(p.read_bytes());name='附件/已核查-'+p.name
        shutil.copyfile(p,BUILD/name);summary['images'].append({'path':name,'source_relative_path':rel,'sha256':h,'privacy_review':'visually_reviewed_product_UI_no_account_avatar_or_private_path'})
    write_index(summary)
    (BUILD/'会话清单.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    archive=BACKUP/'旧版工作目录'
    if archive.exists():
        archive=BACKUP/('中间阅读版-'+datetime.now().strftime('%H%M%S-%f'))
    assert OUT.resolve()==(ROOT/'delivery/submission-draft/AI协作记录').resolve() and archive.resolve().is_relative_to((ROOT/'.contentops').resolve())
    assert not archive.exists() and BUILD.resolve().is_relative_to(BACKUP.resolve())
    OUT.rename(archive);BUILD.rename(OUT)
    print(json.dumps({'dialogue_files':len(summary['files']),'attachments':len(summary['attachments']),
                      'counts':[{'id':s['id'],'user':s['source_user_count'],'codex':s['source_codex_count']} for s in summary['sessions']],
                      'old_exports_preserved_private':True,'snapshot_tail_pending':summary['needs_current_turn_refresh']>0},ensure_ascii=True,indent=2))


def write_index(s):
    text='# AI 协作记录\n\n本项目使用 Codex 辅助开发。用户确认只使用这 3 个会话，没有其他 ChatGPT/AI 会话。以下按原始会话和实际开发阶段整理；不是开发过程总结。\n\n## 会话 01：核心开发\n\n十部分来自同一个原始会话，不代表十个独立会话。\n\n| 部分 | 内容 | 文件 | 用户 / Codex 消息 | 大小 |\n| --- | --- | --- | --- | --- |\n'
    for f in s['files'][:10]:
        size=(BUILD/f['path']).stat().st_size
        text+=f'| {f["part"]:02d} | {f["title"]} | [阅读]({f["path"]}) | {f["user_messages"]} / {f["codex_messages"]} | {size/1024:.1f} KiB |\n'
    text+='\n## 会话 02：仓库与交付\n\n[查看对话记录](会话02-仓库与交付.md) · 原应用标题：创建公开 GitHub 仓库；'+f'{(BUILD/"会话02-仓库与交付.md").stat().st_size/1024:.1f} KiB。\n\n## 会话 03：工具配置\n\n[查看对话记录](会话03-工具配置.md) · 原应用标题：配置并验证 Codex 开发工具；'+f'{(BUILD/"会话03-工具配置.md").stat().st_size/1024:.1f} KiB。\n\n'
    total_u=sum(x['source_user_count'] for x in s['sessions']);total_a=sum(x['source_codex_count'] for x in s['sessions'])
    text+=f'## 真实性及完整性说明\n\n{NOTICE}\n\n- 快照内共 {total_u} 条用户输入、{total_a} 条 Codex 可见文本消息；源事件 ID、消息哈希、分卷定位和工具出处放在 [机器清单](会话清单.json)，不占用阅读正文。\n'
    text+='- 原有 15 个粘贴输入全部保留，并恢复到原用户轮次；本轮另有 1 个新粘贴提示词，合计 16 个，附件目录也保留全文。\n'
    text+='- 工具过程按实际调用、文件变更、非零退出、中断和原始错误/结果节选整理；修复说明仍来自相邻真实 Codex 回复。没有逐项重复底层 JSON、Base64、进程 ID 或数千行终端输出。工具日志节选不冒充完整工具原文。\n'
    text+='- 代码块、表格、列表及技术术语保留；仅延续已标注的隐私遮盖。问题控件展开问题/回答，粘贴附件恢复真实全文，历史本机/图片链接显示为引用文字，避免失效导航或自动加载未审查图像。原包装与未变更源记录在本地私有备查。\n'
    if s['needs_current_turn_refresh']:
        text+='- 已结束会话的全部可见文字已取得；会话 01 第 10 部分仍为当前轮快照，最终回复及截止点后内容待补。**因此不能宣布整个最终邮件会话材料已经收尾完整。**\n'
    else:
        text+='- 三会话均已结束；本次快照内可取得的用户与 Codex 文字已全部收录。源工具截断与图片不属于原工具全文的边界仍按下述说明保留。\n'
    text+='- 来源工具有截断/中断事实；源端未返回的输出和两处无效图像片段不补造。阅读版没有以工具截断为理由删减用户或 Codex 已有文字。\n'
    text+='- 第 08 部分保留的两次 Windows 权限错误输出，源记录本来已有乱码；已在原错误节选前标注，未擅自修复其文字。用户/Codex 正文与来源逐条核对，文件统一 UTF-8。\n'
    text+='- 未完成隐私审查的原图和已知含账号名/头像的图像均留在私有备查，不在本目录。仅保留两张已查看的产品 UI 截图：[桌面](附件/已核查-desktop-product.png)、[移动端](附件/已核查-mobile-playground.png)。其他原回复图片引用保留文字；如需补图，应先审查或制作标注过的最小遮盖副本。\n'
    new_bytes=sum((BUILD/f['path']).stat().st_size for f in s['files']);old_bytes=sum(s['old_markdown_bytes'].values())
    text+=f'- 原三份正文合计 {old_bytes:,} 字节；新 12 份正文合计 {new_bytes:,} 字节，减少 {(1-new_bytes/old_bytes)*100:.2f}%。缩小来自工具视图整理，没有截断用户/AI 发言。\n'
    text+='- 完整运行证据在配套产品的 ContentOps-CLI/evidence/；运行说明与补充说明在本目录的上一层。原 JSONL 与旧版大文件保持私有，不属于公开提交件，也没有被删除。\n\n大小、覆盖、重复/遗漏和 Markdown/链接检查见 [阅读版校验](阅读版校验.json)。当前没有制作 ZIP、上传、push 或发送邮件。\n'
    (BUILD/'索引.md').write_text(text,encoding='utf8')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--refresh-source',action='store_true');args=parser.parse_args()
    if args.refresh_source:
        subdir='原始记录快照-'+datetime.now().strftime('%H%M%S-%f');SOURCE=BACKUP/subdir;SOURCE.mkdir()
        for sid,_,_,_ in old.SESSIONS:
            path=next((Path.home()/'.codex/sessions/2026/10/31').glob('*'+sid+'.jsonl'));data=path.read_bytes();(SOURCE/path.name).write_bytes(data[:data.rfind(b'\n')+1])
        location=ROOT/'.contentops/submission-qa/reading-backup-location.json';info=json.loads(location.read_text(encoding='utf8'));info['source_subdir']=subdir;location.write_text(json.dumps(info,ensure_ascii=False),encoding='utf8')
    main()
