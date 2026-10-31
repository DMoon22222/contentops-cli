package com.example.contentops.cli;

import com.example.contentops.application.ContentService;
import com.example.contentops.gateway.GatewayFailure;
import com.example.contentops.infrastructure.JsonSupport;
import com.example.contentops.model.ContentModels.ReviewItem;
import com.example.contentops.support.RecordingGateway;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Stream;
import static org.junit.jupiter.api.Assertions.*;

class CliWriteTest {
    @TempDir Path directory;
    RecordingGateway gateway;
    record Run(int exit, String stdout, String stderr, int factoryCalls) { }
    @BeforeEach void setup() { gateway = new RecordingGateway(); }
    Run run(String... tail) {
        var out = new StringWriter(); var err = new StringWriter(); var factories = new AtomicInteger();
        var runner = new CliRunner(Map.of("CONTENTOPS_STATE_DIR", directory.resolve("state").toString()), new PrintWriter(out, true), new PrintWriter(err, true), JsonSupport.create(), config -> {
            factories.incrementAndGet(); return new ContentService(gateway);
        });
        int exit = runner.run(tail);
        return new Run(exit, out.toString(), err.toString(), factories.get());
    }
    JsonNode parsed(Run result) throws Exception {
        var json = JsonSupport.create().readTree(result.stdout());
        assertEquals(result.exit(), json.path("exit_code").asInt());
        assertEquals("1", json.path("schema_version").asText());
        return json;
    }
    String[] process(String... extra) {
        var args = new ArrayList<>(List.of("--env", "mock", "--output", "json", "--non-interactive", "content", "process", "fixture-content", "--action", "approve", "--add", "new"));
        args.addAll(List.of(extra)); return args.toArray(String[]::new);
    }
    @Test void jsonPreviewIsSingleObjectWithLowercaseStepsAndRealBeforeValues() throws Exception {
        Run run = run(process()); var result = parsed(run);
        assertEquals(0, run.exit()); assertEquals("previewed", result.path("status").asText());
        assertEquals("preview", result.path("mode").asText());
        assertEquals("content.process", result.path("command").asText());
        assertEquals("not_sent", result.at("/data/steps/review/write").asText());
        assertEquals("not_checked", result.at("/data/steps/tags/verification").asText());
        assertEquals("pending", result.at("/data/observed/review_status").asText());
        assertTrue(result.at("/data/plan/review/reason").isNull());
        assertFalse(result.at("/data/plan").has("kind")); assertFalse(result.at("/data/plan").has("before"));
        assertEquals(0, gateway.reviewCalls); assertEquals(0, gateway.tagCalls);
        assertTrue(run.stderr().contains("预览未执行"));
    }
    @Test void optionalReasonIsOmittedOnlyFromApiItemNotFromPlanOrEnvelope() throws Exception {
        var item = JsonSupport.create().valueToTree(new ReviewItem("fixture-content", "approve", null));
        assertFalse(item.has("reason"));
        assertTrue(parsed(run(process())).at("/data/plan/review").has("reason"));
    }
    @Test void authorizedJsonExecutionReportsBothAcknowledgementsAndActualTarget() throws Exception {
        Run run = run(process("--execute", "--yes")); var result = parsed(run);
        assertEquals(0, run.exit()); assertEquals("execute", result.path("mode").asText());
        assertEquals("succeeded", result.path("status").asText());
        assertEquals("acknowledged", result.at("/data/steps/review/write").asText());
        assertEquals("matched", result.at("/data/steps/tags/verification").asText());
        assertEquals("stored", result.at("/data/steps/tags/api_result/result").asText());
        assertEquals("approved", result.at("/data/observed/review_status").asText());
        assertEquals("", run.stderr());
    }
    static Stream<Arguments> unsupportedOrUnauthorized() {
        return Stream.of(new String[]{"--execute"}, new String[]{"--yes"}, new String[]{"--remove", "keep"},
                new String[]{"--set", "new"}, new String[]{"--force"}, new String[]{"--apply"}, new String[]{"--dry-run"},
                new String[]{"--action", "reject"}).map(args -> Arguments.of((Object) args));
    }
    @ParameterizedTest @MethodSource("unsupportedOrUnauthorized")
    void unsupportedOrMissingAuthorizationIsRejectedBeforeGatewayAndNeverReadsStdin(String[] extra) throws Exception {
        Run run = run(process(extra)); var result = parsed(run);
        assertEquals(2, run.exit()); assertEquals("rejected", result.path("status").asText());
        assertEquals(0, run.factoryCalls()); assertTrue(gateway.events.isEmpty());
        assertFalse(Files.exists(directory.resolve("state")));
    }
    @Test void repeatedAddsAreAcceptedWithoutCommaSplittingAndEmitWarning() throws Exception {
        Run run = run(process("--add", "new")); var result = parsed(run);
        assertEquals(0, run.exit()); assertEquals(1, result.path("warnings").size());
        assertEquals(2, result.at("/data/plan/tags/after").size());
    }
    @Test void badTagIsRejectedBeforePostingEvenWithExecutionAuthorization() throws Exception {
        var args = process("--execute", "--yes");
        for (int i = 0; i < args.length; i++) { if (args[i].equals("new")) { args[i] = "old"; } }
        Run run = run(args); var result = parsed(run);
        assertEquals(2, run.exit()); assertEquals("INACTIVE_TAG", result.at("/error/code").asText());
        assertEquals(0, gateway.reviewCalls); assertEquals(0, gateway.tagCalls);
    }
    @Test void partialJsonPreservesSuccessfulReviewAndActualOldTags() throws Exception {
        gateway.tagFailure = new GatewayFailure(GatewayFailure.Kind.REJECTED_NO_COMMIT, "CONTROLLED_REJECTION", "受控测试");
        Run run = run(process("--execute", "--yes")); var result = parsed(run);
        assertEquals(4, run.exit()); assertEquals("partial", result.path("status").asText());
        assertEquals("matched", result.at("/data/steps/review/verification").asText());
        assertEquals("failed", result.at("/data/steps/tags/write").asText());
        assertEquals(1, result.at("/data/observed/tags").size()); assertFalse(run.stderr().isBlank());
    }
    @Test void unknownJsonKeepsPriorSuccessAndExitFive() throws Exception {
        gateway.tagFailure = new GatewayFailure(GatewayFailure.Kind.WRITE_UNKNOWN, "CONTROLLED_UNKNOWN", "受控测试");
        Run run = run(process("--execute", "--yes")); var result = parsed(run);
        assertEquals(5, run.exit()); assertEquals("unknown", result.path("status").asText());
        assertEquals("acknowledged", result.at("/data/steps/review/write").asText());
        assertEquals("unknown", result.at("/data/steps/tags/write").asText()); assertEquals(1, gateway.tagCalls);
    }
    @Test void verificationJsonShowsAcknowledgementAndMismatchExitSix() throws Exception {
        gateway.applyTags = false;
        Run run = run(process("--execute", "--yes")); var result = parsed(run);
        assertEquals(6, run.exit()); assertEquals("verification_failed", result.path("status").asText());
        assertEquals("acknowledged", result.at("/data/steps/tags/write").asText());
        assertEquals("mismatched", result.at("/data/steps/tags/verification").asText());
    }
    @Test void partialTableStillIncludesProgressRatherThanOnlyError() {
        gateway.tagFailure = new GatewayFailure(GatewayFailure.Kind.REJECTED_NO_COMMIT, "CONTROLLED_REJECTION", "受控测试");
        Run run = run("content", "process", "fixture-content", "--action", "approve", "--add", "new", "--execute", "--yes");
        assertEquals(4, run.exit()); assertTrue(run.stdout().contains("review\tacknowledged\tmatched"));
        assertTrue(run.stdout().contains("tags\tfailed\tnot_checked")); assertTrue(run.stdout().contains("partial / 4"));
    }
    @Test void apiWritingStillRejectsWithoutGatewayOrFallback() throws Exception {
        Run run = run("--env", "api", "--output", "json", "content", "review", "fixture-content", "--action", "approve", "--execute", "--yes");
        assertEquals(2, run.exit()); assertEquals("api", parsed(run).path("environment").asText()); assertEquals(0, run.factoryCalls());
    }
}
