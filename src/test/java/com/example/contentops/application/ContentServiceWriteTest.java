package com.example.contentops.application;

import com.example.contentops.gateway.GatewayFailure;
import com.example.contentops.model.ContentModels.*;
import com.example.contentops.model.OperationModels.*;
import com.example.contentops.model.ResultModels.*;
import com.example.contentops.support.RecordingGateway;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import java.util.List;
import java.util.stream.Stream;
import static org.junit.jupiter.api.Assertions.*;

class ContentServiceWriteTest {
    RecordingGateway gateway;
    ContentService service;
    @BeforeEach void setup() { gateway = new RecordingGateway(); service = new ContentService(gateway); }
    WriteSpec spec(OperationKind kind) { return new WriteSpec(kind, "fixture-content", kind.includesReview() ? "approve" : null, null, kind.includesTags() ? List.of("new") : List.of()); }
    WriteResult execute(OperationKind kind) { return service.execute(service.plan(spec(kind))); }
    StepResult step(WriteResult result, String name) { return result.data().steps().get(name); }
    void writes(int review, int tags) { assertEquals(review, gateway.reviewCalls); assertEquals(tags, gateway.tagCalls); }

    @Test void previewHasRealObservedAndNoWritesForEachOperationKind() {
        for (OperationKind kind : OperationKind.values()) {
            WriteResult result = service.preview(service.plan(spec(kind)));
            assertEquals(Outcome.PREVIEWED, result.outcome());
            assertEquals("pending", result.data().observed().reviewStatus());
            assertTrue(result.data().steps().values().stream().allMatch(s -> s.write() == WriteState.NOT_SENT && s.verification() == VerificationState.NOT_CHECKED));
        }
        writes(0, 0);
    }
    @Test void processUsesExactlyOneReviewItemAndTheDocumentedReadWriteOrder() {
        WriteResult result = execute(OperationKind.PROCESS);
        assertEquals(Outcome.SUCCEEDED, result.outcome());
        assertEquals(List.of("get", "library", "get", "review", "get", "put", "get"), gateway.events);
        assertEquals(List.of(new ReviewItem("fixture-content", "approve", null)), gateway.submitted);
        assertEquals(List.of("keep", "new"), gateway.replacement);
        assertEquals(WriteState.ACKNOWLEDGED, step(result, "review").write());
        assertEquals(VerificationState.MATCHED, step(result, "tags").verification());
        assertEquals("approved", result.data().observed().reviewStatus());
        assertEquals("limited", result.data().observed().qualityStatus());
        assertEquals("offline", result.data().observed().visibility());
        writes(1, 1);
    }
    @Test void standaloneApproveDoesNotReadLibraryOrWriteTags() {
        assertEquals(Outcome.SUCCEEDED, execute(OperationKind.REVIEW).outcome());
        assertEquals(List.of("get", "get", "review", "get"), gateway.events); writes(1, 0);
    }
    @Test void rejectRequiresReasonAndTrimsProvidedReason() {
        for (String reason : new String[]{null, "", " \t ", "\u00a0"}) {
            assertThrows(OperationRejected.class, () -> service.plan(new WriteSpec(OperationKind.REVIEW, "fixture-content", "reject", reason, List.of())));
        }
        var plan = service.plan(new WriteSpec(OperationKind.REVIEW, "fixture-content", "reject", "  人工理由  ", List.of()));
        assertEquals(Outcome.SUCCEEDED, service.execute(plan).outcome());
        assertEquals("人工理由", gateway.submitted.get(0).reason());
        assertEquals("rejected", gateway.current.reviewStatus()); writes(1, 0);
    }
    @Test void invalidTagsAreRejectedBeforeAnyReview() {
        for (String tag : List.of("missing", "old", " ")) {
            assertThrows(OperationRejected.class, () -> service.plan(new WriteSpec(OperationKind.PROCESS, "fixture-content", "approve", null, List.of(tag))));
        }
        writes(0, 0);
    }
    @Test void cliPolicyStopsRepeatedReviewsEvenThoughGatewayWouldAppend() {
        execute(OperationKind.REVIEW);
        var failure = assertThrows(OperationRejected.class, () -> service.plan(spec(OperationKind.REVIEW)));
        assertEquals("REVIEW_NOT_PENDING", failure.code()); writes(1, 0);
    }
    @Test void tagsMayBeAddedAfterReviewAndNoChangeSkipsPut() {
        gateway.current = RecordingGateway.detail("approved", List.of("keep", "new"));
        var result = execute(OperationKind.TAGS);
        assertEquals(Outcome.NO_CHANGE, result.outcome());
        assertEquals(WriteState.SKIPPED, step(result, "tags").write());
        assertEquals(VerificationState.MATCHED, step(result, "tags").verification()); writes(0, 0);
    }
    @Test void processStillReviewsWhenTagsAlreadyMatchAndSkipsOnlyTags() {
        gateway.current = RecordingGateway.detail("pending", List.of("new", "keep"));
        var result = execute(OperationKind.PROCESS);
        assertEquals(Outcome.SUCCEEDED, result.outcome());
        assertEquals(WriteState.SKIPPED, step(result, "tags").write()); writes(1, 0);
    }
    @Test void standaloneTagsPreserveDeprecatedUnknownAndOtherExistingTags() {
        gateway.current = RecordingGateway.detail("rejected", List.of("keep", "old", "mystery"));
        var result = execute(OperationKind.TAGS);
        assertEquals(Outcome.SUCCEEDED, result.outcome());
        assertEquals(List.of("keep", "old", "mystery", "new"), gateway.replacement);
        assertEquals(2, result.warnings().size()); writes(0, 1);
    }
    @Test void preflightStateChangeRejectsWithoutRecomputingTarget() {
        var plan = service.plan(spec(OperationKind.PROCESS));
        gateway.current = RecordingGateway.detail("pending", List.of("keep", "external"));
        var result = service.execute(plan);
        assertEquals(Outcome.REJECTED, result.outcome());
        assertEquals(List.of("keep", "new"), result.data().plan().tags().after());
        assertEquals(List.of("keep", "external"), result.data().observed().tags()); writes(0, 0);
    }
    @Test void changedReviewStatusBeforeSubmissionPreventsDuplicatePost() {
        var plan = service.plan(spec(OperationKind.REVIEW)); gateway.current = RecordingGateway.detail("approved", List.of("keep"));
        assertEquals(Outcome.REJECTED, service.execute(plan).outcome()); writes(0, 0);
    }
    @Test void beforeWriteReadFailureIsThreeWithStepsNotSent() {
        gateway.onRead = n -> { if (n == 2) { throw RecordingGateway.readFailure(); } return gateway.current; };
        var result = execute(OperationKind.PROCESS);
        assertEquals(Outcome.READ_FAILURE, result.outcome());
        assertEquals(WriteState.NOT_SENT, step(result, "review").write()); writes(0, 0);
    }
    @Test void definiteSingleReviewFailureStopsTagsAndDoesNotInventReason() {
        gateway.counts = new ReviewCounts(0, 1);
        var result = execute(OperationKind.PROCESS);
        assertEquals(Outcome.READ_FAILURE, result.outcome());
        assertEquals(WriteState.FAILED, step(result, "review").write());
        assertEquals(WriteState.NOT_SENT, step(result, "tags").write());
        assertNull(result.error().upstream()); assertEquals(2, gateway.gets); writes(1, 0);
    }
    static Stream<Arguments> unexplainedCounts() {
        return Stream.of(Arguments.of((Object) null), Arguments.of(new ReviewCounts(null, 0)), Arguments.of(new ReviewCounts(1, null)),
                Arguments.of(new ReviewCounts(2, 0)), Arguments.of(new ReviewCounts(0, 0)), Arguments.of(new ReviewCounts(-1, 2)), Arguments.of(new ReviewCounts(1, 1)));
    }
    @ParameterizedTest @MethodSource("unexplainedCounts")
    void unexplainedReviewCountsAreUnknownWithoutRetriesOrFakedObserved(ReviewCounts counts) {
        gateway.counts = counts;
        var result = execute(OperationKind.PROCESS);
        assertEquals(Outcome.UNKNOWN, result.outcome());
        assertEquals(WriteState.UNKNOWN, step(result, "review").write());
        assertEquals("pending", result.data().observed().reviewStatus());
        assertEquals(2, gateway.gets); writes(1, 0);
    }
    @Test void reviewAcknowledgedButReadMismatchIsSixAndStopsTags() {
        gateway.applyReview = false;
        var result = execute(OperationKind.PROCESS);
        assertEquals(Outcome.VERIFICATION_FAILED, result.outcome());
        assertEquals(WriteState.ACKNOWLEDGED, step(result, "review").write());
        assertEquals(VerificationState.MISMATCHED, step(result, "review").verification()); writes(1, 0);
    }
    @Test void reviewAcknowledgedButReadUnavailablePreservesPreviousObserved() {
        gateway.onRead = n -> { if (n == 3) { throw RecordingGateway.readFailure(); } return gateway.current; };
        var result = execute(OperationKind.PROCESS);
        assertEquals(Outcome.VERIFICATION_FAILED, result.outcome());
        assertEquals(VerificationState.UNAVAILABLE, step(result, "review").verification());
        assertEquals("pending", result.data().observed().reviewStatus()); writes(1, 0);
    }
    @Test void tagsChangedAfterVerifiedReviewReturnsPartialAndNoPut() {
        gateway.onRead = n -> n == 3 ? RecordingGateway.detail("approved", List.of("external")) : gateway.current;
        var result = execute(OperationKind.PROCESS);
        assertEquals(Outcome.PARTIAL, result.outcome());
        assertEquals(VerificationState.MATCHED, step(result, "review").verification());
        assertEquals(WriteState.NOT_SENT, step(result, "tags").write()); writes(1, 0);
    }
    @Test void definiteTagFailurePreservesVerifiedReviewAndReportsPartial() {
        gateway.tagFailure = new GatewayFailure(GatewayFailure.Kind.REJECTED_NO_COMMIT, "CONTROLLED_TAG_REJECTION", "受控单元测试标签拒绝");
        var result = execute(OperationKind.PROCESS);
        assertEquals(Outcome.PARTIAL, result.outcome());
        assertEquals(WriteState.ACKNOWLEDGED, step(result, "review").write());
        assertEquals(VerificationState.MATCHED, step(result, "review").verification());
        assertEquals(WriteState.FAILED, step(result, "tags").write());
        assertEquals(List.of("keep"), result.data().observed().tags()); writes(1, 1);
    }
    @Test void standaloneDefiniteTagFailureIsThree() {
        gateway.tagFailure = new GatewayFailure(GatewayFailure.Kind.REJECTED_NO_COMMIT, "CONTROLLED_TAG_REJECTION", "测试");
        assertEquals(Outcome.READ_FAILURE, execute(OperationKind.TAGS).outcome()); writes(0, 1);
    }
    @Test void unknownReviewNeverRetriesOrAdvancesToTags() {
        gateway.reviewFailure = new GatewayFailure(GatewayFailure.Kind.WRITE_UNKNOWN, "CONTROLLED_LOST_RESPONSE", "受控单元测试未知");
        var result = execute(OperationKind.PROCESS);
        assertEquals(Outcome.UNKNOWN, result.outcome());
        assertEquals(WriteState.UNKNOWN, step(result, "review").write()); assertEquals(2, gateway.gets); writes(1, 0);
    }
    @Test void unknownTagsRetainReviewSuccessAndDoNotReadTargetAndClaimSuccess() {
        gateway.tagFailure = new GatewayFailure(GatewayFailure.Kind.WRITE_UNKNOWN, "CONTROLLED_LOST_RESPONSE", "测试");
        var result = execute(OperationKind.PROCESS);
        assertEquals(Outcome.UNKNOWN, result.outcome());
        assertEquals(VerificationState.MATCHED, step(result, "review").verification());
        assertEquals(WriteState.UNKNOWN, step(result, "tags").write()); assertEquals(3, gateway.gets); writes(1, 1);
    }
    @Test void missingTagResultIsUnknownAndNeverAssumedOk() {
        gateway.tagAck = new TagAck(null);
        var result = execute(OperationKind.TAGS);
        assertEquals(Outcome.UNKNOWN, result.outcome());
        assertEquals(List.of("keep"), result.data().observed().tags()); writes(0, 1);
    }
    @Test void acknowledgedTagsMismatchIsSixWithoutRepeatingPut() {
        gateway.applyTags = false;
        var result = execute(OperationKind.PROCESS);
        assertEquals(Outcome.VERIFICATION_FAILED, result.outcome());
        assertEquals(WriteState.ACKNOWLEDGED, step(result, "tags").write());
        assertEquals(VerificationState.MISMATCHED, step(result, "tags").verification()); writes(1, 1);
    }
    @Test void finalReadChecksReviewAsWellAsTags() {
        gateway.onRead = n -> n == 4 ? RecordingGateway.detail("rejected", List.of("keep", "new")) : gateway.current;
        var result = execute(OperationKind.PROCESS);
        assertEquals(Outcome.VERIFICATION_FAILED, result.outcome());
        assertEquals(VerificationState.MISMATCHED, step(result, "review").verification());
        assertEquals(VerificationState.MATCHED, step(result, "tags").verification()); writes(1, 1);
    }
    @Test void finalReadUnavailableIsSixAndDoesNotSubstitutePlannedTags() {
        gateway.onRead = n -> { if (n == 4) { throw RecordingGateway.readFailure(); } return gateway.current; };
        var result = execute(OperationKind.PROCESS);
        assertEquals(Outcome.VERIFICATION_FAILED, result.outcome());
        assertEquals(VerificationState.UNAVAILABLE, step(result, "tags").verification());
        assertEquals(List.of("keep"), result.data().observed().tags()); writes(1, 1);
    }
    @Test void unexpectedWriteExceptionsStillPreserveUnknownAndPreviousSuccess() {
        gateway.tagFailure = new IllegalStateException("controlled unexpected test exception");
        var result = execute(OperationKind.PROCESS);
        assertEquals(Outcome.UNKNOWN, result.outcome());
        assertEquals(VerificationState.MATCHED, step(result, "review").verification()); writes(1, 1);
    }
    @Test void wrongReturnedIdIsRejectedAsReadFailureBeforeWriting() {
        var wrong = gateway.current;
        gateway.onRead = n -> new ContentDetail("another-id", wrong.title(), wrong.creatorId(), wrong.reviewStatus(), wrong.qualityStatus(), wrong.visibility(),
                wrong.tags(), wrong.createdAt(), wrong.body(), wrong.source(), wrong.channels(), wrong.categoryId());
        assertThrows(GatewayFailure.class, () -> service.plan(spec(OperationKind.REVIEW))); writes(0, 0);
    }
}
