package com.example.contentops.cli;

import com.example.contentops.application.ContentService;
import com.example.contentops.infrastructure.JsonSupport;
import com.example.contentops.infrastructure.mock.*;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;

class CliFaultConfigTest {
    @TempDir Path directory;
    record Run(int exit, String stdout, String stderr, int factories) { }
    Run run(String scenario, String... args) {
        var out = new StringWriter(); var err = new StringWriter(); var factories = new AtomicInteger();
        var json = JsonSupport.create();
        var runner = new CliRunner(Map.of("CONTENTOPS_STATE_DIR", directory.resolve("state").toString(), "CONTENTOPS_MOCK_SCENARIO", scenario),
                new PrintWriter(out, true), new PrintWriter(err, true), json, config -> {
                    factories.incrementAndGet();
                    var actual = new JsonMockGateway(new JsonStateStore(config.stateDirectory(), json), json);
                    var faults = new FaultInjectingGateway(actual, config.mockScenario());
                    return new ContentService(faults, faults::diagnosticWarnings);
                });
        int code = runner.run(args);
        return new Run(code, out.toString(), err.toString(), factories.get());
    }
    JsonNode parsed(Run result) throws Exception {
        var json = JsonSupport.create().readTree(result.stdout()); assertEquals(result.exit(), json.path("exit_code").asInt()); return json;
    }
    boolean hasWarning(JsonNode result, String value) {
        for (var warning : result.path("warnings")) { if (warning.asText().contains(value)) { return true; } }
        return false;
    }
    @ParameterizedTest @EnumSource(value = MockScenario.class, mode = EnumSource.Mode.EXCLUDE, names = "NONE")
    void activeScenarioIsIdentifiedEvenOnReadAndPreviewWithoutInjecting(MockScenario scenario) throws Exception {
        var result = run(scenario.value(), "--output", "json", "content", "process", "ct_000004", "--action", "approve", "--add", "轻松");
        var json = parsed(result);
        assertEquals(0, result.exit()); assertEquals("previewed", json.path("status").asText());
        assertTrue(hasWarning(json, "MOCK_FAULT_ACTIVE scenario=" + scenario.value())); assertTrue(hasWarning(json, "MOCK_CALL_COUNTS"));
        assertTrue(result.stderr().contains("MOCK_FAULT_ACTIVE")); assertFalse(Files.exists(directory.resolve("state/state.json")));
    }
    @Test void markerIsStillPresentWhenParameterParsingOrAuthorizationStopsBeforeConstruction() throws Exception {
        for (String[] args : new String[][]{
                {"--output", "json", "content", "process", "ct_000004", "--action", "approve", "--add", "轻松", "--execute"},
                {"--output", "json", "content", "process", "ct_000004", "--unknown"}}) {
            var result = run("tags-reject-before-write", args);
            assertEquals(2, result.exit()); assertEquals(0, result.factories());
            assertTrue(hasWarning(parsed(result), "MOCK_FAULT_ACTIVE scenario=tags-reject-before-write"));
            assertFalse(hasWarning(parsed(result), "MOCK_CALL_COUNTS"), "No invented counters without a gateway");
        }
        assertFalse(Files.exists(directory.resolve("state")));
    }
    @Test void invalidScenarioOrApiCombinationIsRejectedBeforeGateway() throws Exception {
        var invalid = run("not-a-scene", "--output", "json", "content", "get", "ct_000004");
        assertEquals(2, invalid.exit()); assertEquals("INVALID_MOCK_SCENARIO", parsed(invalid).at("/error/code").asText()); assertEquals(0, invalid.factories());
        var api = run("tags-reject-before-write", "--env", "api", "--output", "json", "content", "get", "ct_000004");
        assertEquals(2, api.exit()); assertEquals("MOCK_SCENARIO_NOT_ALLOWED", parsed(api).at("/error/code").asText()); assertEquals(0, api.factories());
        assertEquals(0, parsed(api).path("warnings").size()); assertFalse(Files.exists(directory.resolve("state")));
    }
    @Test void helpSkipsEvenInvalidFaultConfigurationWithoutSideEffects() {
        var result = run("invalid", "content", "process", "--help");
        assertEquals(0, result.exit()); assertTrue(result.stdout().contains("Usage:")); assertEquals(0, result.factories());
        assertFalse(Files.exists(directory.resolve("state")));
    }
}
