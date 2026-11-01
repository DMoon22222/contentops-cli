"""Append only new visible messages from the three confirmed local Codex snapshots.

This module reuses the existing reading transformations. It never changes JSONL,
rebuilds the product, downloads images, or exports internal reasoning.
"""
from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import shutil
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
FORMAT = 'chinese_dialogue_reading_incremental_v1'
CORE = [
    (33, 11, '原交付尾部与UTF8修复'),
    (35, 12, '精简交付包盘点与验收'),
    (39, 13, '交互式Shell实现与推送'),
    (10000, 14, '新版交付包与AI记录收尾'),
]
TRUNCATION = re.compile(r'truncated output|Output exceeded|chars truncated|tokens truncated|\[truncated\]', re.I)
MESSAGE = re.compile(r'<!-- 对话消息 (\d+) -->\n\n## (用户|Codex)\n\n(.*?)\n\n<!-- 对话消息结束 -->', re.S)


def load(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def digest(data):
    return hashlib.sha256(data).hexdigest()


def sha(path):
    return digest(path.read_bytes())


def save(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def reading_module():
    spec = importlib.util.spec_from_file_location('reading_helpers', ROOT / 'scripts/render-ai-reading.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def visible(rows):
    return [(line, row, row['payload']['item']) for line, row in enumerate(rows, 1)
            if row['type'] == 'event_msg' and row.get('payload', {}).get('type') == 'item_completed'
            and row['payload'].get('item', {}).get('type') in ('UserMessage', 'AgentMessage')]


def text(item):
    assert all(c['type'] in ('text', 'Text') for c in item['content']), 'Non-text visible message needs explicit review'
    return '\n'.join(c['text'] for c in item['content'])


def rows_at(path, sid):
    raw = path.read_bytes()
    assert raw.endswith(b'\n'), 'Snapshot must contain complete JSONL rows only'
    rows = [json.loads(line) for line in raw.splitlines() if line.strip()]
    meta = next(r['payload'] for r in rows if r['type'] == 'session_meta')
    assert meta['id'] == sid and Path(meta['cwd']).resolve() == ROOT
    return raw, rows


def output_summary(events, facts, reading):
    """Excerpts, explicitly NOT complete raw tool logs; retain hashes for provenance."""
    before = len(facts)
    summary = reading.tool_summary(events, facts)
    summary = summary.replace('**执行过程（依据工具记录整理，非 Codex 原始发言）：**',
                              '**工具输出摘要（依据来源整理，不是完整原始工具日志或 Codex 发言）：**')
    commands = []
    for line, timestamp, item in events:
        if item['type'] != 'CommandExecution':
            continue
        command = reading.command_text(item)
        cleaned = reading.redact(command)
        excerpt = cleaned if len(cleaned) <= 1200 else cleaned[:1200] + '\n……（命令节选；完整内容仅在原始来源）'
        raw_output = item.get('aggregated_output', '') or ''
        facts.append({'source_line': line, 'timestamp': timestamp, 'type': 'command_provenance',
                      'id': item.get('id'), 'command_sha256': digest(command.encode()),
                      'source_output_sha256': digest(raw_output.encode()), 'source_output_characters': len(raw_output),
                      'command_excerpt': excerpt, 'exit_code': item.get('exit_code'),
                      'source_output_has_truncation_marker': bool(TRUNCATION.search(raw_output)),
                      'output_is_reading_summary': True})
        commands.append('- 来源行 ' + str(line) + '，工具退出码 ' + str(item.get('exit_code')) +
                        '；命令' + ('节选' if len(cleaned) > 1200 else '原文（已脱敏）') + '：\n\n' +
                        reading.old.fence(excerpt, 'powershell'))
    if commands:
        summary += '\n**命令定位（工具输出摘要；不是新增对话）：**\n\n' + '\n'.join(commands) + '\n'
    if len(facts) > before and summary:
        facts.append({'type': 'rendered_tool_summary', 'first_source_line': events[0][0],
                      'last_source_line': events[-1][0], 'rendered_sha256': digest(summary.encode())})
    return summary


def append_records(source_dir, out, baseline_path):
    reading = reading_module()
    base = load(baseline_path)
    manifest_path = out / '会话清单.json'
    assert sha(manifest_path) == base['old_manifest_sha256'], 'Refuse duplicate append or unverified baseline'
    m = load(manifest_path)
    assert m['format'] == 'chinese_dialogue_reading_v1'
    assert [s['id'] for s in m['sessions']] == [s[0] for s in reading.old.SESSIONS]
    assert source_dir.resolve().is_relative_to((ROOT / '.contentops').resolve())
    history = baseline_path.parent / 'validated-history'
    assert not history.exists()
    shutil.copytree(out, history)
    reading.BUILD = out
    all_attachments = {a['path']: a for a in m['attachments']}
    original_files = {p.relative_to(out).as_posix(): sha(p) for p in out.rglob('*') if p.is_file()}
    baseline_users = sum(s['source_user_count'] for s in m['sessions'])
    baseline_ai = sum(s['source_codex_count'] for s in m['sessions'])
    new_files = []
    for session, captured in zip(m['sessions'], base['sessions']):
        path = source_dir / session['source_basename']
        raw, rows = rows_at(path, session['id'])
        assert len(raw) == captured['source_bytes'] and digest(raw) == captured['source_sha256']
        assert digest(raw[:session['source_bytes']]) == session['source_sha256']
        old_rows = len(raw[:session['source_bytes']].splitlines())
        old_ids = [e['id'] for e in session['messages']]
        all_visible = visible(rows)
        assert [i['id'] for _, _, i in all_visible[:len(old_ids)]] == old_ids
        assert len({i['id'] for _, _, i in all_visible}) == len(all_visible)
        previous = {k: session[k] for k in ('source_bytes', 'source_sha256', 'snapshot_last_timestamp')}
        previous['last_message'] = session['messages'][-1].copy()
        groups, file_meta = {}, {}
        facts, edits, events = [], [], []
        new_messages = []
        user_round = session['source_user_count']

        def group_for(number):
            if session['id'] == reading.old.SESSIONS[0][0]:
                _, part, title = next(p for p in CORE if number <= p[0])
                return f'会话01-{part:02d}-{title}.md', part, title
            return '会话02-后续提交与文档同步.md', 2, '后续提交与文档同步'

        current_file, current_part, current_title = group_for(user_round)

        def ensure_group():
            if current_file not in groups:
                assert not (out / current_file).exists(), current_file
                groups[current_file] = []
                file_meta[current_file] = {'path': current_file, 'part': current_part, 'title': current_title}

        def flush():
            if events:
                ensure_group()
                groups[current_file].append(output_summary(events, facts, reading))
                events.clear()

        for line, row in enumerate(rows, 1):
            if line <= old_rows:
                continue
            payload = row.get('payload', {})
            item = payload.get('item', {})
            if row['type'] == 'event_msg' and payload.get('type') == 'item_completed':
                typ = item.get('type')
                if typ in ('UserMessage', 'AgentMessage'):
                    flush()
                    if typ == 'UserMessage':
                        user_round += 1
                        current_file, current_part, current_title = group_for(user_round)
                    ensure_group()
                    raw_text = text(item)
                    assert not reading.old.IMAGE.search(raw_text), 'A visible image payload requires privacy review'
                    if typ == 'UserMessage':
                        body, transform, att = reading.user_content(raw_text, all_attachments, edits)
                        groups[current_file].append(f'\n---\n\n### 第 {user_round} 轮\n\n')
                    else:
                        body, transform, att = reading.display(raw_text, edits), 'visible_text', None
                    ordinal = sum(e['file'] == current_file for e in new_messages) + 1
                    block = (f'<!-- 对话消息 {ordinal:03d} -->\n\n## ' + ('用户' if typ == 'UserMessage' else 'Codex') +
                             '\n\n' + body + '\n\n<!-- 对话消息结束 -->\n\n')
                    groups[current_file].append(block)
                    new_messages.append({'id': item['id'], 'role': typ, 'source_line': line, 'timestamp': row['timestamp'],
                                         'round': user_round, 'part': current_part, 'file': current_file,
                                         'message_ordinal_in_part': ordinal, 'source_text_sha256': digest(raw_text.encode()),
                                         'rendered_body_sha256': digest(body.encode()), 'transform': transform, 'attachment': att,
                                         'rendered_block_sha256': digest(block.encode())})
                elif typ in ('CommandExecution', 'FileChange', 'McpToolCall', 'Extension', 'ImageView'):
                    events.append((line, row['timestamp'], item))
            elif row['type'] == 'event_msg' and payload.get('type') == 'turn_aborted':
                flush()
                ensure_group()
                groups[current_file].append('**源事件：本轮发生中断，不能据此声称操作成功。**\n\n')
                facts.append({'source_line': line, 'timestamp': row['timestamp'], 'type': 'turn_aborted'})
        flush()
        expected_new = [i['id'] for _, _, i in all_visible[len(old_ids):]]
        assert [e['id'] for e in new_messages] == expected_new
        for filename, chunks in groups.items():
            messages = [e for e in new_messages if e['file'] == filename]
            assert messages, 'Tool-only continuation needs a separate explicitly labelled record'
            users = sum(e['role'] == 'UserMessage' for e in messages)
            title = file_meta[filename]['title']
            head = ('# AI 协作记录｜' + title + '\n\n**来源工具：** Codex  \n**原始会话：** `' + session['id'] +
                    '`  \n**消息时间：** ' + reading.local_time(messages[0]['timestamp']) + ' 至 ' +
                    reading.local_time(messages[-1]['timestamp']) + '  \n**来源快照截止：** ' +
                    reading.local_time(rows[-1]['timestamp']) + '  \n**快照 SHA-256：** `' + digest(raw) + '`\n\n' +
                    reading.NOTICE + '\n\n这是同一会话的连续增量，不是新建或补写的对话。保留真实发言顺序；工具过程明确标为“工具输出摘要”，不冒充完整原始日志。行尾、隐私遮盖、问题控件和粘贴附件采用原阅读版规则。旧正文逐字节保留。\n\n' +
                    '[返回索引](索引.md)\n\n')
            if session['id'] == reading.old.SESSIONS[0][0] and filename == list(groups)[-1]:
                head += '**快照边界：会话仍在进行。本次包含当前补录要求及已落盘的首条可见回复；快照之后的工作、消息和本轮最终回复未提前收录。**\n\n'
            (out / filename).write_text(head + ''.join(chunks), encoding='utf-8')
            entry = dict(file_meta[filename], session_id=session['id'], user_messages=users,
                         codex_messages=len(messages)-users, first_timestamp=messages[0]['timestamp'],
                         last_timestamp=messages[-1]['timestamp'], incremental=True)
            m['files'].append(entry)
            new_files.append(filename)
            session['files'].append(filename)
        session['previous_snapshot'] = previous
        session['source_bytes'] = len(raw)
        session['source_sha256'] = digest(raw)
        session['snapshot_last_timestamp'] = rows[-1]['timestamp']
        session['snapshot_last_row'] = len(rows)
        session['snapshot_last_visible_message'] = ({'id': all_visible[-1][2]['id'], 'source_line': all_visible[-1][0],
                                                     'timestamp': all_visible[-1][1]['timestamp']})
        session['messages'].extend(new_messages)
        session['tools'].extend(facts)
        session['presentation_reference_edits'].extend(edits)
        session['source_user_count'] = sum(i['type'] == 'UserMessage' for _, _, i in all_visible)
        session['source_codex_count'] = len(all_visible) - session['source_user_count']
        session['source_truncation_lines'] = sorted(set(session['source_truncation_lines']) | {
            line for line, row in enumerate(rows, 1) if line > old_rows and
            (row['type'] == 'response_item' and row.get('payload', {}).get('type') in ('function_call_output', 'custom_tool_call_output') or
             row['type'] == 'event_msg' and row.get('payload', {}).get('item', {}).get('type') in ('CommandExecution', 'McpToolCall'))
            and TRUNCATION.search(json.dumps(row.get('payload', {}), ensure_ascii=False))})
        lifecycle = [r['payload']['type'] for r in rows if r['type'] == 'event_msg' and
                     r.get('payload', {}).get('type') in ('task_started', 'task_complete', 'turn_aborted')]
        session['open_session'] = bool(lifecycle and lifecycle[-1] == 'task_started')
        session['new_user_messages'] = sum(e['role'] == 'UserMessage' for e in new_messages)
        session['new_codex_messages'] = len(new_messages) - session['new_user_messages']
        session['new_unreviewed_image_events_withheld'] = [
            {'source_line': line, 'timestamp': row['timestamp'], 'id': row['payload']['item'].get('id'),
             'source_event_sha256': digest(json.dumps(row['payload']['item'], ensure_ascii=False).encode()),
             'hash_scope': 'JSON event, not original image binary', 'distributed': False,
             'reason': 'No new visual privacy review; source event retained privately'}
            for line, row in enumerate(rows, 1) if line > old_rows and row['type'] == 'event_msg' and
            row.get('payload', {}).get('type') == 'item_completed' and
            row['payload'].get('item', {}).get('type') == 'ImageView']
    m.update(format=FORMAT, generated_at=datetime.now(timezone.utc).isoformat(),
             source_snapshot_directory=source_dir.relative_to(ROOT).as_posix(),
             validation_baseline=baseline_path.relative_to(ROOT).as_posix(),
             baseline_counts={'user': baseline_users, 'codex': baseline_ai},
             baseline_manifest_sha256=base['old_manifest_sha256'],
             baseline_directory=history.relative_to(ROOT).as_posix(), new_dialogue_files=new_files,
             attachments=list(all_attachments.values()), scope='Only the three user-confirmed Codex project sessions',
             other_AI_platform_records_included=False, current_turn_after_snapshot_not_included=True,
             user_authorized_final_notice_exclusion=False,
             historical_final_notice_authorization_does_not_close_new_turn=True,
             needs_current_turn_refresh=sum(s['open_session'] for s in m['sessions']),
             ended_message_exports=sum(not s['open_session'] for s in m['sessions']))
    m['preserved_historical_files'] = {p: h for p, h in original_files.items()
                                     if p not in {'索引.md', '会话清单.json', '阅读版校验.json', '脱敏检查报告.json', '源工具截断说明.md'}}
    save(manifest_path, m)
    write_index(out, m)
    (out / '完整性验收报告.md').write_text('# AI 记录完整性验收\n\n待运行增量校验，不代表已通过。\n', encoding='utf-8')
    for name in ('阅读版校验.json', '脱敏检查报告.json'):
        save(out / name, {'passed': False, 'status': 'pending_incremental_verification'})
    print(json.dumps({'new_dialogue_files': new_files, 'added_user': sum(s['new_user_messages'] for s in m['sessions']),
                      'added_codex': sum(s['new_codex_messages'] for s in m['sessions']), 'historical_bodies_regenerated': False}, ensure_ascii=True))


def write_index(out, m):
    users = sum(s['source_user_count'] for s in m['sessions'])
    ai = sum(s['source_codex_count'] for s in m['sessions'])
    body = '# AI 协作记录｜增量补全索引\n\n来源仅为用户确认的 3 个 Codex 项目会话；没有读取或声称包含其他 AI 平台的会话。以下是可追溯的对话阅读版，不能用作完整原始工具日志。\n\n'
    body += f'截至各来源快照，共 **{users} 条用户输入、{ai} 条 Codex 可见文本回复**。本轮新增 {users-m["baseline_counts"]["user"]} 条用户输入、{ai-m["baseline_counts"]["codex"]} 条回复；原有 12 份对话正文及附件逐字节保留，只新增连续后续分卷。\n\n'
    body += '## 按原始会话阅读\n\n'
    for n, s in enumerate(m['sessions'], 1):
        body += f'### 会话 {n:02d}\n\n来源标识：`{s["id"]}`；标题：{s["title"]}。\n\n'
        body += '| 内容 | 用户 / Codex | 阅读文件 |\n|---|---:|---|\n'
        for f in m['files']:
            if f['session_id'] == s['id']:
                body += f'| {f["title"]} | {f["user_messages"]} / {f["codex_messages"]} | [{f["path"]}]({f["path"]}) |\n'
        body += '\n快照截止：`' + s['snapshot_last_timestamp'] + '`（来源 UTC）；末条可见消息：`' + s['snapshot_last_visible_message']['id'] + '`。'
        body += '会话仍在进行，截止点后的消息不在本次快照。\n\n' if s['open_session'] else '源生命周期已结束；本次快照覆盖其全部可取得可见文字。\n\n'
    body += '## 真实性与边界\n\n'
    body += '- 原始输入、Codex 可见回复按源消息 ID、顺序、时间和内容 SHA-256 逐条核对；阶段标题是导航，不是用总结替代原文。\n'
    body += '- 旧正文和历史附件未重生成。旧索引/报告反映当时快照，其中“ZIP 内外同一份记录”等旧表述不代表当前交付；**当前 AI 记录在 421 文件代码 ZIP 外独立提供**。代码 ZIP 没有重打包或修改。\n'
    body += '- 单独快照只读取确认的三个 JSONL；原文件可继续追加，本轮仅校验指定字节前缀，不改原日志，也不覆盖已验证的旧来源快照。每个会话保留新旧快照 SHA、字节数、末消息 ID 和源行。\n'
    body += '- 工具内容标为“工具输出摘要”，保留失败、修复、命令和关键结果节选；源工具截断无法恢复，不把节选、摘要或本地阶段报告说成完整原始工具输出。\n'
    body += '- 粘贴提示词恢复实际附件全文；本机用户名、邮箱、账户及凭据按原规则作显式最小遮盖，保留源与分发哈希。未经审查图像不新增到分发目录；仅沿用两张此前已核查的产品截图。\n'
    body += '- 核心会话仍在进行。本次快照包含当前补录要求和首条可见回复；之后的整理、验证和本轮最终回复未包含，不能声称会话已经结束。旧轮次“最后一条通知可不放入”的许可不被扩展成删减新对话的许可。\n\n'
    body += '详细来源、消息定位和附件哈希见 [会话清单](会话清单.json)；[完整性验收报告](完整性验收报告.md)、[机器校验](阅读版校验.json)、[脱敏检查](脱敏检查报告.json)、[源工具截断及图像边界](源工具截断说明.md)。\n'
    (out / '索引.md').write_text(body, encoding='utf-8')


def verify_records(out, baseline_path):
    from markdown_it import MarkdownIt
    reading = reading_module()
    m, base = load(out / '会话清单.json'), load(baseline_path)
    assert m['format'] == FORMAT
    sources = ROOT / m['source_snapshot_directory']
    history = ROOT / m['baseline_directory']
    old_m = load(history / '会话清单.json')
    assert sha(history / '会话清单.json') == m['baseline_manifest_sha256'] == base['old_manifest_sha256']
    recon = baseline_path.parent / ('verify-' + datetime.now().strftime('%H%M%S-%f'))
    recon.mkdir()
    (recon / '附件').mkdir()
    reading.BUILD = recon
    totals, attachments, reports = Counter(), {}, []
    duplicates, failed_count, summarized_commands, tool_truncations = 0, 0, 0, 0
    for s, old_s in zip(m['sessions'], old_m['sessions']):
        raw, rows = rows_at(sources / s['source_basename'], s['id'])
        assert digest(raw) == s['source_sha256'] and len(raw) == s['source_bytes']
        assert digest(raw[:old_s['source_bytes']]) == old_s['source_sha256']
        original = Path.home() / '.codex/sessions/2026/10/31' / s['source_basename']
        with original.open('rb') as stream:
            assert digest(stream.read(len(raw))) == s['source_sha256'], 'Source prefix changed'
        msgs = visible(rows)
        ids = [i['id'] for _, _, i in msgs]
        assert ids == [e['id'] for e in s['messages']]
        assert len(set(ids)) == len(ids)
        response_ids = {r['payload']['id'] for r in rows if r['type'] == 'response_item' and
                        r.get('payload', {}).get('type') == 'message' and r['payload'].get('role') == 'assistant'}
        assert response_ids <= {i['id'] for _, _, i in msgs if i['type'] == 'AgentMessage'}
        timestamps = [datetime.fromisoformat(r['timestamp'].replace('Z', '+00:00')) for _, r, _ in msgs]
        assert timestamps == sorted(timestamps)
        rendered_ids = []
        session_body = '\n'.join((out / filename).read_text(encoding='utf-8') for filename in s['files'])
        for filename in s['files']:
            body = (out / filename).read_text(encoding='utf-8')
            matches = list(MESSAGE.finditer(body))
            entries = [e for e in s['messages'] if e['file'] == filename]
            assert len(matches) == len(entries), filename
            for match, e in zip(matches, entries):
                row = rows[e['source_line']-1]
                item = row['payload']['item']
                raw_text = text(item)
                assert item['id'] == e['id'] and row['timestamp'] == e['timestamp']
                assert digest(raw_text.encode()) == e['source_text_sha256']
                if item['type'] == 'UserMessage':
                    expected, _, _ = reading.user_content(raw_text, attachments, [])
                else:
                    expected = reading.display(raw_text, [])
                assert match[3] == expected, 'Rendered visible text mismatch: ' + e['id']
                assert digest(expected.encode()) == e['rendered_body_sha256']
                assert digest(match[0].encode() + b'\n\n') == e['rendered_block_sha256']
                assert int(match[1]) == e['message_ordinal_in_part']
                assert match[2] == ('用户' if item['type'] == 'UserMessage' else 'Codex')
                rendered_ids.append(e['id'])
        assert rendered_ids == ids
        failures, aborts = set(), set()
        for line, row in enumerate(rows, 1):
            p, i = row.get('payload', {}), row.get('payload', {}).get('item', {})
            if row['type'] == 'event_msg' and p.get('type') == 'item_completed':
                if i.get('type') == 'CommandExecution' and i.get('exit_code') not in (None, 0):
                    failures.add(line)
                if i.get('type') == 'McpToolCall' and i.get('status') == 'failed':
                    failures.add(line)
            if row['type'] == 'event_msg' and p.get('type') == 'turn_aborted':
                aborts.add(line)
        failure_facts = {f['source_line'] for f in s['tools'] if f['type'] in ('failure_or_diagnostic_excerpt', 'failed_application_tool_excerpt')}
        assert failures <= failure_facts
        assert aborts == {f['source_line'] for f in s['tools'] if f['type'] == 'turn_aborted'}
        for fact in s['tools']:
            if fact['type'] in ('failure_or_diagnostic_excerpt', 'failed_application_tool_excerpt'):
                excerpt = fact.get('output_excerpt', [])
                excerpt = excerpt if isinstance(excerpt, str) else '\n'.join(excerpt)
                if excerpt:
                    assert excerpt in session_body, 'Failed tool excerpt absent from readable record'
            if fact['type'] == 'rendered_tool_summary':
                events = [(line, row['timestamp'], row['payload']['item']) for line, row in enumerate(rows, 1)
                          if fact['first_source_line'] <= line <= fact['last_source_line'] and row['type'] == 'event_msg'
                          and row.get('payload', {}).get('type') == 'item_completed' and
                          row['payload'].get('item', {}).get('type') in ('CommandExecution', 'FileChange', 'McpToolCall', 'Extension', 'ImageView')]
                expected = output_summary(events, [], reading)
                assert digest(expected.encode()) == fact['rendered_sha256'] and expected in session_body
            if fact['type'] == 'command_provenance':
                item = rows[fact['source_line']-1]['payload']['item']
                assert digest(reading.command_text(item).encode()) == fact['command_sha256']
                assert digest((item.get('aggregated_output', '') or '').encode()) == fact['source_output_sha256']
                summarized_commands += 1
        for image in s.get('new_unreviewed_image_events_withheld', []):
            item = rows[image['source_line']-1]['payload']['item']
            assert item['type'] == 'ImageView' and item.get('id') == image['id'] and not image['distributed']
            assert digest(json.dumps(item, ensure_ascii=False).encode()) == image['source_event_sha256']
        counts = Counter(i['type'] for _, _, i in msgs)
        assert counts['UserMessage'] == s['source_user_count'] and counts['AgentMessage'] == s['source_codex_count']
        totals.update(counts)
        failed_count += len(failures)
        tool_truncations += len(s['source_truncation_lines'])
        reports.append({'id': s['id'], 'source_user_messages': counts['UserMessage'], 'exported_user_messages': counts['UserMessage'],
                        'source_codex_messages': counts['AgentMessage'], 'exported_codex_messages': counts['AgentMessage'],
                        'new_user_messages': s['new_user_messages'], 'new_codex_messages': s['new_codex_messages'],
                        'source_sha256': s['source_sha256'], 'source_bytes': len(raw), 'snapshot_last_timestamp': s['snapshot_last_timestamp'],
                        'last_visible_message': s['snapshot_last_visible_message'], 'previous_snapshot': s['previous_snapshot'],
                        'omissions': 0, 'duplicates': 0, 'source_order_preserved': True, 'failed_tool_events_disclosed': len(failures),
                        'source_truncation_marker_locations': len(s['source_truncation_lines']), 'open_session': s['open_session']})
    assert len(attachments) == len(m['attachments'])
    for att in m['attachments']:
        assert (out / att['path']).read_bytes() == (recon / att['path']).read_bytes()
        assert att['source_sha256'] == attachments[att['path']]['source_sha256']
    for rel, expected in m['preserved_historical_files'].items():
        assert sha(out / rel) == sha(history / rel) == expected, rel
    # Reports are staged before scanning so that every referenced link already exists.
    gaps = '# 来源工具截断及快照边界（当前增量）\n\n用户和 Codex 可见文字已逐条核对；工具仅提供“工具输出摘要”，不是完整原始工具日志。\n\n'
    for s in reports:
        gaps += f'- 会话 `{s["id"]}`：{s["source_truncation_marker_locations"]} 个来源截断标记位置；精确源行见会话清单。数量含请求/完成等重复视图和历史标记引用，不是缺失发言数量。\n'
    gaps += '\n源端未返回的工具字节、部分终端输出及历史两处无效图像片段不能可靠恢复，未凭记忆补写。新 ImageView 原图未经隐私审查，均未分发。旧的含账号/头像及未审查图像仍仅本地保留；分发目录只沿用两张已审查产品截图。\n\n核心会话当前仍在进行。本次快照截止见索引与清单，截止后消息和本轮最终回复未收录；这不是声称会话已经结束。旧“最后通知排除”仅适用于当时轮次，不据此删去本次已产生的消息。\n'
    (out / '源工具截断说明.md').write_text(gaps, encoding='utf-8')
    md = MarkdownIt('commonmark', {'html': True}).enable('table')
    links, external, issues, privacy, historical_marker_fragments = 0, 0, [], [], []
    all_paths = [p for p in out.rglob('*') if p.is_file()]
    for p in all_paths:
        if p.suffix == '.png':
            assert p.relative_to(out).as_posix() in {i['path'] for i in m['images']}
            continue
        value = p.read_text(encoding='utf-8')
        if p.suffix == '.json':
            json.loads(value)
        for label, pattern, _ in reading.old.RULES:
            if label == 'local_user_path':
                for found in re.finditer(r'(?i)[A-Z]:(?:\\+|/+)Users(?:\\+|/+)(?!\[已脱敏_)[^\\/\s"<>]+', value):
                    # A historical 420-character tool excerpt cuts the mask itself to
                    # "[已脱". Preserve the approved bytes; this is not an account name.
                    component = re.split(r'[\\/]+', found[0])[-1]
                    old_file = history / p.relative_to(out)
                    if '[已脱敏_本机用户]'.startswith(component) and old_file.is_file() and found[0] in old_file.read_text(encoding='utf-8'):
                        historical_marker_fragments.append({'path': p.relative_to(out).as_posix(),
                                                            'reason': 'Historical command excerpt truncates a redaction marker; no personal account bytes present'})
                    else:
                        privacy.append({'path': p.relative_to(out).as_posix(), 'rule': label})
            elif pattern.search(value):
                privacy.append({'path': p.relative_to(out).as_posix(), 'rule': label})
        assert not re.search(r'data:image/[^;]+;base64,[A-Za-z0-9+/=]{50,}', value)
        if p.suffix != '.md':
            continue
        state = None
        for number, line in enumerate(value.splitlines(), 1):
            found = reading.FENCE.match(line)
            if found:
                if state and found[1][0] == state[0] and len(found[1]) >= state[1] and not found[2].strip():
                    state = None
                elif not state:
                    state = (found[1][0], len(found[1]), number)
        assert not state, (p.name, state)
        for token in md.parse(value):
            for child in token.children or []:
                href = child.attrGet('href') if child.type == 'link_open' else child.attrGet('src') if child.type == 'image' else None
                if not href:
                    continue
                u = urlsplit(href)
                if u.scheme in ('http', 'https'):
                    external += 1
                    continue
                if u.scheme or not (p.parent / unquote(u.path)).is_file():
                    issues.append({'path': p.relative_to(out).as_posix(), 'href': href})
                links += 1
    assert not issues, issues
    assert not privacy, privacy
    for image in m['images']:
        assert sha(out / image['path']) == image['sha256'] == sha(ROOT / image['source_relative_path'])
    stage_specs = [('Windows UTF-8 发现、修复和验证', '会话01-11-', 'UTF-8'),
                   ('精简 ZIP 白名单与独立验收', '会话01-12-', '404'),
                   ('Shell、确认机制与 247 项 Java 测试', '会话01-13-', '247'),
                   ('Shell Git 提交', '会话01-13-', '93d9d58'),
                   ('最新文档提交', '会话02-后续', 'd4326d6'),
                   ('421 文件 ZIP 与 104 项解压验收', '会话01-14-', '104')]
    stages = []
    for title, prefix, needle in stage_specs:
        matches = []
        for s in m['sessions']:
            _, rows = rows_at(sources / s['source_basename'], s['id'])
            for e in s['messages']:
                if e['role'] == 'AgentMessage' and e['file'].startswith(prefix) and needle in text(rows[e['source_line']-1]['payload']['item']):
                    matches.append({'session_id': s['id'], 'id': e['id'], 'source_line': e['source_line'], 'file': e['file']})
        assert matches, 'Requested phase absent from actual visible replies: ' + title
        stages.append({'stage': title, 'actual_reply_locations': matches})
    controlled_path = baseline_path.parent / 'controlled-verifier-tests/result.json'
    controlled = load(controlled_path) if controlled_path.is_file() else None
    if controlled:
        assert controlled['all_passed'] and all(c['correctly_rejected'] and c['actual_exit_code'] != 0 for c in controlled['cases'])
    result = {'format': FORMAT, 'passed': True, 'checked_at': datetime.now(timezone.utc).isoformat(),
              'source_scope': 'Only three user-confirmed Codex sessions; no other platform claim',
              'sessions': reports, 'source_user_total': totals['UserMessage'], 'retained_user_total': totals['UserMessage'],
              'source_codex_total': totals['AgentMessage'], 'retained_codex_total': totals['AgentMessage'],
              'added_user_total': totals['UserMessage']-m['baseline_counts']['user'],
              'added_codex_total': totals['AgentMessage']-m['baseline_counts']['codex'],
              'dialogue_files': len(m['files']), 'new_dialogue_files': m['new_dialogue_files'],
              'all_markdown_files': len(list(out.rglob('*.md'))), 'input_attachments': len(attachments),
              'missing_user_or_codex_messages': 0, 'message_duplicates': duplicates, 'missing_input_attachments': [],
              'source_order_preserved': True, 'failed_tool_events_disclosed': failed_count,
              'incremental_commands_with_source_hash': summarized_commands, 'source_truncation_marker_locations': tool_truncations,
              'tool_outputs_are_summaries_not_full_original_logs': True, 'raw_JSONL_modified': False,
              'previous_source_snapshots_preserved': True, 'historical_dialogue_files_preserved_bytewise': 12,
              'relative_links_checked': links, 'link_issues': issues, 'external_links_not_fetched': external,
              'UTF8_strict_decode': True, 'visible_bodies_match_source_transformations': True,
              'credential_pattern_hits': privacy, 'reviewed_images_preserved': len(m['images']),
              'historical_redaction_marker_fragments_disclosed': historical_marker_fragments,
              'new_unreviewed_images_distributed': 0,
              'new_unreviewed_image_events_withheld': sum(len(s.get('new_unreviewed_image_events_withheld', [])) for s in m['sessions']),
              'complete_visible_text_to_declared_snapshot': True,
              'current_session_open': any(s['open_session'] for s in reports), 'post_snapshot_tail_included': False,
              'all_sessions_finished_claimed': False, 'product_zip_modified': False, 'maven_or_jar_build_executed': False,
              'no_commit_push_upload_or_email': True, 'requested_stage_coverage': stages,
              'controlled_verifier_tests': controlled}
    save(out / '阅读版校验.json', result)
    save(out / '脱敏检查报告.json', {'passed': True, 'checked_at': result['checked_at'], 'scope': 'Distributed AI reading Markdown and metadata only',
                                  'credential_pattern_hits': [], 'unmasked_local_account_path_hits': [],
                                  'source_and_rendered_hashes': '会话清单.json', 'redaction_markers_retained': True,
                                  'policy': 'Minimal explicit masking, LF normalization and historical references shown literally; no messages deleted',
                                  'unchanged_previously_reviewed_images': m['images'], 'new_unreviewed_images_distributed': 0,
                                  'historical_redaction_marker_fragments_disclosed': historical_marker_fragments,
                                  'originals_and_source_snapshots_not_modified': True, 'unknown_or_post_snapshot_data_not_claimed_checked': True})
    report = '# AI 协作记录完整性验收\n\n'
    report += f'本次只处理 3 个已确认 Codex 会话，新增 **{result["added_user_total"]} 条用户输入、{result["added_codex_total"]} 条可见回复**。合计 {result["source_user_total"]} / {result["source_codex_total"]} 条，逐条来源定位和内容核对通过，遗漏与重复均为 0。\n\n'
    report += f'原 12 份对话正文不变，新增 {len(m["new_dialogue_files"])} 份后续分卷；对话正文共 {len(m["files"])} 份，粘贴输入附件 {len(attachments)} 份。索引和机器清单明确来源范围、消息时间、ID、源行、新旧来源前缀 SHA、分发变换与 SHA。\n\n'
    report += '| 检查 | 结果 |\n|---|---|\n'
    report += f'| 用户 / Codex 消息计数、顺序、ID 和正文 | 全部匹配指定 JSONL 快照；未导出内部推理 |\n| 失败与中断 | {failed_count} 个失败工具事件保留定位和摘要；不伪造缺失输出 |\n| 新增命令定位 | {summarized_commands} 项，保留原命令/输出 SHA；正文明确为工具输出摘要 |\n| 附件 | {len(attachments)} 份原提示词仍可访问并核对来源 SHA；未知图片不分发 |\n| Markdown / UTF-8 | 严格解码、围栏与 {links} 个本地链接通过；历史原乱码未擅改 |\n| 隐私 | 常见凭据、邮箱、账户与个人路径规则未命中；遮盖标记保留 |\n| 历史与产品 | 旧正文/附件/来源快照不变；JAR、421 文件 ZIP、Demo 和业务状态不改 |\n\n'
    report += '## 后续阶段覆盖\n\n| 阶段 | 实际对话位置 |\n|---|---|\n'
    for stage in stages:
        loc = stage['actual_reply_locations'][-1]
        report += '| ' + stage['stage'] + ' | [' + loc['file'] + '](' + loc['file'] + ')；消息 `' + loc['id'] + '`，源行 ' + str(loc['source_line']) + ' |\n'
    report += '\n历史工具命令节选中有 2 处被截短的脱敏标记（一个正文位置及其机器清单视图），不是原账户名；与已验证历史字节一致，未以此重写旧正文。\n\n'
    report += '## 导出与校验方式\n\n复用原来的正文、附件和脱敏函数；只给 render/verify 增加增量入口和识别，旧 export 增加保护条件，拒绝把阅读版覆盖回旧式大文件。新增的 `scripts/ai-reading-incremental.py` 仅负责本次记录追加和校验，不参与 CLI 业务或代码 ZIP。新校验分支不依赖旧冻结 JAR 常量或旧 1,920 文件候选目录。\n\n在具有本地原始来源快照的开发工作区，可运行：\n\n```powershell\npython -B scripts/verify-ai-reading.py --records-dir delivery/final/AI协作记录\n```\n\n原始 JSONL/私有快照不随邮件分发；阅读者可直接查看 Markdown 与机器清单，但不能据此声称已自行取得原始工具全文。\n\n'
    if controlled:
        report += f'校验器另以 {len(controlled["cases"])} 个明确标记的受控副本检查遗漏用户/AI、重复消息、正文/附件篡改、凭据格式和重复追加，均被正确拒绝。这些是本轮校验器测试，不是历史真实会话错误或后台 API 故障。\n\n'
    report += '## 仍需如实保留的边界\n\n工具日志是摘要/节选，源端截断的字节及未审查图片没有恢复或分发，详见 [来源边界](源工具截断说明.md)。这不表示遗漏了快照中可取得的用户或 Codex 文字。\n\n核心会话仍在进行；截至本次快照的可取得文字完整。快照后发生的整理与验证、消息和本轮最终回复不在本版，不声称会话已经结束。如需包含这些尾部，应在会话结束后另取新快照并增补，不使用本报告补写对话。\n\n[来源索引](索引.md) · [逐消息清单](会话清单.json) · [机器校验](阅读版校验.json) · [隐私报告](脱敏检查报告.json)。本轮没有构建、重新打包代码、Git Commit/Push、上传或发送邮件。\n'
    (out / '完整性验收报告.md').write_text(report, encoding='utf-8')
    print(json.dumps({k: result[k] for k in ('passed', 'source_user_total', 'source_codex_total', 'added_user_total', 'added_codex_total', 'dialogue_files', 'all_markdown_files', 'input_attachments', 'relative_links_checked', 'failed_tool_events_disclosed')}, ensure_ascii=True))
    return result
