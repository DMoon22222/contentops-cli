package com.example.contentops.cli;

import com.example.contentops.application.ContentService;
import com.example.contentops.infrastructure.JsonSupport;
import com.example.contentops.infrastructure.mock.JsonMockGateway;
import com.example.contentops.infrastructure.mock.JsonStateStore;
import com.example.contentops.model.ContentModels.*;
import com.example.contentops.support.ForwardingGateway;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import java.io.BufferedReader;
import java.io.PrintWriter;
import java.io.StringReader;
import java.io.StringWriter;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;

class InteractiveShellTest {
    @TempDir Path directory;
    final AtomicInteger reviews = new AtomicInteger(), tags = new AtomicInteger(), factories = new AtomicInteger();
    static final String WRITE = "--output json content process ct_000004 --action approve --reason '本地 演示，不代表业务合规结论' --add 悬疑";
    record Session(int exit, String stdout, String stderr) {
        List<JsonNode> results() {
            return stdout.lines().filter(s -> !s.isBlank()).map(s -> {
                try { return JsonSupport.create().readTree(s); }
                catch (Exception e) { throw new AssertionError("Non-JSON stdout: " + s, e); }
            }).toList();
        }
    }
    Path stateFile() { return directory.resolve("state/state.json"); }
    JsonStateStore store() { return new JsonStateStore(directory.resolve("state"), JsonSupport.create()); }
    CliRunner runner(StringWriter out, StringWriter err) {
        var json = JsonSupport.create();
        return new CliRunner(Map.of("CONTENTOPS_STATE_DIR", directory.resolve("state").toString()),
                new PrintWriter(out, true), new PrintWriter(err, true), json, config -> {
                    factories.incrementAndGet();
                    var gateway = new ForwardingGateway(new JsonMockGateway(new JsonStateStore(config.stateDirectory(), json), json)) {
                        @Override public ReviewCounts submitReviews(List<ReviewItem> items) {
                            assertEquals(1, items.size()); reviews.incrementAndGet(); return super.submitReviews(items);
                        }
                        @Override public TagAck replaceTags(String id, List<String> complete) {
                            tags.incrementAndGet(); return super.replaceTags(id, complete);
                        }
                    };
                    return new ContentService(gateway);
                });
    }
    Session shell(String lines) {
        var out = new StringWriter(); var err = new StringWriter();
        int code = new InteractiveShell(new BufferedReader(new StringReader(lines)),
                new PrintWriter(err, true), runner(out, err)).run();
        return new Session(code, out.toString(), err.toString());
    }

    @ParameterizedTest @ValueSource(strings = {"exit\n", "quit\n", ""})
    void exitQuitAndEofEndNormallyWithoutOpeningBusinessState(String input) {
        var result = shell(input);
        assertEquals(0, result.exit()); assertEquals("", result.stdout());
        assertTrue(result.stderr().contains("ContentOps CLI v1.1"));
        assertTrue(result.stderr().contains("Environment: mock"));
        assertEquals(0, factories.get()); assertFalse(Files.exists(directory.resolve("state")));
    }

    @Test void helpUsesTheExistingTreeWithoutConstructingGateway() {
        var result = shell("help\nhelp content\ncontentops help content tags\nquit\n");
        assertEquals(0, result.exit()); assertTrue(result.stdout().contains("Usage:"));
        assertTrue(result.stdout().contains("process")); assertTrue(result.stdout().contains("update"));
        assertEquals(0, factories.get());
    }

    @Test void readsAndDefaultPreviewsReuseAllSevenCommands() {
        var result = shell("content list --review-status pending\ncontentops content get ct_000004\n"
                + "content history ct_000004\ntags list\ncontent review ct_000004 --action approve\n"
                + "content tags update ct_000004 --add 悬疑\n" + WRITE + "\nexit\n");
        assertEquals(0, result.exit()); assertTrue(result.stdout().contains("匹配 132 条"));
        assertTrue(result.stdout().contains("无人剧场")); assertTrue(result.stdout().contains("标签 23 个"));
        assertTrue(result.stdout().contains("本地 演示"));
        assertFalse(result.stderr().contains("确认执行吗"));
        assertEquals(7, factories.get()); assertEquals(0, reviews.get()); assertEquals(0, tags.get());
        assertFalse(Files.exists(stateFile()));
    }

    @ParameterizedTest @ValueSource(strings = {"N", "no", "", "anything"})
    void cancellationPreservesExistingSnapshotRevisionContentTagsAndHistory(String answer) throws Exception {
        store().update(data -> null); // Explicit fixture: materialize unchanged seed at revision 1.
        byte[] before = Files.readAllBytes(stateFile());
        var beforeData = store().read();
        var result = shell(WRITE + " --execute\n" + answer + "\nexit\n");
        var json = result.results().get(0);
        assertEquals(0, result.exit()); assertEquals(1, result.results().size());
        assertEquals("cancelled", json.path("status").asText()); assertEquals(7, json.path("exit_code").asInt());
        assertEquals("execute", json.path("mode").asText());
        assertEquals("not_sent", json.at("/data/steps/review/write").asText());
        assertEquals("not_sent", json.at("/data/steps/tags/write").asText());
        assertTrue(result.stderr().contains("确认执行吗？(y/N):"));
        assertTrue(result.stderr().contains("已取消，未执行任何写入。"));
        assertFalse(result.stdout().contains("contentops>")); assertFalse(result.stdout().contains("确认"));
        assertEquals(0, reviews.get()); assertEquals(0, tags.get());
        assertArrayEquals(before, Files.readAllBytes(stateFile())); assertEquals(beforeData, store().read());
        assertEquals(1, JsonSupport.create().readTree(Files.readAllBytes(stateFile())).path("revision").asInt());
    }

