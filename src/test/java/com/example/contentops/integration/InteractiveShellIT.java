package com.example.contentops.integration;

import com.example.contentops.infrastructure.JsonSupport;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledOnOs;
import org.junit.jupiter.api.condition.OS;
import org.junit.jupiter.api.io.TempDir;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import static org.junit.jupiter.api.Assertions.*;

class InteractiveShellIT {
    @TempDir Path directory;
    Path project, jar, state;
    int sequence;
    record Run(int exit, String stdout, String stderr) {
        List<JsonNode> json() {
            return stdout.lines().filter(s -> !s.isBlank()).map(s -> {
                try { return JsonSupport.create().readTree(s); }
                catch (Exception e) { throw new AssertionError(s, e); }
            }).toList();
        }
    }
    @BeforeEach void setup() {
        project = Path.of(System.getProperty("contentops.project"));
        jar = Path.of(System.getProperty("contentops.jar"));
        state = directory.resolve("state");
    }
    Run execute(List<String> args, String input) throws Exception {
        var builder = new ProcessBuilder(args).directory(project.toFile());
        builder.environment().put("CONTENTOPS_STATE_DIR", state.toString());
        for (String key : List.of("CONTENTOPS_MOCK_SCENARIO", "JAVA_TOOL_OPTIONS", "_JAVA_OPTIONS", "JDK_JAVA_OPTIONS")) {
            builder.environment().remove(key);
        }
        Path out = directory.resolve("out-" + sequence), err = directory.resolve("err-" + sequence++);
        builder.redirectOutput(out.toFile()).redirectError(err.toFile());
        var process = builder.start();
        try {
            try (var stream = process.getOutputStream()) { stream.write(input.getBytes(StandardCharsets.UTF_8)); }
            if (!process.waitFor(20, TimeUnit.SECONDS)) { process.destroyForcibly(); fail("test Shell process timed out"); }
            return new Run(process.exitValue(), Files.readString(out, StandardCharsets.UTF_8), Files.readString(err, StandardCharsets.UTF_8));
        } finally { if (process.isAlive()) { process.destroyForcibly(); } }
    }
    Run jar(String input, String... tail) throws Exception {
        String executable = System.getProperty("os.name").startsWith("Windows") ? "java.exe" : "java";
        var args = new ArrayList<>(List.of(Path.of(System.getProperty("java.home"), "bin", executable).toString(),
                "-Dfile.encoding=UTF-8", "-jar", jar.toString()));
        args.addAll(List.of(tail)); return execute(args, input);
    }

    @Test void noArgumentsEnterShellAndHelpFailureAndEofDoNotTerminateEarly() throws Exception {
        var result = jar("help content\ncontent get '未闭合\n--output json content list --review-status pending\n");
        assertEquals(0, result.exit()); assertTrue(result.stderr().contains("ContentOps CLI v1.1"));
        assertTrue(result.stderr().contains("引号未闭合")); assertTrue(result.stdout().contains("Usage:"));
        var last = result.stdout().lines().filter(s -> s.startsWith("{")).findFirst().orElseThrow();
        assertEquals(132, JsonSupport.create().readTree(last).at("/data/total").asInt());
        assertFalse(Files.exists(state.resolve("state.json")));
    }

    @Test void nThenBlankCancellationPreserveFullSnapshotAndFreshJvmState() throws Exception {
        var seeded = jar("", "--output", "json", "content", "tags", "update", "ct_000002", "--add", "悬疑", "--execute", "--yes");
        assertEquals(0, seeded.exit());
        byte[] before = Files.readAllBytes(state.resolve("state.json"));
        String command = "--output json content process ct_000004 --action approve --reason '本地 演示' --add 悬疑 --execute\n";
        var cancelled = jar(command + "N\n" + command + "\nexit\n");
        assertEquals(0, cancelled.exit()); assertEquals(2, cancelled.json().size());
        for (var result : cancelled.json()) {
            assertEquals("cancelled", result.path("status").asText()); assertEquals(7, result.path("exit_code").asInt());
            assertEquals("not_sent", result.at("/data/steps/review/write").asText());
        }
        assertArrayEquals(before, Files.readAllBytes(state.resolve("state.json")));
        var fresh = jar("", "--output", "json", "content", "get", "ct_000004");
        assertEquals("pending", fresh.json().get(0).at("/data/review_status").asText());
        var history = jar("", "--output", "json", "content", "history", "ct_000004");
        assertEquals(0, history.json().get(0).at("/data/items").size());
        assertArrayEquals(before, Files.readAllBytes(state.resolve("state.json")));
    }

    @Test void ySubmitsOnceAndNewJvmReadsExactChineseReasonAndTags() throws Exception {
        String reason = "本地 演示，不代表真实业务合规结论";
        var shell = jar("--output=json content process ct_000004 --action=approve --reason=\"" + reason + "\" --add=悬疑 --execute\ny\nexit\n");
        assertEquals(0, shell.exit()); assertEquals(1, shell.json().size());
        assertEquals("succeeded", shell.json().get(0).path("status").asText());
        assertEquals("matched", shell.json().get(0).at("/data/steps/tags/verification").asText());
        assertTrue(shell.stderr().contains("确认执行吗？(y/N):")); assertFalse(shell.stdout().contains("contentops>"));
        assertFalse(shell.stdout().contains("\ufffd"));
        var fresh = jar("", "--output", "json", "content", "get", "ct_000004");
        assertEquals(0, fresh.exit()); var detail = fresh.json().get(0).path("data");
        assertEquals("approved", detail.path("review_status").asText());
        assertEquals(List.of("恋爱", "校园", "武侠", "悬疑"), JsonSupport.create().convertValue(detail.path("tags"), List.class));
        var history = jar("", "--output", "json", "content", "history", "ct_000004");
        assertEquals(1, history.json().get(0).at("/data/items").size());
        assertEquals(reason, history.json().get(0).at("/data/items/0/reason").asText());
        assertEquals(2, JsonSupport.create().readTree(Files.readAllBytes(state.resolve("state.json"))).path("revision").asInt());
    }

    @Test void oneShotExecuteStillRejectsEvenWhenInputContainsYesAndVersionIsUnchanged() throws Exception {
        var rejected = jar("y\n", "--output", "json", "content", "review", "ct_000004", "--action", "approve", "--execute");
        assertEquals(2, rejected.exit()); assertEquals(2, rejected.json().get(0).path("exit_code").asInt());
        assertFalse(rejected.stderr().contains("确认执行吗")); assertFalse(Files.exists(state.resolve("state.json")));
        var version = jar("", "--version"); assertEquals(0, version.exit());
        assertEquals("contentops 0.1.0", version.stdout().strip()); assertFalse(version.stderr().contains("contentops>"));
    }

    @Test @EnabledOnOs(OS.WINDOWS)
    void existingCmdLauncherWithoutArgumentsEntersTheSameShell() throws Exception {
        var result = execute(List.of("cmd.exe", "/d", "/c", "scripts\\contentops.cmd"),
                "contentops --output json content get ct_000004\nquit\n");
        assertEquals(0, result.exit()); assertTrue(result.stderr().contains("contentops>"));
        assertEquals("ct_000004", result.json().get(0).path("content_id").asText());
        assertFalse(Files.exists(state.resolve("state.json")));
    }
}
