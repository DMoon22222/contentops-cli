"""Read-only aggregation of this review's saved runs; no CLI or Maven execution."""
from pathlib import Path
import hashlib
import json
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "evidence/reliability-review"


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write(name, value):
    dest = OUT / name
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def suites(folder):
    result = []
    for path in sorted((OUT / folder).rglob("TEST-*.xml")):
        xml = ET.parse(path).getroot()
        result.append({"suite": xml.attrib["name"], **{key: int(xml.attrib[key]) for key in ("tests", "failures", "errors", "skipped")},
                       "report": path.relative_to(OUT).as_posix(),
                       "test_cases": [case.attrib["name"] for case in xml.findall("testcase")]})
    return {"suites": result, **{key: sum(row[key] for row in result) for key in ("tests", "failures", "errors", "skipped")}}


def main():
    summary = {"baseline_test": suites("baseline/test-reports"), "baseline_verify": suites("baseline/verify-reports"),
               "final_test": suites("tests/final-test-reports"), "final_verify": suites("tests/final-verify-reports")}
    for name, expected in (("baseline_test", 156), ("baseline_verify", 192), ("final_test", 165), ("final_verify", 205)):
        assert summary[name]["tests"] == expected, (name, summary[name]["tests"])
        assert all(summary[name][key] == 0 for key in ("failures", "errors", "skipped"))
    summary["new_unique_tests"] = summary["final_verify"]["tests"] - summary["baseline_verify"]["tests"]
    summary["note"] = "205 unique final JUnit instances; repeated test/verify/targeted executions are not added together"
    write("tests/test-summary.json", summary)

    index = []
    for directory in sorted((OUT / "scenarios/final-verify").iterdir()):
        if not directory.is_dir():
            continue
        origin = json.loads((directory / "origin.json").read_text(encoding="utf-8-sig"))
        records = sorted(p.relative_to(OUT).as_posix() for p in directory.iterdir() if p.is_file())
        children = []
        for path in sorted(directory.glob("*.started.json")):
            started = json.loads(path.read_text(encoding="utf-8-sig"))
            finished = json.loads(path.with_name(path.name.replace(".started", ".finished")).read_text(encoding="utf-8-sig"))
            children.append({"name": path.name.removesuffix(".started.json"), "entrypoint": started["entrypoint"],
                             "pid": finished["pid"], "exit_code": finished["exit_code"]})
        index.append({"scenario": origin["scenario"], "directory": directory.relative_to(OUT).as_posix(), "files": records, "child_processes": children})
    assert len(index) == 13
    processes = [c for row in index for c in row["child_processes"]]
    write("scenarios/index.json", {"source_phase": "final-verify", "scenario_count": len(index), "child_jvms": len(processes),
                                   "unmodified_jar_jvms": sum(c["entrypoint"] == "unmodified packaged Java Main" for c in processes), "scenarios": index})

    baseline = json.loads((ROOT / ".contentops/reliability-review/protected-before.json").read_text(encoding="utf-8-sig"))
    checked = []
    for name, before in baseline.items():
        path = Path(name) if Path(name).is_absolute() else ROOT / name
        after = sha(path).upper() if path.is_file() else None
        checked.append({"path": name, "before": before, "after": after, "unchanged": after == before})
    assert all(row["unchanged"] for row in checked)
    write("findings/protected-files.json", {"baseline_commit": "5647ac60d88b22725f1b1171682fdb556a560566", "count": len(checked), "all_unchanged": True, "files": checked})

    with zipfile.ZipFile(ROOT / "target/contentops.jar") as jar:
        names = jar.namelist()
        test_names = ("ReliabilityProbe", "ReliabilityEvidence", "ForwardingGateway", "ReliabilityProcessIT", "ReliabilityBoundaryTest")
        jar_facts = {"jar_sha256": sha(ROOT / "target/contentops.jar"), "seed_sha256": hashlib.sha256(jar.read("seed/mock_data.json")).hexdigest(),
                     "project_classes": sum(n.startswith("com/example/contentops/") and n.endswith(".class") for n in names),
                     "test_helpers_packaged": any(any(t in n for t in test_names) for n in names)}
        assert not jar_facts["test_helpers_packaged"]
    write("tests/final-jar.json", jar_facts)
    print(f"PASS: 13 new tests; 205 final unique tests; {len(index)} final scenarios; {len(processes)} child JVMs; {len(checked)} protected files unchanged")


if __name__ == "__main__":
    main()