    @Test void eofAtConfirmationCancelsWithoutCreatingSnapshot() {
        var result = shell(WRITE + " --execute\n");
        assertEquals(0, result.exit()); assertEquals(7, result.results().get(0).path("exit_code").asInt());
        assertEquals(0, reviews.get()); assertEquals(0, tags.get()); assertFalse(Files.exists(stateFile()));
    }

    @ParameterizedTest @ValueSource(strings = {"y", "yes", "YES"})
    void confirmationSubmitsExactlyOneReviewAndTagWrite(String answer) {
        var result = shell(WRITE + " --execute\n" + answer + "\n--output json content history ct_000004\nexit\n");
        var rows = result.results();
        assertEquals("succeeded", rows.get(0).path("status").asText());
        assertEquals(1, rows.get(1).at("/data/items").size());
        assertEquals("本地 演示，不代表业务合规结论", rows.get(1).at("/data/items/0/reason").asText());
        assertEquals(1, reviews.get()); assertEquals(1, tags.get());
    }

    @Test void sharedReaderDoesNotLoseLaterCommandsAndExplicitYesDoesNotConsumeInput() {
        var result = shell(WRITE + " --execute\nN\n" + WRITE + " --execute --yes\n"
                + "--output json content get ct_000004\nexit\n");
        var rows = result.results(); assertEquals(3, rows.size());
        assertEquals("cancelled", rows.get(0).path("status").asText());
        assertEquals("succeeded", rows.get(1).path("status").asText());
        assertEquals("approved", rows.get(2).at("/data/review_status").asText());
        assertEquals(1, result.stderr().split("确认执行吗", -1).length - 1);
        assertEquals(1, reviews.get()); assertEquals(1, tags.get());
    }

    @Test void nonInteractiveRefusesMissingYesWithoutConsumingTheNextCommand() {
        var result = shell("--non-interactive " + WRITE + " --execute\n--output json content get ct_000004\nexit\n");
        var rows = result.results(); assertEquals(2, rows.size());
        assertEquals(2, rows.get(0).path("exit_code").asInt());
        assertEquals("pending", rows.get(1).at("/data/review_status").asText());
        assertFalse(result.stderr().contains("确认执行吗")); assertEquals(0, reviews.get());
    }

    @Test void nonInteractiveExplicitAuthorizationExecutesWithoutPrompt() {
        var result = shell("--non-interactive " + WRITE + " --execute --yes\nexit\n");
        assertEquals("succeeded", result.results().get(0).path("status").asText());
        assertFalse(result.stderr().contains("确认执行吗")); assertEquals(1, reviews.get());
    }

    @Test void yesWithoutExecuteIsRejectedAndNextCommandStillWorks() {
        var result = shell(WRITE + " --yes\n--output json tags list\nexit\n");
        var rows = result.results(); assertEquals(2, rows.get(0).path("exit_code").asInt());
        assertEquals(23, rows.get(1).at("/data/total").asInt()); assertEquals(0, reviews.get());
    }

    @Test void validationRunsBeforePromptAndEqualsSyntaxAndQuotesSurvive() {
        var result = shell("--output=json content process ct_000004 --action=reject --reason=\"中文 English 空格\" --add=不存在 --execute\n"
                + "--output=json content review ct_000004 --action=reject --reason=\"中文 English 空格\" --execute\ny\nexit\n");
        var rows = result.results(); assertEquals(2, rows.get(0).path("exit_code").asInt());
        assertEquals("succeeded", rows.get(1).path("status").asText());
        assertEquals(1, result.stderr().split("确认执行吗", -1).length - 1);
        assertEquals(1, reviews.get()); assertEquals(0, tags.get());
    }

    @Test void malformedAndFailedCommandsDoNotLeakOptionsToLaterCommands() {
        var result = shell("\ncontentops\ncontent get '未闭合\n"
                + "--env api --output json content get ct_000004\n"
                + "--output json content list --page abc\n"
                + "--output json content get ct_000004\nexit extra\nquit\n");
        assertEquals(0, result.exit()); var rows = result.results(); assertEquals(3, rows.size());
        assertEquals(2, rows.get(0).path("exit_code").asInt()); assertEquals("api", rows.get(0).path("environment").asText());
        assertEquals(2, rows.get(1).path("exit_code").asInt());
        assertEquals("mock", rows.get(2).path("environment").asText());
        assertEquals("ct_000004", rows.get(2).path("content_id").asText());
        assertTrue(result.stderr().contains("引号未闭合")); assertTrue(result.stderr().contains("空命令"));
        assertTrue(result.stderr().contains("不接收参数")); assertFalse(Files.exists(stateFile()));
    }

    @ParameterizedTest @ValueSource(strings = {"", "--execute", "--yes", "--execute --yes"})
    void oneShotAuthorizationMatrixIsUnchanged(String flags) throws Exception {
        var out = new StringWriter(); var err = new StringWriter();
        String[] args = CommandTokenizer.tokenize(WRITE + " " + flags);
        int code = runner(out, err).run(args);
        var result = JsonSupport.create().readTree(out.toString());
        assertEquals(code, result.path("exit_code").asInt()); assertFalse(err.toString().contains("确认执行吗"));
        int expected = flags.isEmpty() || "--execute --yes".equals(flags) ? 0 : 2;
        assertEquals(expected, code); assertEquals("--execute --yes".equals(flags) ? 1 : 0, reviews.get());
    }
}
