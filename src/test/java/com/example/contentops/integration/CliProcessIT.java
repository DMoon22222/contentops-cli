package com.example.contentops.integration;

import com.example.contentops.infrastructure.JsonSupport;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledOnOs;
import org.junit.jupiter.api.condition.OS;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.stream.Stream;
import java.util.zip.ZipFile;
import static org.junit.jupiter.api.Assertions.*;

class CliProcessIT {
    @TempDir Path temporary;
    Path project;
    Path jar;
    Path state;
    String java;
    int runNumber;
    record Run(int exit, String stdout, String stderr) { }

    @BeforeEach void setup() {
        project = Path.of(System.getProperty("contentops.project")).toAbsolutePath();
        jar = Path.of(System.getProperty("contentops.jar")).toAbsolutePath();
        assertTrue(Files.isRegularFile(jar), "verify must package the real JAR before integration tests");
        state = temporary.resolve("state");
        java = Path.of(System.getProperty("java.home"), "bin", isWindows() ? "java.exe" : "java").toString();
    }

    ProcessBuilder builder(List<String> args) throws Exception {
        var builder = new ProcessBuilder(args).directory(project.toFile());
        builder.environment().put("CONTENTOPS_STATE_DIR", state.toString());
        builder.environment().remove("CONTENTOPS_MOCK_SCENARIO");
        for (String key : List.of("JAVA_TOOL_OPTIONS", "_JAVA_OPTIONS", "JDK_JAVA_OPTIONS")) {
            builder.environment().remove(key);
        }
        builder.redirectOutput(temporary.resolve("out-" + runNumber).toFile());
        builder.redirectError(temporary.resolve("err-" + runNumber++).toFile());
        return builder;
    }

    Run execute(List<String> command) throws Exception {
        return execute(command, null);
    }

    Run execute(List<String> command, String scenario) throws Exception {
        var builder = builder(command);
        if (scenario != null) { builder.environment().put("CONTENTOPS_MOCK_SCENARIO", scenario); }
        var process = builder.start();
        try {
            if (!process.waitFor(20, TimeUnit.SECONDS)) {
                process.destroyForcibly();
                fail("test-created child process timed out");
            }
            return new Run(process.exitValue(), Files.readString(builder.redirectOutput().file().toPath(), StandardCharsets.UTF_8),
                    Files.readString(builder.redirectError().file().toPath(), StandardCharsets.UTF_8));
        } finally {
            if (process.isAlive()) { process.destroyForcibly(); }
        }
    }

    Run run(String... tail) throws Exception {
        return runScenario(null, tail);
    }

    Run runScenario(String scenario, String... tail) throws Exception {
        var args = new ArrayList<>(List.of(java, "-Dfile.encoding=UTF-8", "-jar", jar.toString()));
        args.addAll(List.of(tail));
        return execute(args, scenario);
    }

    List<String> probeCommand(String... tail) {
        var args = new ArrayList<>(List.of(java, "-cp",
                project.resolve("target/test-classes") + File.pathSeparator + jar,
                "com.example.contentops.support.StateStoreProbe"));
        args.addAll(List.of(tail));
        return args;
    }

    JsonNode parsed(Run run) throws Exception {
        assertFalse(run.stdout().startsWith("\ufeff"));
        assertFalse(run.stdout().contains("\u001b"));
        var result = JsonSupport.create().readTree(run.stdout());
        assertEquals(run.exit(), result.get("exit_code").asInt());
        assertEquals("1", result.get("schema_version").asText());
        return result;
    }

    @Test void realJarHelpHasNoConfigurationOrBusinessSideEffects() throws Exception {
        Run result = run("--env", "api", "--help");
        assertEquals(0, result.exit());
        assertTrue(result.stdout().contains("content"));
        assertTrue(result.stdout().contains("tags"));
        assertEquals("", result.stderr());
        assertFalse(Files.exists(state));
    }

