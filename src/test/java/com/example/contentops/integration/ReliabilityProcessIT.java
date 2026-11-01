package com.example.contentops.integration;

import com.example.contentops.infrastructure.JsonSupport;
import com.example.contentops.model.ContentModels.ContentDetail;
import com.example.contentops.support.ReliabilityEvidence;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import static org.junit.jupiter.api.Assertions.*;

/** Controlled independent JVMs; wrapped entrypoints are explicitly distinguished from java -jar. */
class ReliabilityProcessIT {
    @TempDir Path temporary;
    Path project, jar, state, coord;
    String java;
    ReliabilityEvidence evidence;
    record Child(Process process, Path out, Path err, List<String> args, String name) { }
    record Run(int exit, JsonNode result) { }
    @BeforeEach void setup() throws Exception {
        project = Path.of(System.getProperty("contentops.project")).toAbsolutePath();
        jar = Path.of(System.getProperty("contentops.jar")).toAbsolutePath();
        state = temporary.resolve("state"); coord = Files.createDirectory(temporary.resolve("barriers"));
        java = Path.of(System.getProperty("java.home"), "bin", System.getProperty("os.name").startsWith("Windows") ? "java.exe" : "java").toString();
        assertTrue(Files.isRegularFile(jar));
    }
    Child start(String name, List<String> args) throws Exception {
        var builder = new ProcessBuilder(args).directory(project.toFile());
        builder.environment().put("CONTENTOPS_STATE_DIR", state.toString());
        builder.environment().remove("CONTENTOPS_MOCK_SCENARIO");
        for (var key : List.of("JAVA_TOOL_OPTIONS", "_JAVA_OPTIONS", "JDK_JAVA_OPTIONS")) { builder.environment().remove(key); }
        Path out = evidence.directory.resolve(name + ".stdout.txt"), err = evidence.directory.resolve(name + ".stderr.txt");
        builder.redirectOutput(out.toFile()).redirectError(err.toFile());
        evidence.write(name + ".started.json", Map.of("arguments", args, "state_directory", state.toString(),
                "started_at", Instant.now().toString(), "jar_sha256", ReliabilityEvidence.sha(Files.readAllBytes(jar)),
                "entrypoint", args.contains("-jar") ? "unmodified packaged Java Main" : "test-only barrier harness using packaged CliRunner / Store"));
        return new Child(builder.start(), out, err, List.copyOf(args), name);
    }
    Run finish(Child child, boolean envelope) throws Exception {
        assertTrue(child.process().waitFor(35, TimeUnit.SECONDS), "controlled test child did not complete");
        int code = child.process().exitValue(); String stdout = Files.readString(child.out());
        evidence.write(child.name() + ".finished.json", Map.of("pid", child.process().pid(), "exit_code", code, "finished_at", Instant.now().toString()));
        Files.writeString(evidence.directory.resolve(child.name() + ".exit-code.txt"), code + "\n");
        JsonNode body = JsonSupport.create().readTree(stdout);
        if (envelope) {
            assertEquals(code, body.path("exit_code").asInt()); assertEquals("mock", body.path("environment").asText());
            assertEquals("1", body.path("schema_version").asText());
        }
        return new Run(code, body);
    }
    List<String> jarCommand(String... tail) {
        var args = new ArrayList<>(List.of(java, "-Dfile.encoding=UTF-8", "-jar", jar.toString(), "--output", "json"));
        args.addAll(List.of(tail)); return args;
    }
    List<String> probeCommand(String mode, String actor, String... tail) {
        var args = new ArrayList<>(List.of(java, "-Dfile.encoding=UTF-8", "-cp", project.resolve("target/test-classes") + File.pathSeparator + jar,
                "com.example.contentops.support.ReliabilityProbe", mode, state.toString(), coord.toString(), actor));
        args.addAll(List.of(tail)); return args;
    }
    Run jar(String name, String... tail) throws Exception {
        Child c = start(name, jarCommand(tail));
        try { return finish(c, true); } finally { stop(c); }
    }
    void ready(String actor, String stage, Child child) throws Exception {
        Path marker = coord.resolve(actor + "." + stage + ".json");
        long deadline = System.nanoTime() + Duration.ofSeconds(15).toNanos();
        while (!Files.exists(marker) && System.nanoTime() < deadline && child.process().isAlive()) { Thread.sleep(10); }
        assertTrue(Files.exists(marker), "missing deterministic barrier; stderr=" + Files.readString(child.err()));
        evidence.write(actor + "." + stage + ".json", JsonSupport.create().readTree(Files.readAllBytes(marker)));
    }
    void release(String gate) throws Exception {
        evidence.write("release-" + gate + ".json", Map.of("at", Instant.now().toString(), "gate", gate));
        Files.writeString(coord.resolve(gate), "released");
    }
    void stop(Child c) throws Exception {
        if (c != null && c.process().isAlive()) { c.process().destroyForcibly(); c.process().waitFor(5, TimeUnit.SECONDS); }
    }
    @Test void sequentialReviewHasOneLogOneCommitAndMatchingActualExitCodes() throws Exception {
        evidence = new ReliabilityEvidence("jvm-sequential-review"); evidence.snapshot("before.json", state);
        Run a = jar("A", "content", "review", "ct_000004", "--action", "approve", "--reason", "审查用演示决定", "--execute", "--yes");
        byte[] committed = Files.readAllBytes(state.resolve("state.json"));
        Run b = jar("B", "content", "review", "ct_000004", "--action", "approve", "--execute", "--yes");
        var after = evidence.snapshot("after.json", state);
        Run history = jar("history", "content", "history", "ct_000004");
        assertEquals(0, a.exit()); assertEquals(2, b.exit()); assertEquals("REVIEW_NOT_PENDING", b.result().at("/error/code").asText());
        assertArrayEquals(committed, Files.readAllBytes(state.resolve("state.json")));
        assertEquals(1, after.path("revision").asInt()); assertEquals(1, history.result().at("/data/items").size());
    }
    @Test void twoJvmReviewersBothPassPreflightAndThenBothAppendDespiteFileLock() throws Exception {
        evidence = new ReliabilityEvidence("jvm-review-race"); evidence.snapshot("before.json", state);
        Child a = null, b = null;
        try {
            String[] command = {"--output", "json", "content", "review", "ct_000004", "--action", "approve", "--reason", "并发风险测试的显式决定", "--execute", "--yes"};
            a = start("A", probeCommand("review-gate", "A", command)); b = start("B", probeCommand("review-gate", "B", command));
            ready("A", "ready", a); ready("B", "ready", b);
            for (String actor : List.of("A", "B")) {
                var marker = JsonSupport.create().readTree(Files.readAllBytes(coord.resolve(actor + ".ready.json")));
                assertEquals("pending", marker.at("/facts/current/review_status").asText());
                assertEquals(2, marker.at("/facts/detail_reads_before_write").asInt());
                assertEquals(1, marker.at("/facts/request").size());
            }
            evidence.snapshot("both-validated-no-write.json", state);
            release("A.release"); Run ar = finish(a, true); evidence.snapshot("after-A.json", state);
            release("B.release"); Run br = finish(b, true); var after = evidence.snapshot("after-B.json", state);
            Run history = jar("fresh-history", "content", "history", "ct_000004");
            Run detail = jar("fresh-detail", "content", "get", "ct_000004");
            assertNotEquals(a.process().pid(), b.process().pid());
            assertEquals(0, ar.exit()); assertEquals(0, br.exit());
            assertEquals("succeeded", ar.result().path("status").asText()); assertEquals("succeeded", br.result().path("status").asText());
            assertEquals(2, after.path("revision").asInt()); assertEquals(2, history.result().at("/data/items").size());
            assertEquals("approved", detail.result().at("/data/review_status").asText());
        } finally { stop(a); stop(b); }
    }
    @Test void anotherJvmTagInsertedAfterPreflightIsLostEvenThoughFinalVerificationMatches() throws Exception {
        evidence = new ReliabilityEvidence("jvm-tag-lost-update"); evidence.snapshot("before.json", state);
        Child a = start("A", probeCommand("tags-gate", "A", "--output", "json", "content", "tags", "update", "ct_000004", "--add", "悬疑", "--execute", "--yes"));
        try {
            ready("A", "ready", a);
            Run b = jar("B", "content", "tags", "update", "ct_000004", "--add", "轻松", "--execute", "--yes");
            var afterB = evidence.snapshot("B-committed.json", state);
            assertEquals(0, b.exit()); assertTrue(afterB.path("content").path("tags").toString().contains("轻松"));
            release("A.release"); Run ar = finish(a, true); var after = evidence.snapshot("after.json", state);
            Run observed = jar("fresh-detail", "content", "get", "ct_000004");
            assertEquals(0, ar.exit()); assertEquals("matched", ar.result().at("/data/steps/tags/verification").asText());
            assertEquals(List.of("恋爱", "校园", "武侠", "悬疑"), JsonSupport.create().treeToValue(observed.result().path("data"), ContentDetail.class).tags());
            assertEquals("pending", observed.result().at("/data/review_status").asText());
            assertEquals(2, after.path("revision").asInt()); assertTrue(after.path("history").isMissingNode());
        } finally { stop(a); }
    }
    @Test void concurrentJvmSnapshotWritersKeepAllFortyMarkersAndReadersSeeCompleteSnapshots() throws Exception {
        evidence = new ReliabilityEvidence("jvm-snapshot-writers"); evidence.snapshot("before.json", state);
        Child a = null, b = null;
        try {
            a = start("A", probeCommand("markers", "A")); b = start("B", probeCommand("markers", "B"));
            ready("A", "ready", a); ready("B", "ready", b); release("start");
            ready("A", "mid", a); ready("B", "mid", b);
            var mid = evidence.snapshot("mid.json", state);
            assertEquals(20, mid.path("revision").asInt()); assertEquals(20, mid.path("markers").size());
            assertEquals(0, jar("mid-reader", "content", "get", "ct_000004").exit());
            release("finish"); assertEquals(0, finish(a, false).exit()); assertEquals(0, finish(b, false).exit());
            var after = evidence.snapshot("after.json", state);
            assertEquals(40, after.path("revision").asInt()); assertEquals(40, after.path("markers").size());
            for (String actor : List.of("A", "B")) for (int i = 0; i < 20; i++) { assertEquals(i, after.path("markers").path(actor + "-" + i).asInt(-1)); }
            assertEquals(0, jar("final-reader", "content", "get", "ct_000004").exit());
            try (var files = Files.list(state)) { assertTrue(files.noneMatch(p -> p.toString().endsWith(".tmp"))); }
            var actual = JsonSupport.create().readTree(Files.readAllBytes(state.resolve("state.json"))).get("data").deepCopy();
            ((com.fasterxml.jackson.databind.node.ObjectNode) actual).remove("_reliability_markers");
            try (var seed = getClass().getResourceAsStream("/seed/mock_data.json")) { assertEquals(JsonSupport.create().readTree(seed), actual); }
        } finally { stop(a); stop(b); }
    }
}
