"""Read-only project audit; writes planning JSON only with --write. Never stages or packs files."""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import subprocess
import unicodedata
from urllib.parse import unquote, urlsplit
import xml.etree.ElementTree as ET
import zipfile

from markdown_it import MarkdownIt

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'delivery/plan'
REPORT = 'docs/09-最终交付文件盘点与目录规划.md'
GENERATED = {'delivery/plan/' + name for name in (
    'inventory.json', 'link-dependencies.json', 'delivery-manifest.json', 'validation.json')}
ADDITIONS = {REPORT, 'scripts/audit-delivery.py', 'scripts/capture-delivery-links.cjs'} | GENERATED
CORE_EVIDENCE = ('evidence/task2/', 'evidence/s5/', 'evidence/reliability-review/', 'evidence/cli-entry/')
PROTECTED = ['题目：内容运营后台 CLI 化.md', '内容运营后台接口数据/README.md',
             '内容运营后台接口数据/content-ops-admin-openapi.json', '内容运营后台接口数据/mock_data.json']
MD = MarkdownIt('commonmark', {'html': True}).enable('table')


def git(*args: str) -> bytes:
    return subprocess.check_output(['git', *args], cwd=ROOT)


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_json(path: Path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


class Page(HTMLParser):
    def __init__(self, text: str):
        super().__init__(convert_charrefs=True)
        self.links = []
        self.ids = set()
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get('id'):
            self.ids.add(attrs['id'])
        if tag == 'a' and attrs.get('name'):
            self.ids.add(attrs['name'])
        for attr in ('href', 'src', 'poster'):
            if attrs.get(attr):
                self.links.append((tag + '/' + attr, attrs[attr]))
        if attrs.get('srcset'):
            self.links.extend(('srcset', part.strip().split()[0]) for part in attrs['srcset'].split(','))


def markdown_page(text: str) -> Page:
    tokens = MD.parse(text)
    page = Page(MD.renderer.render(tokens, MD.options, {}))
    seen = Counter()
    page.documented_paths = []
    for token in tokens:
        for child in token.children or []:
            if child.type == 'code_inline' and '/' in child.content and not re.search(r'\s', child.content):
                page.documented_paths.append(child.content)
    for i, token in enumerate(tokens):
        if token.type != 'heading_open':
            continue
        title = tokens[i + 1].content
        slug = ''.join(c for c in title.lower() if c in '-_ ' or unicodedata.category(c)[0] in 'LN')
        slug = slug.replace(' ', '-')
        n = seen[slug]
        seen[slug] += 1
        page.ids.add(slug + ('-' + str(n) if n else ''))
    return page


def classify(path: str):
    parts = Path(path).parts
    if path != 'target/contentops.jar' and (
            path.startswith(('.git/', '.contentops/', 'target/', 'dist/', 'credentials/', 'secrets/', 'ai-records/source/'))
            or any(p in ('node_modules', '__pycache__', '.venv', 'venv', '.idea', '.vscode', '.aws', '.ssh') for p in parts)
            or Path(path).name.startswith('.env') or Path(path).suffix.lower() in ('.pyc', '.pem', '.key', '.pfx', '.p12', '.jks')
            or path == '内容运营后台接口数据.zip'):
        return 'D', False, 'exclude', 'Explicitly excluded cache/runtime/personal/credential or duplicate archive path'
    if path in ADDITIONS:
        return 'C', False, 'exclude', 'Planning report/data/audit tooling stay in development repository; final release gets a separate frozen checksum manifest'
    if path == 'target/contentops.jar':
        return 'A', True, 'present_unfrozen', 'Current executable JAR; must be rebuilt/frozen and verified in next stage'
    if path.startswith(('src/', 'demo/', 'scripts/')) or path in ('pom.xml', '.mvn/maven.config', 'README.md'):
        runtime = path.startswith('demo/') or path in ('README.md', 'scripts/contentops.cmd', 'scripts/enable-contentops.ps1')
        return 'A', runtime, 'keep', 'Complete runnable product, source/build or maintenance tooling'
    if path.startswith('内容运营后台接口数据/'):
        return 'A', False, 'keep', 'Original interfaces and immutable build-time Mock seed'
    if path.startswith(('docs/', *CORE_EVIDENCE)) or path in PROTECTED:
        return 'B', False, 'keep', 'Trial requirements, design or essential original execution evidence'
    if path.startswith(('evidence/s0-s2/', 'evidence/s3-s4/')):
        return 'C', False, 'keep', 'Retain complete streams behind historical evidence indexes and their documented failure/fix history'
    if path.startswith('evidence/') and (path.endswith('.cjs') or '/failure-' in path or path.endswith('/exit-code.txt')):
        return 'C', False, 'keep', 'Existing documented verification tool or failure/exit evidence; do not break reproduction instructions'
    if path in ('.gitignore', '.gitattributes', 'AGENTS.md') or path in GENERATED:
        return 'C', False, 'keep', 'Source context or delivery planning metadata'
    return 'C', False, 'exclude_if_unreferenced', 'Optional development history; keep if linked by retained material'


def audit():
    tracked = set(git('ls-files', '-z').decode('utf-8').split('\0')) - {''}
    candidates = tracked | ADDITIONS | {'target/contentops.jar'}
    files = {p for p in candidates if (ROOT / p).is_file()}
    pages = {}
    for name in sorted(files):
        if name in GENERATED:
            continue
        path = ROOT / name
        if path.suffix == '.html':
            pages[name] = Page(path.read_text(encoding='utf-8-sig'))
        elif path.suffix == '.md':
            pages[name] = markdown_page(path.read_text(encoding='utf-8-sig'))
    dynamic = json.loads(subprocess.check_output(['node', str(ROOT / 'scripts/capture-delivery-links.cjs')], cwd=ROOT))
    main = pages['demo/index.html']
    main.ids.update(dynamic['virtual_fragments'])
    for snapshot in dynamic['snapshots']:
        expanded = Page(snapshot['html'])
        main.ids.update(expanded.ids)
        main.links.extend(('dynamic/' + kind, value) for kind, value in expanded.links)
    edges = []
    for name, page in sorted(pages.items()):
        for kind, href in sorted(set(page.links)):
            parsed = urlsplit(href)
            if parsed.scheme and parsed.scheme != 'file':
                edges.append({'source': name, 'href': href, 'kind': kind, 'status': 'external', 'target': None})
                continue
            raw = unquote(parsed.path)
            if parsed.scheme == 'file' or re.match(r'^[A-Za-z]:[\\/]', raw):
                edges.append({'source': name, 'href': href, 'kind': kind, 'status': 'machine_absolute', 'target': None})
                continue
            path = ((ROOT / name).parent / raw).resolve() if raw else (ROOT / name)
            if not path.is_relative_to(ROOT):
                status, target = 'outside_project', None
            else:
                target = path.relative_to(ROOT).as_posix()
                status = 'present' if path.exists() else 'missing_target'
                if status == 'present' and parsed.fragment and target in pages and unquote(parsed.fragment) not in pages[target].ids:
                    status = 'missing_fragment'
            edges.append({'source': name, 'href': href, 'kind': kind, 'target': target,
                          'fragment': unquote(parsed.fragment), 'status': status,
                          'target_is_directory': path.is_dir()})
        # Existing inline-code evidence paths also document provenance even without a clickable link.
        # Future placeholders and runtime/cache paths are descriptions, not package dependencies.
        for value in getattr(page, 'documented_paths', []):
            if re.match(r'^[A-Za-z]:|^https?://', value) or '<' in value:
                continue
            for parent in ((ROOT / name).parent, ROOT):
                pattern = (parent / value).resolve()
                if not pattern.is_relative_to(ROOT):
                    continue
                relative = pattern.relative_to(ROOT).as_posix()
                if relative.startswith(('.git/', '.contentops/', 'dist/', 'ai-records/')) or relative in ('.git', '.contentops', 'dist'):
                    continue
                if pattern.is_dir() and len(Path(relative).parts) < 2:
                    continue  # A top-level category mention such as `evidence/` is not a recursive include.
                matches = sorted(ROOT.glob(relative)) if '*' in relative else [pattern]
                found = [p for p in matches if p.is_file() and p.relative_to(ROOT).as_posix() in files]
                if pattern.is_dir():
                    found = [ROOT / p for p in files if p.startswith(relative.rstrip('/') + '/')]
                if found:
                    for dest in found:
                        target = dest.relative_to(ROOT).as_posix()
                        if target == '内容运营后台接口数据.zip' or target.startswith('target/') and target != 'target/contentops.jar':
                            continue
                        edges.append({'source': name, 'href': value, 'kind': 'documented-existing-path',
                                      'target': target, 'status': 'present'})
                    break
    for name in sorted(p for p in files if p.endswith('.css')):
        text = (ROOT / name).read_text(encoding='utf-8-sig')
        for value in re.findall(r'url\(\s*[\"\']?([^\)\"\']+)', text):
            parsed = urlsplit(value)
            if parsed.scheme:
                edges.append({'source': name, 'href': value, 'kind': 'css/url', 'status': 'external', 'target': None})
            else:
                dest = (ROOT / name).parent / unquote(parsed.path)
                target = dest.resolve().relative_to(ROOT).as_posix()
                edges.append({'source': name, 'href': value, 'kind': 'css/url', 'target': target,
                              'status': 'present' if dest.exists() else 'missing_target'})
    for target in dynamic['provenance']:
        edges.append({'source': 'demo/data.js', 'href': target, 'kind': 'embedded-evidence-provenance',
                      'target': target, 'status': 'present' if (ROOT / target).is_file() else 'missing_target'})
    selected = {p for p in files if classify(p)[2] in ('keep', 'present_unfrozen')}
    incoming = defaultdict(set)
    changed = True
    while changed:
        changed = False
        for edge in edges:
            target = edge.get('target')
            if edge['source'] not in selected or not target or edge['status'] != 'present':
                continue
            targets = {p for p in files if p.startswith(target.rstrip('/') + '/')} if edge.get('target_is_directory') else {target}
            for name in targets:
                incoming[name].add(edge['source'])
                if name not in selected:
                    selected.add(name)
                    changed = True
    entries = []
    for name in sorted(files | GENERATED):
        category, runtime, recommendation, reason = classify(name)
        if recommendation == 'exclude_if_unreferenced' and name in selected:
            recommendation, reason = 'keep_referenced', 'Retained by HTML/Markdown link closure; preserve offline navigation'
        elif recommendation == 'exclude_if_unreferenced':
            recommendation = 'exclude'
        exists = (ROOT / name).is_file()
        generated = name in GENERATED
        entries.append({'path': name, 'category': category, 'recommendation': recommendation,
                        'reason': reason, 'required_runtime': runtime, 'required_build': name.startswith('src/') or name in ('pom.xml', '.mvn/maven.config', '内容运营后台接口数据/mock_data.json'),
                        'referenced': bool(incoming[name]), 'referenced_by': sorted(incoming[name]),
                        'source_exists': exists, 'bytes': (ROOT / name).stat().st_size if exists and not generated else None,
                        'sha256': sha(ROOT / name) if exists and not generated else None,
                        'hash_policy': 'Excluded to avoid generated-metadata self-reference' if generated else 'Observed source bytes; not final release freeze'})
    issues = [e for e in edges if e['status'] not in ('present', 'external')]
    candidates_issues = [e for e in issues if e['source'] in selected]
    package_missing = [e for e in edges if e['source'] in selected and e.get('target') in files and e.get('target') not in selected]
    patterns = {
        'github_token': rb'(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,})',
        'openai_key': rb'sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}',
        'aws_key': rb'(?:AKIA|ASIA)[A-Z0-9]{16}',
        'private_key': rb'-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----',
        'credential_url': rb'https?://[^\s/@:]+:[^\s/@]+@',
        'bearer_value': rb'(?i)Bearer\s+[A-Za-z0-9._~-]{20,}',
        'assigned_secret': rb'''(?i)(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[=:]\s*["']?[A-Za-z0-9_./+~=-]{16,}'''}
    secret_hits, absolute_paths = [], []
    for name in sorted(files - GENERATED):
        if name not in selected or (ROOT / name).suffix.lower() in ('.png', '.jpg', '.jar'):
            continue
        data = (ROOT / name).read_bytes()
        for rule, pattern in patterns.items():
            for match in re.finditer(pattern, data):
                secret_hits.append({'path': name, 'line': data[:match.start()].count(b'\n') + 1, 'rule': rule})
        if name.startswith(('scripts/', 'demo/')):
            for i, line in enumerate(data.decode('utf-8-sig', errors='replace').splitlines(), 1):
                if re.search(r'(?i)(?:[A-Z]:[\\/]|file:///)', line):
                    absolute_paths.append({'path': name, 'line': i, 'classification': 'review_context_no_automatic_replacement'})
    jar = ROOT / 'target/contentops.jar'
    with zipfile.ZipFile(jar) as archive:
        required_classes = ['com/example/contentops/Main.class', 'picocli/CommandLine.class',
                            'com/fasterxml/jackson/databind/ObjectMapper.class', 'com/fasterxml/jackson/core/JsonFactory.class',
                            'com/fasterxml/jackson/datatype/jsr310/JavaTimeModule.class']
        jar_info = {'path': 'target/contentops.jar', 'bytes': jar.stat().st_size, 'sha256': sha(jar),
                    'frozen': False, 'main_class_present': b'Main-Class: com.example.contentops.Main' in archive.read('META-INF/MANIFEST.MF'),
                    'seed_matches_original': archive.read('seed/mock_data.json') == (ROOT / PROTECTED[3]).read_bytes(),
                    'main_class_entry_present': 'com/example/contentops/Main.class' in archive.namelist(),
                    'embedded_required_classes': {p: p in archive.namelist() for p in required_classes},
                    'main_class_major_version': int.from_bytes(archive.read(required_classes[0])[6:8], 'big')}
    protected = []
    with zipfile.ZipFile(ROOT / '内容运营后台接口数据.zip') as original:
        for name in PROTECTED:
            data = (ROOT / name).read_bytes()
            seed_commit = git('show', '2a6ed8c:' + name)
            protected.append({'path': name, 'sha256': hashlib.sha256(data).hexdigest(),
                              'matches_initial_commit': data == seed_commit,
                              'matches_original_archive': data == original.read(name) if name.startswith('内容运营后台接口数据/') else None})
    referenced_html = sorted({e['target'] for e in edges if e.get('target') and e['source'].startswith('demo/')})
    recorded_hashes = read_json(ROOT / 'evidence/demo/source-hashes.json')
    source_hash_mismatches = [name for name, expected in recorded_hashes.items()
                              if not (ROOT / name).is_file() or sha(ROOT / name).lower() != expected.lower()]
    task2 = read_json(ROOT / 'evidence/task2/validation/result.json')
    task2_missing_streams = []
    for command in task2['commands']:
        for stream in ('stdout', 'stderr'):
            if not (ROOT / 'evidence/task2' / command[stream]).is_file():
                task2_missing_streams.append(command[stream])
    ns = {'m': 'http://maven.apache.org/POM/4.0.0'}
    pom = ET.parse(ROOT / 'pom.xml').getroot()
    maven_inputs = {'pom_parsed': True, 'compiler_release': pom.find('m:properties/m:maven.compiler.release', ns).text,
                    'seed_resource_directory': pom.find('m:build/m:resources/m:resource/m:directory', ns).text,
                    'maven_config_exists': (ROOT / '.mvn/maven.config').is_file(),
                    'all_tracked_paths_exist': all((ROOT / p).is_file() for p in tracked)}
    summary = {'selected_files': len(selected), 'selected_known_bytes': sum(e['bytes'] or 0 for e in entries if e['path'] in selected),
               'excluded_baseline_files': sum(e['recommendation'] == 'exclude' and e['path'] not in ADDITIONS for e in entries),
               'excluded_baseline_bytes': sum(e['bytes'] or 0 for e in entries if e['recommendation'] == 'exclude' and e['path'] not in ADDITIONS),
               'category_counts': dict(Counter(e['category'] for e in entries)), 'edge_count': len(edges),
               'html_pages': sum(p.endswith('.html') for p in pages), 'dynamic_states': len(dynamic['snapshots']),
               'all_link_issues': len(issues), 'candidate_link_issues': len(candidates_issues),
               'package_missing_targets': len(package_missing), 'credential_pattern_hits': len(secret_hits)}
    manifest = {'schema_version': 1, 'stage': 'planning_only_not_release', 'source_commit': 'd8100279dd6ed37d46042abf4a40ff9a0f668f37',
                'paths_relative_to': 'project_root', 'archive_root_proposal': 'ContentOps-CLI/',
                'copy_algorithm': 'Copy only entries with keep/keep_referenced/present_unfrozen, preserving relative paths. Refuse present_unfrozen JAR until release freeze; refuse missing required files. Never copy directories recursively from workspace.',
                'exclude_rules': ['.git/**', '.contentops/**', 'target/** except target/contentops.jar', 'dist/**', '**/node_modules/**', '**/__pycache__/**', '**/*.pyc', '**/.venv/**', '**/venv/**', '.idea/**', '.vscode/**', '.env*', 'credentials/**', 'secrets/**', 'ai-records/source/**', '内容运营后台接口数据.zip'],
                'excluded_category': 'D', 'summary': summary, 'files': entries,
                'pending_external_files': [
                    {'path': 'dist/final-delivery/运行与查看说明.md', 'status': 'pending', 'source_exists': False, 'sha256': None},
                    {'path': 'dist/final-delivery/补充说明.md', 'status': 'pending', 'source_exists': False, 'sha256': None},
                    {'path': 'ai-records/README.md', 'status': 'pending', 'source_exists': False, 'sha256': None},
                    {'path': 'ai-records/submission/', 'status': 'pending_actual_sessions_not_generated_this_round', 'source_exists': False, 'sha256': None},
                    {'path': 'dist/final-delivery/最终产物.zip', 'status': 'pending_placeholder_name', 'source_exists': False, 'sha256': None}]}
    dependencies = {'method': dynamic['method'], 'external_links_are_not_offline_runtime_dependencies': True,
                    'directory_links_expand_to_all_existing_candidate_descendants': True,
                    'json_historical_paths_are_data_not_navigation': True,
                    'reading_map': dynamic['reading_map'], 'dynamic_states': [s['name'] for s in dynamic['snapshots']],
                    'demo_cross_directory_targets': referenced_html, 'edges': edges,
                    'issues': issues, 'candidate_issues': candidates_issues, 'package_missing': package_missing}
    validation = {'stage': 'static_only_no_business_execution', 'summary': summary, 'jar_observation': jar_info,
                  'protected_originals': protected, 'credential_pattern_hits': secret_hits,
                  'immutable_demo_evidence_sources': {'checked': len(recorded_hashes), 'mismatches': source_hash_mismatches},
                  'task2_original_evidence': {'command_count': len(task2['commands']), 'missing_streams': task2_missing_streams,
                                            'historical_jar_sha256': task2['jar_sha256'],
                                            'current_jar_is_same_binary_as_historical': jar_info['sha256'].lower() == task2['jar_sha256'].lower(),
                                            'recorded_cross_jvm_verified': task2['cross_jvm_verified'],
                                            'recorded_all_assertions_passed': task2['all_assertions_passed']},
                  'maven_static_inputs': maven_inputs,
                  'absolute_path_occurrences_in_runtime_and_maintenance_material': absolute_paths,
                  'missing_planned_files': [p for p in sorted(ADDITIONS - GENERATED) if p not in files],
                  'no_tests_or_browser_runs_claimed': True}
    return manifest, dependencies, validation


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--write', action='store_true')
    parser.add_argument('--baseline', type=Path)
    args = parser.parse_args()
    manifest, dependencies, validation = audit()
    if args.write:
        OUT.mkdir(parents=True, exist_ok=True)
        if args.baseline:
            (OUT / 'inventory.json').write_text(args.baseline.read_text(encoding='utf-8'), encoding='utf-8')
        for filename, data in [('delivery-manifest.json', manifest), ('link-dependencies.json', dependencies), ('validation.json', validation)]:
            (OUT / filename).write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    else:
        saved = read_json(OUT / 'delivery-manifest.json')
        expected = {e['path']: e for e in saved['files'] if e['path'] not in GENERATED}
        current = {e['path']: e for e in manifest['files'] if e['path'] not in GENERATED}
        if current != expected:
            raise SystemExit('Manifest sources changed; review and regenerate with --write')
    print(json.dumps(validation['summary'], ensure_ascii=False, indent=2))
    if validation['credential_pattern_hits'] or validation['missing_planned_files']:
        raise SystemExit(2)
    if (validation['immutable_demo_evidence_sources']['mismatches']
            or validation['task2_original_evidence']['missing_streams']
            or not all(p['matches_initial_commit'] and p['matches_original_archive'] is not False for p in validation['protected_originals'])
            or not validation['jar_observation']['seed_matches_original']
            or not all(validation['jar_observation']['embedded_required_classes'].values())):
        raise SystemExit(4)
    if validation['summary']['candidate_link_issues'] or validation['summary']['package_missing_targets']:
        raise SystemExit(3)


if __name__ == '__main__':
    main()
