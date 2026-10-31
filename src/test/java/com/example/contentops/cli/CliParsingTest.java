package com.example.contentops.cli;

import com.example.contentops.application.ContentService;
import com.example.contentops.infrastructure.JsonSupport;
import com.example.contentops.infrastructure.mock.JsonMockGateway;
import com.example.contentops.infrastructure.mock.JsonStateStore;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Stream;
import static org.junit.jupiter.api.Assertions.*;

class CliParsingTest {
    @TempDir Path temporary;
    record Run(int exit, String stdout, String stderr, int factoryCalls) { }

    Run run(String... args) {
        var out = new StringWriter(); var err = new StringWriter();
        var factoryCalls = new AtomicInteger(); var json = JsonSupport.create();
        var runner = new CliRunner(Map.of("CONTENTOPS_STATE_DIR", temporary.resolve("state").toString()),
                new PrintWriter(out, true), new PrintWriter(err, true), json, config -> {
                    factoryCalls.incrementAndGet();
                    return new ContentService(new JsonMockGateway(new JsonStateStore(config.stateDirectory(), json), json));
                });
        int code = runner.run(args);
        return new Run(code, out.toString(), err.toString(), factoryCalls.get());
    }

    static Stream<Arguments> helpCommands() {
        return Stream.<String[]>of(new String[]{"--help"}, new String[]{"content", "--help"},
                new String[]{"content", "list", "--help"}, new String[]{"content", "get", "--help"},
                new String[]{"content", "history", "--help"}, new String[]{"tags", "--help"},
                new String[]{"tags", "list", "--help"}, new String[]{"content", "review", "--help"},
                new String[]{"content", "process", "--help"}, new String[]{"content", "tags", "--help"},
                new String[]{"content", "tags", "update", "--help"}).map(args -> Arguments.of((Object) args));
    }

    @ParameterizedTest @MethodSource("helpCommands")
    void helpNeverCreatesGatewayOrState(String[] args) {
        Run result = run(args);
        assertEquals(0, result.exit());
        assertTrue(result.stdout().contains("Usage:"));
        assertEquals(0, result.factoryCalls());
        assertFalse(Files.exists(temporary.resolve("state")));
    }

    static Stream<Arguments> invalidCommands() {
        return Stream.<String[]>of(new String[]{"content", "list", "--page", "0"},
                new String[]{"content", "list", "--page", "abc"},
                new String[]{"content", "list", "--review-status", "wrong"},
                new String[]{"content", "get"},
                new String[]{"content", "get", "ct_000004 ct_000005"},
                new String[]{"content", "get", "ct_000004\u00a0"},
                new String[]{"tags", "list", "--status", "deprecated"},
                new String[]{"content", "list", "--page", "1", "--page", "2"},
                new String[]{"content", "list", "--pa", "1"},
                new String[]{"content", "review", "ct_000004", "--action", "unsupported"},
                new String[]{"content", "process", "ct_000004", "--execute", "--yes"},
                new String[]{"content", "tags", "update", "ct_000004", "--remove", "轻松"}).map(args -> Arguments.of((Object) args));
    }

    @ParameterizedTest @MethodSource("invalidCommands")
    void invalidArgumentsProduceOneJsonAndExitTwo(String[] tail) throws Exception {
        String[] args = new String[tail.length + 2]; args[0] = "--output"; args[1] = "json";
        System.arraycopy(tail, 0, args, 2, tail.length);
        Run run = run(args);
        JsonNode result = JsonSupport.create().readTree(run.stdout());
        assertEquals(2, run.exit());
        assertEquals(2, result.get("exit_code").asInt());
        assertEquals("rejected", result.get("status").asText());
        assertTrue(result.get("data").isNull());
        assertFalse(run.stderr().contains("Exception"));
        assertFalse(Files.exists(temporary.resolve("state/state.json")));
    }

    @Test void parseFailureDoesNotInventModeOrId() throws Exception {
        Run run = run("--output", "json", "content", "list", "--page", "abc");
        var result = JsonSupport.create().readTree(run.stdout());
        assertEquals("content.list", result.get("command").asText());
        assertTrue(result.get("mode").isNull());
        assertTrue(result.get("content_id").isNull());
        assertEquals(0, run.factoryCalls());
    }

    @Test void apiIsRejectedBeforeGatewayConstruction() throws Exception {
        Run run = run("--env", "api", "--output", "json", "content", "get", "ct_000004");
        var result = JsonSupport.create().readTree(run.stdout());
        assertEquals(2, run.exit());
        assertEquals("api", result.get("environment").asText());
        assertEquals("API_ENV_NOT_IMPLEMENTED", result.at("/error/code").asText());
        assertEquals(0, run.factoryCalls());
        assertFalse(Files.exists(temporary.resolve("state")));
    }

    @Test void invalidEnvironmentIsNullNotPretendedMock() throws Exception {
        Run run = run("--env", "invalid", "--output", "json", "content", "get", "ct_000004");
        assertEquals(2, run.exit());
        assertTrue(JsonSupport.create().readTree(run.stdout()).get("environment").isNull());
    }

    @Test void readFailureIsExitThreeAndKeepsUpstreamNull() throws Exception {
        Run run = run("--output", "json", "content", "get", "ct_missing");
        var result = JsonSupport.create().readTree(run.stdout());
        assertEquals(3, run.exit());
        assertEquals("CONTENT_NOT_FOUND", result.at("/error/code").asText());
        assertTrue(result.at("/error/upstream").isNull());
    }

    @Test void successfulJsonHasFullEnvelopeAndNoExtraStdout() throws Exception {
        Run run = run("--output", "json", "content", "get", "ct_000004");
        var result = JsonSupport.create().readTree(run.stdout());
        assertEquals(0, run.exit());
        assertEquals("1", result.get("schema_version").asText());
        assertEquals("read", result.get("mode").asText());
        assertEquals("succeeded", result.get("status").asText());
        assertEquals("ct_000004", result.get("content_id").asText());
        assertTrue(result.get("error").isNull());
        assertTrue(result.get("warnings").isArray());
        assertEquals(12, result.get("data").size());
        assertEquals("", run.stderr());
    }

    @Test void tableIsReadableAndPreservesDetail() {
        Run run = run("content", "get", "ct_000004");
        assertEquals(0, run.exit());
        assertTrue(run.stdout().contains("无人剧场·第12话：逆流而上"));
        assertTrue(run.stdout().contains("赛琳娜"));
        assertTrue(run.stdout().contains("恋爱、校园、武侠"));
    }

    @Test void invalidOutputIsRejectedRatherThanSilentlyUsed() {
        Run run = run("--output", "yaml", "content", "get", "ct_000004");
        assertEquals(2, run.exit());
        assertTrue(run.stdout().contains("INVALID_OUTPUT"));
        assertEquals(0, run.factoryCalls());
    }

    @Test void parserDoesNotEchoPotentialCredentials() {
        Run run = run("--output", "json", "content", "list", "--unknown", "sensitive-placeholder-not-a-key");
        assertEquals(2, run.exit());
        assertFalse((run.stdout() + run.stderr()).contains("sensitive-placeholder-not-a-key"));
    }
}
