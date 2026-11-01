package com.example.contentops.application;

import com.example.contentops.gateway.GatewayFailure;
import com.example.contentops.infrastructure.JsonSupport;
import com.example.contentops.infrastructure.mock.JsonMockGateway;
import com.example.contentops.infrastructure.mock.JsonStateStore;
import com.example.contentops.model.ContentModels.*;
import com.example.contentops.model.OperationModels.*;
import com.example.contentops.model.ResultModels.*;
import com.example.contentops.support.ForwardingGateway;
import com.example.contentops.support.ReliabilityEvidence;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import static org.junit.jupiter.api.Assertions.*;

/** Characterizes safety boundaries with real disk state; known races are not claimed fixed. */
class ReliabilityBoundaryTest {
    @TempDir Path temporary;
    Path state;
    JsonStateStore store;
    JsonMockGateway gateway;
    ContentService service;
    @BeforeEach void setup() {
        state = temporary.resolve("state");
        var json = JsonSupport.create(); store = new JsonStateStore(state, json);
        gateway = new JsonMockGateway(store, json); service = new ContentService(gateway);
    }
    WriteSpec spec(OperationKind kind, String tag) {
        return new WriteSpec(kind, "ct_000004", kind.includesReview() ? "approve" : null,
                kind.includesReview() ? "可靠性测试明确给定的演示决定" : null, kind.includesTags() ? List.of(tag) : List.of());
    }
    void result(ReliabilityEvidence evidence, String file, WriteResult value) throws Exception {
        evidence.write(file, com.example.contentops.model.ResultModels.result("mock", "test.application", "execute", "ct_000004",
                value.outcome(), value.data(), value.error(), value.warnings()));
    }
    @Test void staleTagPlanIsRejectedAfterAnotherActualCommit() throws Exception {
        var e = new ReliabilityEvidence("stale-tag-plan"); e.snapshot("before.json", state);
        var plan = service.plan(spec(OperationKind.TAGS, "悬疑")); e.write("plan.json", plan);
        result(e, "B-result.json", service.execute(service.plan(spec(OperationKind.TAGS, "轻松"))));
        byte[] committed = Files.readAllBytes(state.resolve("state.json"));
        var stopped = service.execute(plan); result(e, "A-result.json", stopped); e.snapshot("after.json", state);
        assertEquals(Outcome.REJECTED, stopped.outcome()); assertEquals("STATE_CHANGED", stopped.error().code());
        assertArrayEquals(committed, Files.readAllBytes(state.resolve("state.json")));
        assertEquals(WriteState.NOT_SENT, stopped.data().steps().get("tags").write());
    }
    @Test void staleReviewPlanIsRejectedAfterAnotherActualReview() throws Exception {
        var e = new ReliabilityEvidence("stale-review-plan"); e.snapshot("before.json", state);
        var plan = service.plan(spec(OperationKind.REVIEW, null));
        result(e, "B-result.json", service.execute(service.plan(spec(OperationKind.REVIEW, null))));
        byte[] committed = Files.readAllBytes(state.resolve("state.json"));
        var stopped = service.execute(plan); result(e, "A-result.json", stopped); e.snapshot("after.json", state);
        assertEquals(Outcome.REJECTED, stopped.outcome());
        assertEquals(1, gateway.getReviewLogs("ct_000004").size());
        assertArrayEquals(committed, Files.readAllBytes(state.resolve("state.json")));
    }
    @Test void processFinalMatchCannotDetectTagInsertedAfterReviewReadback() throws Exception {
        var e = new ReliabilityEvidence("process-tag-lost-update"); e.snapshot("before.json", state);
        var interleaved = new ForwardingGateway(gateway) {
            @Override public TagAck replaceTags(String id, List<String> tags) {
                try {
                    var b = service.execute(service.plan(spec(OperationKind.TAGS, "轻松")));
                    result(e, "B-result.json", b); e.snapshot("B-committed.json", state);
                } catch (Exception failure) { throw new IllegalStateException(failure); }
                return super.replaceTags(id, tags);
            }
        };
        var a = new ContentService(interleaved);
        var completed = a.execute(a.plan(spec(OperationKind.PROCESS, "悬疑")));
        result(e, "A-result.json", completed); var after = e.snapshot("after.json", state);
        assertEquals(Outcome.SUCCEEDED, completed.outcome(), "A's own target matches; this does not prove no lost update");
        assertEquals(VerificationState.MATCHED, completed.data().steps().get("tags").verification());
        assertEquals(List.of("恋爱", "校园", "武侠", "悬疑"), gateway.getContent("ct_000004").tags());
        assertEquals(3, after.path("revision").asInt()); assertEquals(1, gateway.getReviewLogs("ct_000004").size());
    }
    @Test void activeTagPolicyUsesPlanTimeLibraryNotAtomicSubmissionCondition() throws Exception {
        var e = new ReliabilityEvidence("tag-library-change"); e.snapshot("before.json", state);
        var plan = service.plan(spec(OperationKind.TAGS, "悬疑"));
        store.update(data -> {
            for (var tag : data.withArray("tags")) { if ("悬疑".equals(tag.path("tag").asText())) { ((ObjectNode) tag).put("status", "deprecated"); } }
            return null;
        });
        var completed = service.execute(plan); result(e, "result.json", completed); e.snapshot("after.json", state);
        e.write("library.json", gateway.listTags());
        assertEquals(Outcome.SUCCEEDED, completed.outcome());
        assertTrue(gateway.getContent("ct_000004").tags().contains("悬疑"));
        assertEquals("deprecated", gateway.listTags().stream().filter(t -> t.tag().equals("悬疑")).findFirst().orElseThrow().status());
    }
    @Test void writeLockTimeoutIsKnownNoCommitAndDoesNotInvokeMutation() throws Exception {
        var e = new ReliabilityEvidence("write-lock-timeout"); store.update(data -> null); e.snapshot("before.json", state);
        byte[] before = Files.readAllBytes(state.resolve("state.json")); var invoked = new AtomicBoolean();
        try (var channel = FileChannel.open(state.resolve("state.lock"), StandardOpenOption.WRITE); var lock = channel.lock()) {
            var error = assertThrows(GatewayFailure.class, () -> store.update(data -> { invoked.set(true); return null; }));
            e.write("error.json", Map.of("kind", error.kind(), "code", error.code(), "callback_invoked", invoked.get(), "lock_valid", lock.isValid()));
            assertEquals(GatewayFailure.Kind.REJECTED_NO_COMMIT, error.kind()); assertEquals("STATE_LOCK_TIMEOUT", error.code());
        }
        assertFalse(invoked.get()); assertArrayEquals(before, Files.readAllBytes(state.resolve("state.json"))); e.snapshot("after.json", state);
    }
    @Test void actualAtomicMoveFailureIsUnknownAndNeverReportsCommitSuccess() throws Exception {
        var e = new ReliabilityEvidence("atomic-move-target-obstruction"); store.update(data -> null); e.snapshot("before.json", state);
        byte[] before = Files.readAllBytes(state.resolve("state.json")); Path backup = state.resolve("preserved-fixture.json");
        var error = assertThrows(GatewayFailure.class, () -> store.update(data -> {
            data.put("_not_committed", true);
            try {
                // Deliberate test-only interference after load, before the real move.
                Files.move(state.resolve("state.json"), backup);
                Files.createDirectory(state.resolve("state.json"));
                Files.writeString(state.resolve("state.json/obstacle"), "controlled nonempty directory");
            } catch (java.io.IOException failure) { throw new IllegalStateException(failure); }
            return null;
        }));
        e.write("error.json", Map.of("kind", error.kind(), "code", error.code(), "cause", error.getCause().getClass().getName(),
                "fixture", "test replaced destination with a nonempty directory after snapshot load; not a power-loss test"));
        assertEquals(GatewayFailure.Kind.WRITE_UNKNOWN, error.kind()); assertEquals("STATE_COMMIT_UNKNOWN", error.code());
        assertArrayEquals(before, Files.readAllBytes(backup));
        try (var files = Files.list(state)) { assertTrue(files.noneMatch(p -> p.toString().endsWith(".tmp"))); }
        assertThrows(GatewayFailure.class, store::read);
    }
    @ParameterizedTest @ValueSource(strings = {"missing", "null", "not-array"})
    void malformedNestedTagsRefusePlanningWithoutResetOrCommit(String shape) throws Exception {
        var e = new ReliabilityEvidence("malformed-tags-" + shape);
        store.update(data -> {
            var content = (ObjectNode) data.withArray("contents").get(3);
            switch (shape) {
                case "missing" -> content.remove("tags");
                case "null" -> content.putNull("tags");
                default -> content.put("tags", 17);
            }
            return null;
        });
        byte[] invalid = Files.readAllBytes(state.resolve("state.json"));
        var error = assertThrows(GatewayFailure.class, () -> service.plan(spec(OperationKind.TAGS, "悬疑")));
        e.write("result.json", Map.of("kind", error.kind(), "code", error.code(), "shape", shape,
                "sha_before", ReliabilityEvidence.sha(invalid), "sha_after", ReliabilityEvidence.sha(Files.readAllBytes(state.resolve("state.json")))));
        assertEquals(GatewayFailure.Kind.READ_FAILURE, error.kind()); assertArrayEquals(invalid, Files.readAllBytes(state.resolve("state.json")));
    }
}