    @Test void realJarCountsAndFixedPagination() throws Exception {
        var all = parsed(run("--output", "json", "content", "list"));
        assertEquals(300, all.at("/data/total").asInt());
        var pending = parsed(run("--output", "json", "content", "list", "--review-status", "pending", "--page", "1"));
        assertEquals(132, pending.at("/data/total").asInt());
        assertEquals(20, pending.at("/data/items").size());
        var last = parsed(run("--output", "json", "content", "list", "--review-status", "pending", "--page", "7"));
        assertEquals(12, last.at("/data/items").size());
        assertFalse(Files.exists(state.resolve("state.json")));
    }

    @Test void realJarTagCountsAndHistory() throws Exception {
        assertEquals(23, parsed(run("--output", "json", "tags", "list")).at("/data/total").asInt());
        assertEquals(25, parsed(run("--output", "json", "tags", "list", "--status", "all")).at("/data/total").asInt());
        var logs = parsed(run("--output", "json", "content", "history", "ct_000003")).at("/data/items");
        assertEquals("2026-06-15T05:39:59Z", logs.get(0).get("created_at").asText());
        assertEquals("2026-06-12T09:49:54Z", logs.get(1).get("created_at").asText());
    }

    @Test void realJarFullUnicodeDetailAndTableOutputs() throws Exception {
        var result = parsed(run("--output", "json", "content", "get", "ct_000004"));
        assertEquals(0, result.get("exit_code").asInt());
        assertEquals(12, result.get("data").size());
        assertEquals("无人剧场·第12话：逆流而上", result.at("/data/title").asText());
        assertTrue(result.at("/data/body").asText().contains("赛琳娜"));
        assertTrue(parsed(run("--output", "json", "content", "get", "ct_000042")).at("/data/title").asText().contains("🌊"));
        for (var command : List.of(new String[]{"content", "list", "--review-status", "pending"},
                new String[]{"content", "get", "ct_000004"}, new String[]{"content", "history", "ct_000003"},
                new String[]{"tags", "list", "--status", "active"})) {
            Run table = run(command);
            assertEquals(0, table.exit());
            assertTrue(table.stdout().contains("环境: mock"));
            assertEquals("", table.stderr());
        }
    }

    static Stream<Arguments> errors() {
        return Stream.of(
                Arguments.of(2, new String[]{"content", "list", "--page", "0"}),
                Arguments.of(2, new String[]{"content", "list", "--page", "abc"}),
                Arguments.of(2, new String[]{"content", "get"}),
                Arguments.of(3, new String[]{"content", "get", "ct_missing"}),
                Arguments.of(2, new String[]{"--env", "api", "content", "get", "ct_000004"}),
                Arguments.of(2, new String[]{"--env", "bad", "content", "get", "ct_000004"}),
                Arguments.of(2, new String[]{"tags", "list", "--status", "deprecated"}),
                Arguments.of(2, new String[]{"content", "review", "ct_000004", "--action", "unsupported"}),
                Arguments.of(2, new String[]{"content", "process", "ct_000004", "--execute", "--yes"}));
    }

    @ParameterizedTest @MethodSource("errors")
    void actualProcessExitCodesMatchErrorJson(int expected, String[] tail) throws Exception {
        var args = new ArrayList<>(List.of("--output", "json")); args.addAll(List.of(tail));
        Run result = run(args.toArray(String[]::new));
        assertEquals(expected, result.exit());
        var body = parsed(result);
        assertFalse(body.get("error").isNull());
        assertEquals(expected == 2 ? "rejected" : "failed", body.get("status").asText());
        assertFalse(Files.exists(state.resolve("state.json")));
    }

