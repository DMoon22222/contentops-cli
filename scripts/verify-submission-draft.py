"""Static-only draft verification and external checksums; does not run CLI, build or send."""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
DRAFT = ROOT / 'delivery/submission-draft'
CANDIDATE = ROOT / 'delivery/candidate/ContentOps-CLI'
FROZEN = '2e6b40ece3567579383c777bff31c35bc682bbf5b18a5bf881bfe5c6596940c6'
MANIFEST = '文件清单与SHA256.json'


def load(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    record_manifest = load(DRAFT / 'AI协作记录/会话清单.json')
    if record_manifest.get('format') == 'chinese_dialogue_reading_v1':
        import runpy
        runpy.run_path(str(ROOT / 'scripts/verify-ai-reading.py'), run_name='__main__')
        return
    approved = load(ROOT / 'evidence/release/candidate-files.json')['files']
    actual = {p.relative_to(CANDIDATE).as_posix() for p in CANDIDATE.rglob('*') if p.is_file()}
    assert actual == {e['path'] for e in approved}
    assert all(sha(CANDIDATE / e['path']) == e['sha256'] for e in approved)
    assert sha(CANDIDATE / 'target/contentops.jar') == sha(ROOT / 'target/contentops.jar') == FROZEN
    assert not (CANDIDATE / '.contentops').exists()
    assert not subprocess.check_output(['git', 'diff', '--name-only'], cwd=ROOT).strip(), 'Existing tracked files modified'
    paths, links = [], []
    for name in ('运行与查看说明.md', '补充说明.md'):
        p = DRAFT / name
        text = p.read_text(encoding='utf-8')
        assert 'F:\\AI_TESTEXAM' not in text and 'git clone' not in text
        for value in re.findall(r'`(ContentOps-CLI/[^`]+)`', text):
            target = (CANDIDATE / value.removeprefix('ContentOps-CLI/')).resolve()
            assert target.is_relative_to(CANDIDATE.resolve()) and target.exists(), value
            paths.append({'document': name, 'logical_path': value,
                          'actual_mapped_path': target.relative_to(ROOT).as_posix(), 'exists': True})
        for href in re.findall(r'\]\(([^)]+)\)', text):
            assert (p.parent / href).exists(), href
            links.append({'document': name, 'href': href, 'exists': True})
    # Source and saved real acceptance command checks only; never execute write examples.
    guide = (DRAFT / '运行与查看说明.md').read_text(encoding='utf8')
    java = '\n'.join(p.read_text(encoding='utf8') for p in (ROOT / 'src/main/java/com/example/contentops/cli').glob('*.java'))
    examples = ['content list', 'content get', 'content history', 'tags list', 'content review', 'content tags update', 'content process']
    assert all('contentops ' + c in guide for c in examples)
    for name in ('list', 'get', 'history', 'review', 'update', 'process'):
        assert 'name = "' + name + '"' in java
    for flag in ('--review-status', '--page', '--action', '--add', '--reason', '--execute', '--yes', '--output'):
        assert flag in java and flag in guide
    assert 'approve' in guide and '新增' in guide
    records = load(DRAFT / 'AI协作记录/会话清单.json')
    spec = importlib.util.spec_from_file_location('project_export', ROOT / 'scripts/export-project-records.py')
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    for session in records['sessions']:
        if not session.get('file'):
            continue
        source = Path.home() / '.codex/sessions/2026/10/31' / session['source_basename']
        prefix = source.read_bytes()[:session['source_complete_prefix_bytes']]
        assert hashlib.sha256(prefix).hexdigest() == session['source_prefix_sha256']
        rows = [json.loads(line) for line in prefix.splitlines() if line.strip()]
        exported = (DRAFT / 'AI协作记录' / session['file']).read_text(encoding='utf8')
        for message in session['messages']:
            row = rows[message['source_line']-1]
            item = row['payload']['item']
            assert item['id'] == message['id']
            parts = [c['text'] for c in item['content']]
            assert hashlib.sha256('\n'.join(parts).encode()).hexdigest() == message['source_text_sha256']
            marker = f'来源行：{message["source_line"]}；ID：{message["id"]}'
            assert marker in exported
            for text in parts:
                for _, pattern, replacement in mod.RULES:
                    text = pattern.sub(replacement, text)
                assert text in exported[exported.index(marker):], 'Missing/changed visible message: ' + message['id']
        for image in session['images']:
            target = DRAFT / 'AI协作记录' / image['path']
            assert target.is_file()
            if image['type'] == 'original_image_bytes':
                assert sha(target) == image['sha256']
        assert not session['missing_attachments']
    private = DRAFT / 'AI协作记录/附件/图像-7f1fec803fbc150aa7adf50d.jpg'
    assert not private.exists(), 'Identified private image must not be in submission draft'
    secret_hits = []
    for p in DRAFT.rglob('*'):
        if not p.is_file() or p.name == MANIFEST or p.suffix not in ('.md', '.json'):
            continue
        text = p.read_text(encoding='utf8')
        assert not re.search(r'(?i)C:(?:\\+|/+)Users(?:\\+|/+)15614', text), p.name
        assert 'DMoon22222' not in text, p.name
        for rule, pattern, _ in mod.RULES[:6]:
            if pattern.search(text):
                secret_hits.append({'path': p.relative_to(DRAFT).as_posix(), 'rule': rule})
    assert not secret_hits
    index = DRAFT / 'AI协作记录/索引.md'
    for href in re.findall(r'\]\(([^)]+)\)', index.read_text(encoding='utf8')):
        assert (index.parent / href).is_file(), href
    privacy = load(ROOT / '.contentops/submission-qa/candidate-privacy-scan.json')
    result = {'verified_at': datetime.now(timezone.utc).isoformat(), 'stage': 'local_external_drafts_only',
              'candidate_files_verified_unchanged': len(approved), 'candidate_jar_and_source_jar_sha256': FROZEN,
              'existing_tracked_files_unchanged': True, 'product_layout': 'Instructions and extracted ContentOps-CLI folder are siblings in final delivery',
              'layout_mapping_only_no_candidate_copy_or_symlink': True, 'product_relative_paths': paths, 'external_doc_links': links,
              'seven_command_examples_checked_against_source_and_existing_acceptance': True,
              'no_cli_maven_or_browser_execution_this_round': True,
              'ai_records': {k: records[k] for k in ('confirmed_sessions', 'acquired', 'ended_message_exports', 'pending_manual_export', 'needs_current_turn_refresh')},
              'source_prefix_and_visible_message_integrity_verified': True, 'text_credential_pattern_hits': secret_hits,
              'candidate_credential_pattern_hits': privacy['candidate_credential_pattern_hits'],
              'candidate_historical_local_user_path_file_count': len(privacy['historical_local_user_path_files']),
              'candidate_public_repository_account_file_count': len(privacy['public_repository_account_files']),
              'identified_private_image_in_draft': False, 'visual_review_pending': True,
              'final_ai_records_complete': False, 'final_submission_ready': False,
              'blockers': ['Current session final response and post-cutoff events require export after turn completion',
                           'Visual privacy review; one withheld image needs a minimum-redacted derivative',
                           'Source tool truncation and two invalid image fragments require disclosure/review, not invented reconstruction'],
              'no_zip_upload_push_or_email': True}
    (DRAFT / '验收记录.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf8')
    files = [{'path': p.relative_to(DRAFT).as_posix(), 'bytes': p.stat().st_size, 'sha256': sha(p)}
             for p in sorted(DRAFT.rglob('*')) if p.is_file() and p.name != MANIFEST]
    manifest = {'schema_version': 1, 'stage': 'submission_draft_not_final', 'paths_relative_to': 'delivery/submission-draft',
                'excluded_self': MANIFEST, 'reason': 'Generate checksums last; no self-referential hash',
                'file_count_excluding_self': len(files), 'bytes_excluding_self': sum(e['bytes'] for e in files), 'files': files,
                'ai_records_final_submission_ready': False}
    (DRAFT / MANIFEST).write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n', encoding='utf8')
    print(json.dumps({'candidate_unchanged': len(approved), 'frozen_jar_unchanged': True,
                      'draft_hashed_files': len(files), 'draft_bytes_excluding_manifest': manifest['bytes_excluding_self'],
                      'product_paths_checked': len(paths), 'guide_links_checked': len(links), 'visible_message_integrity': True,
                      'credential_hits': secret_hits, 'ai_complete': False}, ensure_ascii=True, indent=2))


if __name__ == '__main__':
    main()
