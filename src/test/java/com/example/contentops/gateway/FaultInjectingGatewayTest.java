package com.example.contentops.gateway;

import com.example.contentops.application.ContentService;
import com.example.contentops.application.OperationRejected;
import com.example.contentops.infrastructure.JsonSupport;
import com.example.contentops.infrastructure.mock.*;
import com.example.contentops.model.ContentModels.*;
import com.example.contentops.model.OperationModels.*;
import com.example.contentops.model.ResultModels.*;
import com.example.contentops.support.RecordingGateway;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class FaultInjectingGatewayTest {
    @TempDir Path directory;
    JsonStateStore store;
    JsonMockGateway actual;
    List<String> original = List.of("恋爱", "校园", "武侠");
    List<String> target = List.of("恋爱", "校园", "武侠", "轻松");
    @BeforeEach void setup() {
        var json = JsonSupport.create(); store = new JsonStateStore(directory, json); actual = new JsonMockGateway(store, json);
    }
    FaultInjectingGateway fault(MockScenario scenario) { return new FaultInjectingGateway(actual, scenario); }
    long revision() throws Exception { return JsonSupport.create().readTree(Files.readAllBytes(directory.resolve("state.json"))).path("revision").asLong(); }

    @Test void inactiveWrapperHasNoFaultsNoWarningsAndSameDelegateResults() throws Exception {
        var gateway = fault(MockScenario.NONE);
        assertEquals(actual.getContent("ct_000004"), gateway.getContent("ct_000004"));
        assertEquals(actual.listContents(new ContentQuery(null, "pending", 1)), gateway.listContents(new ContentQuery(null, "pending", 1)));
        assertEquals(actual.listTags(), gateway.listTags()); assertEquals(actual.getReviewLogs("ct_000003"), gateway.getReviewLogs("ct_000003"));
        assertEquals(new ReviewCounts(1, 0), gateway.submitReviews(List.of(new ReviewItem("ct_000004", "approve", "人工测试决定"))));
        gateway.replaceTags("ct_000004", target);
        assertEquals(target, gateway.getContent("ct_000004").tags());
        assertTrue(gateway.diagnosticWarnings().isEmpty()); assertEquals(0, gateway.calls().injectedReadbacks()); assertEquals(2, revision());
    }

    @Test void tagRejectionIsBeforeDelegateButReviewIsActuallyCommitted() throws Exception {
        var gateway = fault(MockScenario.TAGS_REJECT_BEFORE_WRITE);
        gateway.submitReviews(List.of(new ReviewItem("ct_000004", "approve", "人工测试决定")));
        assertEquals("approved", gateway.getContent("ct_000004").reviewStatus());
        var failure = assertThrows(GatewayFailure.class, () -> gateway.replaceTags("ct_000004", target));
        assertEquals(GatewayFailure.Kind.REJECTED_NO_COMMIT, failure.kind());
        assertEquals(1, gateway.calls().reviewDelegateCalls()); assertEquals(1, gateway.calls().tagAttempts()); assertEquals(0, gateway.calls().tagDelegateCalls());
        assertEquals(original, actual.getContent("ct_000004").tags()); assertEquals(1, actual.getReviewLogs("ct_000004").size()); assertEquals(1, revision());
    }

    @ParameterizedTest @EnumSource(value = MockScenario.class, names = {"REVIEW_COMMIT_RESPONSE_LOST", "TAGS_COMMIT_RESPONSE_LOST"})
    void lostResponseOccursAfterRealSnapshotCommit(MockScenario scenario) throws Exception {
        var gateway = fault(scenario);
        GatewayFailure failure;
        if (scenario == MockScenario.REVIEW_COMMIT_RESPONSE_LOST) {
            failure = assertThrows(GatewayFailure.class, () -> gateway.submitReviews(List.of(new ReviewItem("ct_000004", "approve", null))));
        } else {
            gateway.submitReviews(List.of(new ReviewItem("ct_000004", "approve", null)));
            failure = assertThrows(GatewayFailure.class, () -> gateway.replaceTags("ct_000004", target));
        }
        assertEquals(GatewayFailure.Kind.WRITE_UNKNOWN, failure.kind());
        var fresh = new JsonMockGateway(new JsonStateStore(directory, JsonSupport.create()), JsonSupport.create());
        assertEquals("approved", fresh.getContent("ct_000004").reviewStatus()); assertEquals(1, fresh.getReviewLogs("ct_000004").size());
        assertEquals(scenario == MockScenario.REVIEW_COMMIT_RESPONSE_LOST ? original : target, fresh.getContent("ct_000004").tags());
        assertEquals(scenario == MockScenario.REVIEW_COMMIT_RESPONSE_LOST ? 1 : 2, revision());
        assertEquals(1, gateway.calls().reviewDelegateCalls()); assertEquals(scenario == MockScenario.REVIEW_COMMIT_RESPONSE_LOST ? 0 : 1, gateway.calls().tagDelegateCalls());
    }

    @Test void reviewReadbackArmsOnWriteNotReadCountAndOnlyAffectsOneMatchingId() throws Exception {
        var gateway = fault(MockScenario.REVIEW_READBACK_MISMATCH);
        for (int i = 0; i < 7; i++) { assertEquals("pending", gateway.getContent("ct_000004").reviewStatus()); }
        gateway.submitReviews(List.of(new ReviewItem("ct_000004", "approve", null)));
        assertEquals(actual.getContent("ct_000003"), gateway.getContent("ct_000003"));
        assertEquals("pending", gateway.getContent("ct_000004").reviewStatus());
        assertEquals("approved", gateway.getContent("ct_000004").reviewStatus());
        assertEquals("approved", actual.getContent("ct_000004").reviewStatus());
        assertEquals(1, gateway.calls().injectedReadbacks()); assertEquals(1, revision());
    }

    @Test void tagReadbackOnlyReplacesReturnedTagsOnceAndNeverRewritesDisk() throws Exception {
        var gateway = fault(MockScenario.TAGS_READBACK_MISMATCH);
        for (int i = 0; i < 5; i++) { assertEquals(original, gateway.getContent("ct_000004").tags()); }
        gateway.submitReviews(List.of(new ReviewItem("ct_000004", "approve", null)));
        assertEquals("approved", gateway.getContent("ct_000004").reviewStatus());
        gateway.replaceTags("ct_000004", target);
        byte[] committed = Files.readAllBytes(directory.resolve("state.json"));
        var stale = gateway.getContent("ct_000004");
        assertEquals("approved", stale.reviewStatus()); assertEquals(original, stale.tags());
        assertEquals(target, gateway.getContent("ct_000004").tags());
        assertArrayEquals(committed, Files.readAllBytes(directory.resolve("state.json")));
        assertEquals(1, gateway.calls().injectedReadbacks()); assertEquals(2, revision());
    }

    @Test void unsuccessfulDelegateResponseNeverArmsAReadbackOrClaimsCommittedLoss() {
        var recording = new RecordingGateway(); recording.counts = new ReviewCounts(0, 1);
        var gateway = new FaultInjectingGateway(recording, MockScenario.REVIEW_READBACK_MISMATCH);
        assertEquals(new ReviewCounts(0, 1), gateway.submitReviews(List.of(new ReviewItem("fixture-content", "approve", null))));
        assertEquals("pending", gateway.getContent("fixture-content").reviewStatus()); assertEquals(0, gateway.calls().injectedReadbacks());
        recording.reviewFailure = new GatewayFailure(GatewayFailure.Kind.REJECTED_NO_COMMIT, "CONTROLLED_REJECT", "受控单元测试拒绝");
        var lost = new FaultInjectingGateway(recording, MockScenario.REVIEW_COMMIT_RESPONSE_LOST);
        assertSame(recording.reviewFailure, assertThrows(GatewayFailure.class, () -> lost.submitReviews(List.of(new ReviewItem("fixture-content", "approve", null)))));
    }

    @ParameterizedTest @EnumSource(value = MockScenario.class, mode = EnumSource.Mode.EXCLUDE, names = "NONE")
    void previewsNeverArmOrCommitAnyScenario(MockScenario scenario) {
        var gateway = fault(scenario); var service = new ContentService(gateway);
        var plan = service.plan(new WriteSpec(OperationKind.PROCESS, "ct_000004", "approve", "人工测试决定", List.of("轻松")));
        assertEquals(Outcome.PREVIEWED, service.preview(plan).outcome());
        assertEquals(0, gateway.calls().reviewAttempts()); assertEquals(0, gateway.calls().tagAttempts()); assertEquals(0, gateway.calls().injectedReadbacks());
        assertFalse(Files.exists(directory.resolve("state.json")));
    }

    @ParameterizedTest @EnumSource(value = MockScenario.class, mode = EnumSource.Mode.EXCLUDE, names = "NONE")
    void applicationPreservesPhaseFactsActualObservedAndExactCalls(MockScenario scenario) throws Exception {
        var gateway = fault(scenario); var service = new ContentService(gateway);
        var result = service.execute(service.plan(new WriteSpec(OperationKind.PROCESS, "ct_000004", "approve", "人工测试决定", List.of("轻松"))));
        var review = result.data().steps().get("review"); var tags = result.data().steps().get("tags");
        Outcome expected = switch (scenario) {
            case TAGS_REJECT_BEFORE_WRITE -> Outcome.PARTIAL;
            case REVIEW_COMMIT_RESPONSE_LOST, TAGS_COMMIT_RESPONSE_LOST -> Outcome.UNKNOWN;
            default -> Outcome.VERIFICATION_FAILED;
        };
        assertEquals(expected, result.outcome());
        assertEquals(scenario == MockScenario.REVIEW_COMMIT_RESPONSE_LOST ? WriteState.UNKNOWN : WriteState.ACKNOWLEDGED, review.write());
        assertEquals(scenario == MockScenario.REVIEW_COMMIT_RESPONSE_LOST || scenario == MockScenario.REVIEW_READBACK_MISMATCH ? WriteState.NOT_SENT
                : scenario == MockScenario.TAGS_REJECT_BEFORE_WRITE ? WriteState.FAILED
                : scenario == MockScenario.TAGS_COMMIT_RESPONSE_LOST ? WriteState.UNKNOWN : WriteState.ACKNOWLEDGED, tags.write());
        assertEquals(scenario == MockScenario.REVIEW_COMMIT_RESPONSE_LOST ? VerificationState.NOT_CHECKED
                : scenario == MockScenario.REVIEW_READBACK_MISMATCH ? VerificationState.MISMATCHED : VerificationState.MATCHED, review.verification());
        assertEquals(scenario == MockScenario.TAGS_READBACK_MISMATCH ? VerificationState.MISMATCHED : VerificationState.NOT_CHECKED, tags.verification());
        assertEquals(original, result.data().observed().tags(), "No branch may substitute the planned tag target as observed");
        assertEquals(scenario == MockScenario.REVIEW_COMMIT_RESPONSE_LOST || scenario == MockScenario.REVIEW_READBACK_MISMATCH ? "pending" : "approved", result.data().observed().reviewStatus());
        assertEquals("approved", actual.getContent("ct_000004").reviewStatus()); assertEquals(1, actual.getReviewLogs("ct_000004").size());
        boolean tagsWritten = scenario == MockScenario.TAGS_COMMIT_RESPONSE_LOST || scenario == MockScenario.TAGS_READBACK_MISMATCH;
        assertEquals(tagsWritten ? target : original, actual.getContent("ct_000004").tags()); assertEquals(tagsWritten ? 2 : 1, revision());
        assertEquals(1, gateway.calls().reviewAttempts()); assertEquals(1, gateway.calls().reviewDelegateCalls());
        assertEquals(scenario == MockScenario.REVIEW_COMMIT_RESPONSE_LOST || scenario == MockScenario.REVIEW_READBACK_MISMATCH ? 0 : 1, gateway.calls().tagAttempts());
        assertEquals(tagsWritten ? 1 : 0, gateway.calls().tagDelegateCalls());
        var beforeRepeat = gateway.calls();
        assertThrows(OperationRejected.class, () -> service.plan(new WriteSpec(OperationKind.PROCESS, "ct_000004", "approve", "人工测试决定", List.of("轻松"))));
        assertEquals(beforeRepeat.reviewAttempts(), gateway.calls().reviewAttempts());
        assertEquals(beforeRepeat.tagAttempts(), gateway.calls().tagAttempts());
        assertEquals(expected, result.outcome(), "A later read or rejected plan cannot promote the original outcome");
    }
}