    @Test void separateJvmsPersistOnlySyntheticMarkersAndQueriesDoNotRewriteState() throws Exception {
        assertEquals(0, execute(probeCommand("put", state.toString(), "first", "one")).exit());
        assertEquals(0, execute(probeCommand("put", state.toString(), "second", "two")).exit());
        Run observed = execute(probeCommand("read", state.toString()));
        var marker = JsonSupport.create().readTree(observed.stdout());
        assertEquals("one", marker.get("first").asText());
        assertEquals("two", marker.get("second").asText());
        byte[] before = Files.readAllBytes(state.resolve("state.json"));
        assertEquals(0, parsed(run("--output", "json", "content", "get", "ct_000004")).get("exit_code").asInt());
        run("content", "list"); run("content", "history", "ct_000003"); run("tags", "list");
        assertArrayEquals(before, Files.readAllBytes(state.resolve("state.json")));
        var snapshot = JsonSupport.create().readTree(before);
        assertEquals(2, snapshot.get("revision").asLong());
        try (var resource = CliProcessIT.class.getResourceAsStream("/seed/mock_data.json")) {
            var expected = JsonSupport.create().readTree(resource);
            var actual = snapshot.get("data").deepCopy();
            ((com.fasterxml.jackson.databind.node.ObjectNode) actual).remove("_storage_test");
            assertEquals(expected, actual, "No audit or tag business mutation is allowed in S0–S2");
        }
    }

    @Test void realCrossJvmFileLockTimesOutAndThenReleases() throws Exception {
        Path ready = temporary.resolve("ready"); Path release = temporary.resolve("release");
        var holder = builder(probeCommand("hold-lock", state.toString(), ready.toString(), release.toString())).start();
        try {
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
            while (!Files.exists(ready) && System.nanoTime() < deadline && holder.isAlive()) { Thread.sleep(20); }
            assertTrue(Files.exists(ready), "child JVM did not acquire file lock");
            var blocked = parsed(run("--output", "json", "content", "get", "ct_000004"));
            assertEquals(3, blocked.get("exit_code").asInt());
            assertEquals("STATE_LOCK_TIMEOUT", blocked.at("/error/code").asText());
            assertFalse(Files.exists(state.resolve("state.json")));
        } finally {
            Files.writeString(release, "release");
            if (!holder.waitFor(5, TimeUnit.SECONDS)) { holder.destroyForcibly(); }
        }
        assertEquals(0, run("content", "get", "ct_000004").exit());
    }

    @Test void realJarReadsChangedFixtureFromAnotherJvmRatherThanSeedCache() throws Exception {
        assertEquals(0, execute(probeCommand("title-fixture", state.toString())).exit());
        byte[] before = Files.readAllBytes(state.resolve("state.json"));
        var result = parsed(run("--output", "json", "content", "get", "ct_000004"));
        assertEquals("跨 JVM 只读查询测试标记", result.at("/data/title").asText());
        assertEquals("pending", result.at("/data/review_status").asText());
        assertEquals(List.of("恋爱", "校园", "武侠"),
                JsonSupport.create().convertValue(result.at("/data/tags"), List.class));
        assertArrayEquals(before, Files.readAllBytes(state.resolve("state.json")));
    }

    @Test void corruptWorkingFileIsReportedByRealJarNotReset() throws Exception {
        Files.createDirectories(state);
        Files.writeString(state.resolve("state.json"), "{broken");
        var result = parsed(run("--output", "json", "content", "get", "ct_000004"));
        assertEquals(3, result.get("exit_code").asInt());
        assertEquals("STATE_INVALID", result.at("/error/code").asText());
        assertEquals("{broken", Files.readString(state.resolve("state.json")));
    }

