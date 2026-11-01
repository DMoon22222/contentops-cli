"""Release candidate preparation. Never rebuilds, deletes, creates ZIPs, or sends files."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
from urllib.parse import unquote, urlsplit
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'evidence/release'
CANDIDATE = ROOT / 'delivery/candidate/ContentOps-CLI'
TRIAL = ROOT / 'delivery/test-run/面试解压测试 ContentOps CLI'
BASE = 'c5906402d87ad78e5ea43bd0932cbd97bb08f00e'


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def save(name, value):
    (OUT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def approved():
    return [e for e in read(ROOT / 'delivery/plan/delivery-manifest.json')['files']
            if e['recommendation'] in ('keep', 'keep_referenced', 'present_unfrozen')]


def expected_hash(entry, frozen):
    if entry['path'] == frozen['path']:
        return frozen['sha256']
    adjustments = read(OUT / 'input-adjustments.json') if (OUT / 'input-adjustments.json').exists() else []
    match = [e for e in adjustments if e['path'] == entry['path']]
    if match:
        assert len(match) == 1 and entry['sha256'] == match[0]['planned_sha256']
        assert match[0]['path'] == '.gitignore', 'Only documented generated-directory exclusions are allowed'
        return match[0]['candidate_sha256']
    return entry['sha256']


def safe_file(base, name):
    rel = Path(name)
    if rel.is_absolute() or '..' in rel.parts or '\\' in name or ':' in name:
        raise ValueError('Unsafe manifest path: ' + name)
    path = base / rel
    if not path.resolve().is_relative_to(base.resolve()):
        raise ValueError('Path escaped base: ' + name)
    return path


def freeze():
    if (OUT / 'frozen-jar.json').exists():
        raise RuntimeError('JAR already frozen; no silent replacement permitted')
    assert read(OUT / 'maven-result.json')['exit_code'] == 0, 'Build failed'
    suites = []
    for kind in ('surefire', 'failsafe'):
        dest = OUT / 'test-reports' / kind
        dest.mkdir(parents=True, exist_ok=False)
        for path in sorted((ROOT / f'target/{kind}-reports').glob('*')):
            if path.suffix in ('.xml', '.txt'):
                shutil.copyfile(path, dest / path.name)
            if path.name.startswith('TEST-') and path.suffix == '.xml':
                node = ET.parse(path).getroot()
                suites.append({'kind': kind, 'suite': node.attrib['name'],
                               **{k: int(node.get(k, 0)) for k in ('tests', 'failures', 'errors', 'skipped')}})
    totals = {k: sum(s[k] for s in suites) for k in ('tests', 'failures', 'errors', 'skipped')}
    assert totals == {'tests': 205, 'failures': 0, 'errors': 0, 'skipped': 0}, totals
    save('test-summary.json', {'suites': suites, 'totals': totals})
    jar = ROOT / 'target/contentops.jar'
    with zipfile.ZipFile(jar) as z:
        manifest = z.read('META-INF/MANIFEST.MF').decode()
        assert 'Main-Class: com.example.contentops.Main' in manifest
        required = ['com/example/contentops/Main.class', 'picocli/CommandLine.class',
                    'com/fasterxml/jackson/databind/ObjectMapper.class', 'com/fasterxml/jackson/core/JsonFactory.class',
                    'com/fasterxml/jackson/datatype/jsr310/JavaTimeModule.class']
        assert all(p in z.namelist() for p in required)
        assert z.read('seed/mock_data.json') == (ROOT / '内容运营后台接口数据/mock_data.json').read_bytes()
        assert not any('ReliabilityProbe' in p or p.endswith('Test.class') for p in z.namelist())
        version = int.from_bytes(z.read(required[0])[6:8], 'big')
        assert version == 61
    source = {e['path']: digest(ROOT / e['path']) for e in approved()
              if e['path'].startswith('src/') or e['path'] in ('pom.xml', '.mvn/maven.config')}
    value = {'source_commit': BASE, 'frozen_at': datetime.now(timezone.utc).isoformat(),
             'path': 'target/contentops.jar', 'bytes': jar.stat().st_size, 'sha256': digest(jar),
             'manifest': manifest, 'required_classes': required, 'class_major_version': version,
             'seed_matches_original': True, 'test_helpers_absent': True, 'source_inputs_sha256': source,
             'policy': 'Never rebuild or replace silently. A new build invalidates this freeze and all candidate acceptance.'}
    save('frozen-jar.json', value)
    print(json.dumps({'frozen_jar': value['sha256'], 'bytes': value['bytes'], 'tests': totals}, indent=2))


def copy_candidate():
    frozen = read(OUT / 'frozen-jar.json')
    entries = approved()
    assert not CANDIDATE.exists() and not TRIAL.exists(), 'Never overwrite a prior candidate or trial'
    for e in entries:
        p = safe_file(ROOT, e['path'])
        expected = expected_hash(e, frozen)
        assert p.is_file() and digest(p) == expected, 'Missing/changed approved input: ' + e['path']
    assert len(entries) == 1920
    for e in entries:
        src = safe_file(ROOT, e['path'])
        dest = safe_file(CANDIDATE, e['path'])
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dest)
    # Copy the precise same approved set into a disposable Chinese/space path; no recursive copy.
    for e in entries:
        src = safe_file(CANDIDATE, e['path'])
        dest = safe_file(TRIAL, e['path'])
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dest)
    audit_candidate()


def audit_candidate():
    frozen = read(OUT / 'frozen-jar.json')
    assert digest(ROOT / frozen['path']) == frozen['sha256'], 'Frozen source JAR changed'
    entries = approved()
    expected = {e['path']: e for e in entries}
    actual = {p.relative_to(CANDIDATE).as_posix() for p in CANDIDATE.rglob('*') if p.is_file()}
    assert actual == set(expected), {'missing': sorted(set(expected) - actual), 'unexpected': sorted(actual - set(expected))}
    records = []
    for name in sorted(actual):
        p = safe_file(CANDIDATE, name)
        wanted = expected_hash(expected[name], frozen)
        assert digest(p) == wanted, 'Candidate content mismatch: ' + name
        records.append({'path': name, 'bytes': p.stat().st_size, 'sha256': digest(p)})
    spec = importlib.util.spec_from_file_location('delivery_audit', ROOT / 'scripts/audit-delivery.py')
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    pages = {}
    for name in actual:
        p = CANDIDATE / name
        if p.suffix == '.html':
            pages[name] = helper.Page(p.read_text(encoding='utf-8-sig'))
        elif p.suffix == '.md':
            pages[name] = helper.markdown_page(p.read_text(encoding='utf-8-sig'))
    adapter = (ROOT / 'scripts/capture-delivery-links.cjs').read_text(encoding='utf-8')
    marker = "const root = path.resolve(__dirname, '..');"
    assert marker in adapter, 'Review static adapter after its entry point changes'
    adapter = adapter.replace(marker, 'const root = process.argv[1];', 1)
    dynamic = json.loads(subprocess.check_output(['node', '-e', adapter, str(CANDIDATE)]))
    main = pages['demo/index.html']
    main.ids.update(dynamic['virtual_fragments'])
    for snapshot in dynamic['snapshots']:
        expanded = helper.Page(snapshot['html'])
        main.ids.update(expanded.ids)
        main.links.extend(expanded.links)
    issues, checked = [], 0
    edges = read(ROOT / 'delivery/plan/link-dependencies.json')['edges']
    direct = [{'source': n, 'href': h, 'kind': k} for n, page in pages.items() for k, h in page.links]
    for edge in direct + [e for e in edges if e['source'] in actual and e.get('status') == 'present']:
        source, href = edge['source'], edge['href']
        u = urlsplit(href)
        if u.scheme and u.scheme != 'file':
            continue  # References only; no external network needed to operate the product.
        if edge.get('target'):
            dest = safe_file(CANDIDATE, edge['target'])
        else:
            dest = ((CANDIDATE / source).parent / unquote(u.path)).resolve() if u.path else CANDIDATE / source
        checked += 1
        if not dest.resolve().is_relative_to(CANDIDATE.resolve()) or not dest.exists():
            issues.append({'source': source, 'href': href, 'reason': 'outside/missing'})
            continue
        target = dest.relative_to(CANDIDATE).as_posix()
        if u.fragment and target in pages and unquote(u.fragment) not in pages[target].ids:
            issues.append({'source': source, 'href': href, 'reason': 'missing_anchor'})
    hits = []
    for name in actual:
        p = CANDIDATE / name
        if p.suffix in ('.jar', '.png', '.jpg'):
            continue
        data = p.read_bytes()
        import re
        for rule, pattern in {'private_key': rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
                              'token': rb'(?:ghp_|github_pat_|sk-proj-)[A-Za-z0-9_-]{20,}',
                              'bearer': rb'(?i)Bearer\s+[A-Za-z0-9._~-]{20,}',
                              'aws': rb'(?:AKIA|ASIA)[A-Z0-9]{16}'}.items():
            if re.search(pattern, data):
                hits.append({'path': name, 'rule': rule})
    assert not issues and not hits, {'links': issues, 'credential_patterns': hits}
    assert not (CANDIDATE / '.contentops').exists() and not (CANDIDATE / '.git').exists()
    assert list((CANDIDATE / 'target').iterdir()) == [CANDIDATE / 'target/contentops.jar']
    payload = json.dumps(records, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')
    summary = {'source_commit': BASE, 'candidate_root': CANDIDATE.relative_to(ROOT).as_posix(),
               'files': len(records), 'bytes': sum(e['bytes'] for e in records),
               'file_records_sha256': hashlib.sha256(payload).hexdigest(),
               'directory_hash_definition': 'SHA256 of UTF-8 compact JSON file records, sorted by path and object keys; excludes external manifest itself',
               'frozen_jar_sha256': frozen['sha256'], 'local_references_checked': checked,
               'candidate_dynamic_template_states': len(dynamic['snapshots']),
               'link_issues': issues, 'credential_pattern_hits': hits, 'unexpected_files': [],
               'candidate_has_runtime_state': False, 'candidate_hashes_match_approved_sources': True}
    save('candidate-files.json', {'summary': summary, 'files': records})
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=('freeze', 'copy', 'audit'))
    args = parser.parse_args()
    {'freeze': freeze, 'copy': copy_candidate, 'audit': audit_candidate}[args.phase]()
