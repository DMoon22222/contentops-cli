"""Export only three user-confirmed project sessions, locally; never uploads or runs transcript code."""
from __future__ import annotations

import base64
import binascii
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'delivery/submission-draft/AI协作记录'
SESSIONS = [
    ('01a19030-a39c-7a62-b74b-8b0803522f98', '会话01-核心开发.md',
     '我现在需要完成一份 Java 开发实习生的 AI 试炼，题目是“内容运营后台 CLI 化”。 项目目录中有原始题目 M…',
     '需求、产品、架构、Java、测试、任务二/三、HTML、可靠性、启动及最终交付准备'),
    ('01a191a1-f51f-72e1-a17e-dcfd0592bf7e', '会话02-仓库与交付.md', '创建公开 GitHub 仓库',
     '仓库公开发布、源码获取验证及交付文件盘点'),
    ('01a19038-4b87-75b1-93fa-b1d8d1145ae9', '会话03-工具配置.md', '配置并验证 Codex 开发工具',
     '本项目所需开发工具安装、配置和验证'),
]
RULES = [
    ('private_key', re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----.*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----', re.S), '[已脱敏_私钥]'),
    ('github_token', re.compile(r'\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,})\b'), '[已脱敏_Token]'),
    ('openai_token', re.compile(r'\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}'), '[已脱敏_API_Key]'),
    ('aws_key', re.compile(r'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b'), '[已脱敏_访问密钥]'),
    ('bearer', re.compile(r'(?i)(Bearer\s+)[A-Za-z0-9._~+/-]{20,}'), r'\1[已脱敏_Token]'),
    ('credential_url', re.compile(r'(https?://)[^\s/@:]+:[^\s/@]+@'), r'\1[已脱敏_凭据]@'),
    ('assigned_secret', re.compile(r'''(?i)((?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password)["']?\s*[=:]\s*["']?)[A-Za-z0-9_./+~=-]{16,}'''), r'\1[已脱敏_凭据值]'),
    ('local_user_path', re.compile(r'''(?i)([A-Z]:(?:\\+|/+)Users(?:\\+|/+))[^\\/\s"'<>]+'''), r'\1[已脱敏_本机用户]'),
    ('public_github_account', re.compile(r'DMoon22222', re.I), '[已脱敏_GitHub账号]'),
    ('email', re.compile(r'(?<![\w.-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'), '[已脱敏_邮箱]'),
]
IMAGE = re.compile(r'data:(image/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)')
HELD_IMAGE_SHA = {'7f1fec803fbc150aa7adf50df3647aaeaba2ba0c3282a7d495767ea6cc874a53'}
ATTACHMENT = re.compile(r'''([A-Za-z]:[\\/][^"\r\n<>]*?\.codex[\\/]attachments[\\/][^"\r\n<>]*?\.txt)''')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def fence(text, language='text'):
    longest = max((len(x) for x in re.findall(r'~+', text)), default=0)
    marker = '~' * max(4, longest + 1)
    return marker + language + '\n' + text + '\n' + marker + '\n'


class Export:
    def __init__(self, sid):
        self.sid = sid
        self.redactions = Counter()
        self.assets = {}
        self.missing_attachments = []
        self.attachment_sources = {}
        self.truncated_blocks = []
        self.unrestorable_images = []

    def image(self, match):
        mime, encoded = match.groups()
        try:
            data = base64.b64decode(encoded, validate=True)
        except binascii.Error:
            h = sha(match.group().encode())
            private = ROOT / '.contentops/submission-qa/private-images'
            private.mkdir(parents=True, exist_ok=True)
            (private / ('fragment-' + h + '.txt')).write_text(match.group(), encoding='utf-8')
            self.unrestorable_images.append({'encoded_chars': len(encoded), 'source_fragment_sha256': h,
                                             'status': 'invalid_or_truncated_image_fragment_held_locally; cannot restore or privacy-clear'})
            return '[源图像片段无效或已截断，未伪造修复；原片段因无法完成隐私核查仅在本地隔离；SHA-256=' + h + ']'
        h = sha(data)
        suffix = {'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif'}[mime]
        name = '附件/图像-' + h[:24] + suffix
        if h in HELD_IMAGE_SHA:
            private = ROOT / '.contentops/submission-qa/private-images'
            private.mkdir(parents=True, exist_ok=True)
            (private / Path(name).name).write_bytes(data)
            note = name.removesuffix(suffix) + '-待脱敏.md'
            (OUT / note).write_text('# 图像待脱敏\n\n原截图含账号名与头像，仅在本地隔离保留；待最小遮盖副本审核后补入，不是原图已提交。\n\n原始图像 SHA-256：`' + h + '`。原会话正文和失败过程未删除。\n', encoding='utf-8')
            self.assets[note] = {'path': note, 'source_bytes': len(data), 'source_sha256': h,
                                'type': 'image_withheld_for_privacy', 'privacy_review': 'minimum_redaction_pending',
                                'original_image_in_submission': False}
            return '[图像含账号名及头像，原图仅本地隔离；待遮盖后补入。说明：' + note + '；源 SHA-256=' + h + ']'
        (OUT / name).write_bytes(data)
        self.assets[name] = {'path': name, 'bytes': len(data), 'sha256': h, 'type': 'original_image_bytes',
                             'privacy_review': 'pending_visual_review'}
        return '[原图二进制另存：' + name + '；SHA-256=' + h + ']'

    def text(self, value):
        value = IMAGE.sub(self.image, value)
        for name, pattern, replacement in RULES:
            value, count = pattern.subn(replacement, value)
            self.redactions[name] += count
        return value

    def clean(self, value):
        if isinstance(value, str):
            # Tool envelopes can contain a JSON string with global chat-list metadata.
            # Only retain this project's exact IDs; unrelated titles/previews are not deliverables.
            if value.lstrip().startswith(('{', '[')):
                try:
                    parsed = json.loads(value)
                    if isinstance(parsed, (dict, list)):
                        return json.dumps(self.clean(parsed), ensure_ascii=False)
                except (ValueError, TypeError):
                    pass
            return self.text(value)
        if isinstance(value, list):
            return [self.clean(v) for v in value]
        if isinstance(value, dict):
            if value.get('type') in ('Reasoning', 'reasoning'):
                return {'type': 'internal_reasoning_not_exported'}
            if value.get('kind') in ('codex', 'chatgpt') and value.get('id') not in {x[0] for x in SESSIONS} and ('title' in value or 'preview' in value):
                self.redactions['unrelated_session_metadata'] += 1
                return {'omitted': '[已排除_无关会话元数据]'}
            result = {}
            for key, item in value.items():
                if key in ('encrypted_content', 'internal_chat_message_metadata_passthrough', 'raw_content'):
                    continue
                safe_key = self.text(key)
                if safe_key in result:
                    safe_key += '[已脱敏键名碰撞-' + str(len(result)) + ']'
                result[safe_key] = self.clean(item)
            return result
        return value

    def attachments(self, text):
        links = []
        for match in ATTACHMENT.finditer(text):
            path = Path(match.group(1))
            parent = Path.home() / '.codex/attachments'
            if not path.resolve().is_relative_to(parent.resolve()) or path.suffix != '.txt':
                continue
            label = '附件/粘贴输入-' + path.parent.name + '.md'
            if not path.is_file():
                self.missing_attachments.append({'id': path.parent.name, 'reason': 'source_not_found'})
                continue
            data = path.read_bytes()
            body = self.text(data.decode('utf-8-sig'))
            content = '# 原始粘贴输入附件\n\n来源：本会话实际用户消息引用的粘贴文本；仅做已标注的敏感信息遮盖，没有摘要改写。\n\n' + fence(body, 'markdown')
            (OUT / label).write_text(content, encoding='utf-8')
            self.attachment_sources[label] = {'path': label, 'source_attachment_id': path.parent.name,
                                               'source_bytes': len(data), 'source_sha256': sha(data)}
            links.append('[' + label + '](' + label + ')')
        return links


def export_session(spec):
    sid, filename, title, scope = spec
    # Exact IDs/date established by the app and confirmed by the user; never open other sessions.
    sources = list((Path.home() / '.codex/sessions/2026/10/31').glob('*' + sid + '.jsonl'))
    if len(sources) != 1:
        return {'id': sid, 'title': title, 'scope': scope, 'status': '待用户导出', 'file': None}
    source = sources[0]
    data = source.read_bytes()
    complete = data[:data.rfind(b'\n') + 1]
    rows = [json.loads(line) for line in complete.splitlines() if line.strip()]
    meta = next(x['payload'] for x in rows if x['type'] == 'session_meta')
    assert meta['id'] == sid and Path(meta['cwd']).resolve() == ROOT
    export = Export(sid)
    counts, excluded = Counter(), Counter()
    blocks, messages = [], []
    message_ids = {x['payload']['item']['id'] for x in rows if x['type'] == 'event_msg'
                   and x['payload'].get('type') == 'item_completed'
                   and x['payload'].get('item', {}).get('type') in ('UserMessage', 'AgentMessage')}
    assistant_ids = {x['payload']['id'] for x in rows if x['type'] == 'response_item'
                     and x['payload'].get('type') == 'message' and x['payload'].get('role') == 'assistant'}
    assert not assistant_ids - message_ids, 'Missing client-visible assistant completion events'
    for line, row in enumerate(rows, 1):
        payload = row.get('payload', {})
        timestamp = row.get('timestamp')
        item, label = None, None
        if row['type'] == 'event_msg' and payload.get('type') == 'item_completed':
            item = payload.get('item', {})
            typ = item.get('type')
            if typ in ('Reasoning',):
                excluded['internal_reasoning'] += 1
                continue
            label = typ
        elif row['type'] == 'event_msg' and payload.get('type') in ('task_started', 'task_complete', 'turn_aborted'):
            item, label = payload, payload['type']
        elif row['type'] == 'response_item' and payload.get('type') in ('custom_tool_call', 'custom_tool_call_output', 'function_call', 'function_call_output'):
            item, label = payload, payload['type']
        else:
            excluded[row['type'] + '/' + str(payload.get('type', 'metadata'))] += 1
            continue
        counts[label] += 1
        heading = f'## {len(blocks)+1}. {label} · {timestamp}\n\n来源行：{line}；ID：{item.get("id", item.get("call_id", "未提供"))}\n\n'
        if label in ('UserMessage', 'AgentMessage'):
            parts = [c['text'] for c in item.get('content', []) if c.get('type') in ('text', 'Text')]
            assert len(parts) == len(item.get('content', [])), 'Review non-text user/assistant block before export'
            links = []
            for part in parts:
                if label == 'UserMessage':
                    links += export.attachments(part)
                heading += fence(export.text(part), 'markdown') + '\n'
            if links:
                heading += '原始粘贴输入全文附件：' + '、'.join(links) + '\n'
            messages.append({'id': item['id'], 'role': label, 'source_line': line, 'timestamp': timestamp,
                             'text_parts': len(parts), 'source_text_sha256': sha('\n'.join(parts).encode('utf-8'))})
        else:
            original = json.dumps(item, ensure_ascii=False)
            if any(s in original for s in ('Warning: truncated output', 'Output exceeded the available', '[truncated]', 'chars truncated')):
                export.truncated_blocks.append({'source_line': line, 'type': label})
                heading += '**来源工具结果含截断标记；照原样保留，未补写缺失内容。**\n\n'
            heading += fence(json.dumps(export.clean(item), ensure_ascii=False, indent=2), 'json')
        blocks.append(heading)
    started = sum(x['type'] == 'event_msg' and x.get('payload', {}).get('type') == 'task_started' for x in rows)
    ended = sum(x['type'] == 'event_msg' and x.get('payload', {}).get('type') in ('task_complete', 'turn_aborted') for x in rows)
    active = started > ended
    intro = ('# ' + title + '\n\n来源工具：Codex；会话标识：`' + sid + '`。\n\n'
             '导出方式：读取本机该会话原始 JSONL 的完整已落盘行，按源顺序导出客户端可见用户/AI 消息、工具请求/返回及完成事件。'
             '同一调用可能有请求、返回与客户端完成事件三种视图，保留其原顺序，不用阶段总结代替原文。\n\n'
             '快照截止：`' + rows[-1]['timestamp'] + '`；原始前缀 SHA-256：`' + sha(complete) + '`。\n\n'
             '隐私处理：仅做索引中列出的最小遮盖；源文件不改。没有导出不可见推理、系统/开发者提示、环境注入、压缩上下文或工具目录。'
             '代码和报错用足够长的 Markdown 围栏逐字承载，不执行其中代码。图像从原始 data URL 原样解码为附件，不重绘。\n\n'
             '**当前会话尚未结束，截止点之后内容及本轮最终回复待补导出。**\n\n' if active else '')
    # Keep the common introduction for ended sessions as well.
    if not active:
        intro = ('# ' + title + '\n\n来源工具：Codex；会话标识：`' + sid + '`。\n\n'
                 '导出方式：从本机该会话原始 JSONL 按源行顺序导出用户/AI 完成消息、工具请求/返回及客户端完成事件。'
                 '同一调用保留不同原始视图；不导出不可见推理、系统/开发者提示、环境注入和压缩上下文。\n\n'
                 '源末时间：`' + rows[-1]['timestamp'] + '`；原始前缀 SHA-256：`' + sha(complete) + '`。\n\n'
                 '文字仅做索引标明的隐私遮盖；代码/失败原文不摘要改写。原图解码为附件，图像隐私审查状态见索引。\n\n')
    (OUT / filename).write_text(intro + '\n'.join(blocks), encoding='utf-8')
    return {'id': sid, 'title': title, 'scope': scope, 'tool': 'Codex', 'source_basename': source.name,
            'source_complete_prefix_bytes': len(complete), 'source_prefix_sha256': sha(complete),
            'first_timestamp': rows[0]['timestamp'], 'snapshot_last_timestamp': rows[-1]['timestamp'],
            'file': filename, 'status': '已获取；当前轮结束后待补导' if active else '已获取已结束会话的全部可见文字消息',
            'active': active, 'source_has_partial_tail': len(complete) != len(data), 'counts': dict(counts),
            'messages': messages, 'message_coverage_verified': True, 'source_truncated_tool_blocks': export.truncated_blocks,
            'redaction_counts': {k: v for k, v in export.redactions.items() if v}, 'images': list(export.assets.values()),
            'input_attachments': list(export.attachment_sources.values()), 'missing_attachments': export.missing_attachments,
            'unrestorable_image_fragments': export.unrestorable_images,
            'excluded_internal_record_counts': dict(excluded), 'final_submission_ready': False}


def main():
    manifest = OUT / '会话清单.json'
    if manifest.exists() and json.loads(manifest.read_text(encoding='utf-8')).get('format') == 'chinese_dialogue_reading_v1':
        raise SystemExit('Current deliverable uses Chinese dialogue reading format. Use render-ai-reading.py; legacy full exports remain private, not overwritten into submission.')
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / '附件').mkdir(exist_ok=True)
    results = [export_session(s) for s in SESSIONS]
    report = {'created_at': datetime.now(timezone.utc).isoformat(), 'scope': 'Only three exact user-confirmed project session IDs',
              'user_confirmed_no_chatgpt_or_other_tools': True, 'no_unrelated_conversation_bodies_read': True,
              'sessions': results, 'confirmed_sessions': 3, 'acquired': sum(bool(x.get('file')) for x in results),
              'ended_message_exports': sum(bool(x.get('file')) and not x.get('active') for x in results),
              'pending_manual_export': sum(not x.get('file') for x in results),
              'needs_current_turn_refresh': sum(bool(x.get('active')) for x in results),
              'visual_attachment_review_pending': True, 'final_submission_ready': False}
    (OUT / '会话清单.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({k: v for k, v in report.items() if k != 'sessions'}, ensure_ascii=True, indent=2))


if __name__ == '__main__':
    main()