    @Test void jarSeedAndOriginalMaterialsAreByteIdenticalAndMainTargetsJava17() throws Exception {
        var sources = Map.of(
                "题目：内容运营后台 CLI 化.md", "511036c3c832e5e6823db517a33129f06fbfa2bcedf3a0bf21eec1f374c0a337",
                "内容运营后台接口数据/mock_data.json", "44ba17cbe95432547a8fe380f81e0416ae51404957ed0c87de5ced7f8e3939b0",
                "内容运营后台接口数据/content-ops-admin-openapi.json", "c66a657de90d2fe021106b3ee822193b33ddcfba78b861d7ea9c536b6c82c935",
                "内容运营后台接口数据/README.md", "e289f0daaa91feecce1b4ce3bd28440b43ab29f33932d6d7e66008c2b28e3d60");
        for (var entry : sources.entrySet()) {
            assertEquals(entry.getValue(), HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(project.resolve(entry.getKey())))));
        }
        try (var zip = new ZipFile(jar.toFile())) {
            assertArrayEquals(Files.readAllBytes(project.resolve("内容运营后台接口数据/mock_data.json")),
                    zip.getInputStream(zip.getEntry("seed/mock_data.json")).readAllBytes());
            byte[] main = zip.getInputStream(zip.getEntry("com/example/contentops/Main.class")).readAllBytes();
            assertEquals(61, ((main[6] & 255) << 8) | (main[7] & 255));
        }
    }

    @Test @EnabledOnOs(OS.WINDOWS)
    void cmdWrapperPreservesNativeExitCodeAndUtf8Json() throws Exception {
        Run result = execute(List.of("cmd.exe", "/d", "/c", "scripts\\contentops.cmd",
                "--output", "json", "content", "get", "ct_missing"));
        assertEquals(3, result.exit());
        assertEquals("CONTENT_NOT_FOUND", parsed(result).at("/error/code").asText());
    }

    @Test void realJarProcessPreviewExecuteAndFreshQueriesProveTwoDurableCommits() throws Exception {
        var before = parsed(run("--output", "json", "content", "get", "ct_000004"));
        assertEquals("pending", before.at("/data/review_status").asText());
        assertEquals(0, parsed(run("--output", "json", "content", "history", "ct_000004")).at("/data/items").size());
        var preview = parsed(run("--output", "json", "content", "process", "ct_000004", "--action", "approve", "--reason", "演示：人工已给出审核决定", "--add", "轻松"));
        assertEquals("previewed", preview.path("status").asText());
        assertEquals("not_sent", preview.at("/data/steps/review/write").asText());
        assertFalse(Files.exists(state.resolve("state.json")));
        var executed = parsed(run("--output", "json", "--non-interactive", "content", "process", "ct_000004", "--action", "approve", "--reason", "演示：人工已给出审核决定", "--add", "轻松", "--execute", "--yes"));
        assertEquals("succeeded", executed.path("status").asText());
        assertEquals("acknowledged", executed.at("/data/steps/review/write").asText());
        assertEquals("matched", executed.at("/data/steps/tags/verification").asText());
        byte[] snapshot = Files.readAllBytes(state.resolve("state.json"));
        assertEquals(2, JsonSupport.create().readTree(snapshot).path("revision").asLong());
        var after = parsed(run("--output", "json", "content", "get", "ct_000004"));
        assertEquals("approved", after.at("/data/review_status").asText());
        assertEquals(List.of("恋爱", "校园", "武侠", "轻松"), JsonSupport.create().convertValue(after.at("/data/tags"), List.class));
        var logs = parsed(run("--output", "json", "content", "history", "ct_000004")).at("/data/items");
        assertEquals(1, logs.size()); assertEquals("op_mock_cli", logs.get(0).path("operator_id").asText());
        assertEquals("演示：人工已给出审核决定", logs.get(0).path("reason").asText());
        var repeated = parsed(run("--output", "json", "content", "review", "ct_000004", "--action", "approve", "--execute", "--yes"));
        assertEquals(2, repeated.path("exit_code").asInt());
        assertEquals("REVIEW_NOT_PENDING", repeated.at("/error/code").asText());
        assertArrayEquals(snapshot, Files.readAllBytes(state.resolve("state.json")));
    }

    @Test void realJarIndependentRejectAndAddPersistAndNoChangeDoesNotRewrite() throws Exception {
        var rejected = parsed(run("--output", "json", "content", "review", "ct_000004", "--action", "reject", "--reason", "人工演示驳回", "--execute", "--yes"));
        assertEquals("succeeded", rejected.path("status").asText());
        assertEquals("rejected", rejected.at("/data/observed/review_status").asText());
        var tags = parsed(run("--output", "json", "content", "tags", "update", "ct_000004", "--add", "轻松", "--execute", "--yes"));
        assertEquals("succeeded", tags.path("status").asText());
        assertEquals(4, tags.at("/data/observed/tags").size());
        byte[] before = Files.readAllBytes(state.resolve("state.json"));
        var same = parsed(run("--output", "json", "content", "tags", "update", "ct_000004", "--add", "轻松", "--execute", "--yes"));
        assertEquals("no_change", same.path("status").asText());
        assertEquals("skipped", same.at("/data/steps/tags/write").asText());
        assertArrayEquals(before, Files.readAllBytes(state.resolve("state.json")));
        var history = parsed(run("--output", "json", "content", "history", "ct_000004")).at("/data/items");
        assertEquals(1, history.size()); assertEquals("reject", history.get(0).path("action").asText());
    }

    @Test void realJarAllWritePreviewsLeaveExistingSnapshotByteIdentical() throws Exception {
        assertEquals(0, execute(probeCommand("put", state.toString(), "fixture", "preview-test")).exit());
        byte[] before = Files.readAllBytes(state.resolve("state.json"));
        for (var command : List.of(new String[]{"content", "review", "ct_000004", "--action", "approve"},
                new String[]{"content", "tags", "update", "ct_000004", "--add", "轻松"},
                new String[]{"content", "process", "ct_000004", "--action", "approve", "--add", "轻松"})) {
            var args = new ArrayList<>(List.of("--output", "json")); args.addAll(List.of(command));
            var result = parsed(run(args.toArray(String[]::new)));
            assertEquals("previewed", result.path("status").asText());
            assertArrayEquals(before, Files.readAllBytes(state.resolve("state.json")));
        }
    }

    static Stream<Arguments> writeGuards() {
        return Stream.of(new String[]{"--execute"}, new String[]{"--yes"}, new String[]{"--remove", "轻松"},
                new String[]{"--set", "轻松"}).map(args -> Arguments.of((Object) args));
    }
    @ParameterizedTest @MethodSource("writeGuards")
    void realJarMissingAuthorizationOrUnsupportedParametersRejectWithoutInput(String[] extra) throws Exception {
        var args = new ArrayList<>(List.of("--output", "json", "--non-interactive", "content", "process", "ct_000004", "--action", "approve", "--add", "轻松"));
        args.addAll(List.of(extra));
        var result = parsed(run(args.toArray(String[]::new)));
        assertEquals(2, result.path("exit_code").asInt()); assertFalse(Files.exists(state));
    }

    @Test void realJarInvalidNewTagsAndMissingRejectReasonNeverCreateAuditSnapshot() throws Exception {
        var all = parsed(run("--output", "json", "tags", "list", "--status", "all")).at("/data/items");
        String deprecated = null;
        for (var tag : all) { if ("deprecated".equals(tag.path("status").asText())) { deprecated = tag.path("tag").asText(); break; } }
        assertNotNull(deprecated);
        for (String tag : List.of("不存在的演示标签", deprecated)) {
            assertEquals(2, parsed(run("--output", "json", "content", "process", "ct_000004", "--action", "approve", "--add", tag, "--execute", "--yes")).path("exit_code").asInt());
        }
        assertEquals(2, parsed(run("--output", "json", "content", "review", "ct_000004", "--action", "reject", "--execute", "--yes")).path("exit_code").asInt());
        assertFalse(Files.exists(state.resolve("state.json")));
        assertEquals(0, parsed(run("--output", "json", "content", "history", "ct_000004")).at("/data/items").size());
    }

    @Test void realJarWriteHelpDoesNotConstructMockOrRequireAuthorization() throws Exception {
        for (var args : List.of(new String[]{"content", "review", "--help"}, new String[]{"content", "process", "--help"},
                new String[]{"content", "tags", "update", "--help"})) {
            assertEquals(0, run(args).exit()); assertFalse(Files.exists(state));
        }
    }

    JsonNode faultCounters(JsonNode result) throws Exception {
        String prefix = "MOCK_CALL_COUNTS ";
        for (var warning : result.path("warnings")) {
            if (warning.asText().startsWith(prefix)) { return JsonSupport.create().readTree(warning.asText().substring(prefix.length())); }
        }
        throw new AssertionError("Missing actual invocation counters");
    }
    Run processScenario(String scenario) throws Exception {
        return runScenario(scenario, "--output", "json", "--non-interactive", "content", "process", "ct_000004", "--action", "approve",
                "--reason", "S5：人工提供的开发验证决定", "--add", "轻松", "--execute", "--yes");
    }
    static Stream<Arguments> faultScenarios() {
        return Stream.of(Arguments.of("tags-reject-before-write", 4, 1, 1, 0, 3, 3),
                Arguments.of("review-commit-response-lost", 5, 1, 0, 0, 2, 2),
                Arguments.of("tags-commit-response-lost", 5, 2, 1, 1, 3, 3),
                Arguments.of("review-readback-mismatch", 6, 1, 0, 0, 3, 4),
                Arguments.of("tags-readback-mismatch", 6, 2, 1, 1, 4, 5));
    }
    @ParameterizedTest @MethodSource("faultScenarios")
    void realJarFaultsPreserveDiskFactsStepStatesAndExactWriteCounts(String scenario, int code, int revision,
                                                                 int tagAttempts, int tagDelegates, int reads, int delegateReads) throws Exception {
        var initial = parsed(runScenario(scenario, "--output", "json", "content", "get", "ct_000004"));
        assertEquals("pending", initial.at("/data/review_status").asText());
        assertEquals(0, faultCounters(initial).path("review_attempts").asInt());
        var preview = parsed(runScenario(scenario, "--output", "json", "content", "process", "ct_000004", "--action", "approve", "--add", "轻松"));
        assertEquals("previewed", preview.path("status").asText()); assertFalse(Files.exists(state.resolve("state.json")));
        Run invoked = processScenario(scenario); var result = parsed(invoked);
        assertEquals(code, invoked.exit()); assertEquals(code == 4 ? "partial" : code == 5 ? "unknown" : "verification_failed", result.path("status").asText());
        assertTrue(invoked.stderr().contains("MOCK_FAULT_ACTIVE scenario=" + scenario));
        var calls = faultCounters(result);
        assertEquals(1, calls.path("review_attempts").asInt()); assertEquals(1, calls.path("review_delegate_calls").asInt());
        assertEquals(tagAttempts, calls.path("tag_attempts").asInt()); assertEquals(tagDelegates, calls.path("tag_delegate_calls").asInt());
        assertEquals(reads, calls.path("content_reads").asInt()); assertEquals(delegateReads, calls.path("delegate_content_reads").asInt());
        assertEquals(code == 6 ? 1 : 0, calls.path("injected_readbacks").asInt());
        assertEquals(scenario.startsWith("review-commit") ? "unknown" : "acknowledged", result.at("/data/steps/review/write").asText());
        assertEquals(tagAttempts == 0 ? "not_sent" : code == 4 ? "failed" : code == 5 ? "unknown" : "acknowledged", result.at("/data/steps/tags/write").asText());
        assertEquals(scenario.startsWith("review-commit") ? "not_checked" : scenario.startsWith("review-readback") ? "mismatched" : "matched", result.at("/data/steps/review/verification").asText());
        assertEquals(scenario.startsWith("tags-readback") ? "mismatched" : "not_checked", result.at("/data/steps/tags/verification").asText());
        assertEquals(List.of("恋爱", "校园", "武侠"), JsonSupport.create().convertValue(result.at("/data/observed/tags"), List.class));
        byte[] committed = Files.readAllBytes(state.resolve("state.json"));
        assertEquals(revision, JsonSupport.create().readTree(committed).path("revision").asInt());
        // run() explicitly removes the fault env for every independent verification/recovery JVM.
        var observed = parsed(run("--output", "json", "content", "get", "ct_000004"));
        assertEquals(0, observed.path("warnings").size()); assertEquals("approved", observed.at("/data/review_status").asText());
        assertEquals(revision == 2 ? 4 : 3, observed.at("/data/tags").size());
        assertEquals(1, parsed(run("--output", "json", "content", "history", "ct_000004")).at("/data/items").size());
        var repeated = parsed(processScenario(null));
        assertEquals(2, repeated.path("exit_code").asInt()); assertEquals("REVIEW_NOT_PENDING", repeated.at("/error/code").asText());
        assertArrayEquals(committed, Files.readAllBytes(state.resolve("state.json")));
        assertEquals(code == 4 ? "partial" : code == 5 ? "unknown" : "verification_failed", result.path("status").asText());
    }

    @Test void realJarPartialThenIndependentTagRecoveryNeverReaudits() throws Exception {
        var partial = parsed(processScenario("tags-reject-before-write"));
        assertEquals(4, partial.path("exit_code").asInt());
        assertEquals(0, faultCounters(partial).path("tag_delegate_calls").asInt());
        var before = parsed(run("--output", "json", "content", "get", "ct_000004"));
        var history = parsed(run("--output", "json", "content", "history", "ct_000004"));
        assertEquals("approved", before.at("/data/review_status").asText()); assertEquals(3, before.at("/data/tags").size());
        var recovery = parsed(run("--output", "json", "--non-interactive", "content", "tags", "update", "ct_000004", "--add", "轻松", "--execute", "--yes"));
        assertEquals("succeeded", recovery.path("status").asText()); assertFalse(recovery.at("/data/steps").has("review"));
        assertEquals(0, recovery.path("warnings").size());
        var after = parsed(run("--output", "json", "content", "get", "ct_000004"));
        assertEquals(List.of("恋爱", "校园", "武侠", "轻松"), JsonSupport.create().convertValue(after.at("/data/tags"), List.class));
        assertEquals(history.path("data"), parsed(run("--output", "json", "content", "history", "ct_000004")).path("data"));
        assertEquals(2, JsonSupport.create().readTree(Files.readAllBytes(state.resolve("state.json"))).path("revision").asInt());
    }

    @Test void realJarInvalidScenarioAndApiFaultSettingsRejectWithoutStateOrFallback() throws Exception {
        var invalid = parsed(runScenario("invalid", "--output", "json", "content", "get", "ct_000004"));
        assertEquals(2, invalid.path("exit_code").asInt()); assertEquals("INVALID_MOCK_SCENARIO", invalid.at("/error/code").asText());
        var api = parsed(runScenario("tags-reject-before-write", "--env", "api", "--output", "json", "content", "get", "ct_000004"));
        assertEquals(2, api.path("exit_code").asInt()); assertEquals("MOCK_SCENARIO_NOT_ALLOWED", api.at("/error/code").asText());
        assertFalse(Files.exists(state));
    }

    @Test void differentContentsUpdatedBySeparateJvmsRetainBothChanges() throws Exception {
        var candidates = parsed(run("--output", "json", "content", "list", "--review-status", "pending")).at("/data/items");
        String first = candidates.get(0).path("content_id").asText(), second = candidates.get(1).path("content_id").asText();
        assertNotEquals(first, second);
        for (String id : List.of(first, second)) {
            assertEquals(0, parsed(run("--output", "json", "content", "review", id, "--action", "approve", "--execute", "--yes")).path("exit_code").asInt());
        }
        for (String id : List.of(first, second)) {
            assertEquals("approved", parsed(run("--output", "json", "content", "get", id)).at("/data/review_status").asText());
        }
        assertEquals(2, JsonSupport.create().readTree(Files.readAllBytes(state.resolve("state.json"))).path("revision").asInt());
    }

    private static boolean isWindows() { return System.getProperty("os.name").toLowerCase().contains("windows"); }
}
