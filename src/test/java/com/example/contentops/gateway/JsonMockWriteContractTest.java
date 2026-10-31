package com.example.contentops.gateway;

import com.example.contentops.infrastructure.JsonSupport;
import com.example.contentops.infrastructure.mock.JsonMockGateway;
import com.example.contentops.infrastructure.mock.JsonStateStore;
import com.example.contentops.model.ContentModels.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class JsonMockWriteContractTest {
    @TempDir Path directory;
    ObjectMapper json;
    JsonStateStore store;
    ContentGateway gateway;
    Instant now = Instant.parse("2026-10-31T08:00:00Z");
    @BeforeEach void setup() {
        json = JsonSupport.create(); store = new JsonStateStore(directory, json);
        gateway = new JsonMockGateway(store, json, Clock.fixed(now, ZoneOffset.UTC));
    }
    long revision() throws Exception { return json.readTree(Files.readAllBytes(directory.resolve("state.json"))).get("revision").asLong(); }

    @Test void reviewPersistsStatusAndOneCompleteLogTogetherAndPreservesOtherFields() throws Exception {
        var before = store.read(); var detail = gateway.getContent("ct_000004");
        assertEquals(new ReviewCounts(1, 0), gateway.submitReviews(List.of(new ReviewItem("ct_000004", "approve", "人工决定"))));
        assertEquals("approved", gateway.getContent("ct_000004").reviewStatus());
        var logs = gateway.getReviewLogs("ct_000004");
        assertEquals(List.of(new ReviewLog("approve", "op_mock_cli", "人工决定", now)), logs);
        assertEquals(1, revision());
        var after = store.read();
        ((ObjectNode) after.get("contents").get(3)).put("review_status", detail.reviewStatus());
        ((ObjectNode) after.get("review_logs")).remove("ct_000004");
        assertEquals(before, after, "No aggregation, quality, visibility, tags or unrelated history may change");
    }

    @Test void gatewayDoesNotEnforcePendingOrRejectReasonAndNeverDeduplicates() throws Exception {
        gateway.submitReviews(List.of(new ReviewItem("ct_000004", "approve", null)));
        assertEquals(new ReviewCounts(1, 0), gateway.submitReviews(List.of(new ReviewItem("ct_000004", "reject", null))));
        assertEquals("rejected", gateway.getContent("ct_000004").reviewStatus());
        assertEquals(2, gateway.getReviewLogs("ct_000004").size());
        assertEquals("", gateway.getReviewLogs("ct_000004").get(1).reason());
        assertEquals(2, revision());
    }

    @Test void exactlyTwentyItemsIncludingRepeatedIdsProduceTwentyLogsInOneCommit() throws Exception {
        assertEquals(new ReviewCounts(20, 0), gateway.submitReviews(Collections.nCopies(20, new ReviewItem("ct_000004", "approve", null))));
        assertEquals(20, gateway.getReviewLogs("ct_000004").size());
        assertEquals(1, revision());
    }

    @Test void mixedBatchCountsOnlyValidExistingItemsAndCommitsOnce() throws Exception {
        var result = gateway.submitReviews(Arrays.asList(new ReviewItem("ct_000004", "reject", ""),
                new ReviewItem("missing", "approve", null), new ReviewItem("ct_000003", "invalid", null), null));
        assertEquals(new ReviewCounts(1, 3), result);
        assertEquals("rejected", gateway.getContent("ct_000004").reviewStatus());
        assertEquals(1, revision());
    }

    @Test void allFailedOrEmptyBatchesNeverCreateOrRewriteSnapshot() throws Exception {
        assertEquals(new ReviewCounts(0, 0), gateway.submitReviews(List.of()));
        assertEquals(new ReviewCounts(0, 1), gateway.submitReviews(List.of(new ReviewItem("missing", "approve", null))));
        assertFalse(Files.exists(directory.resolve("state.json")));
        gateway.replaceTags("ct_000004", List.of("fixture"));
        byte[] before = Files.readAllBytes(directory.resolve("state.json"));
        gateway.submitReviews(List.of(new ReviewItem("missing", "reject", null)));
        assertArrayEquals(before, Files.readAllBytes(directory.resolve("state.json")));
    }

    @Test void tagsAreAFullReplacementWithoutLibraryPolicyOrReviewSideEffects() throws Exception {
        var before = store.read();
        assertEquals(new TagAck("ok"), gateway.replaceTags("ct_000004", List.of("未知的测试标签")));
        assertEquals(List.of("未知的测试标签"), gateway.getContent("ct_000004").tags());
        assertEquals("pending", gateway.getContent("ct_000004").reviewStatus());
        assertTrue(gateway.getReviewLogs("ct_000004").isEmpty());
        var after = store.read();
        ((ObjectNode) after.get("contents").get(3)).set("tags", before.get("contents").get(3).get("tags"));
        assertEquals(before, after);
        gateway.replaceTags("ct_000004", List.of());
        assertTrue(gateway.getContent("ct_000004").tags().isEmpty());
        assertEquals(2, revision());
    }

    @Test void missingContentTagWriteIsKnownNotCommitted() {
        var failure = assertThrows(GatewayFailure.class, () -> gateway.replaceTags("missing", List.of("any")));
        assertEquals(GatewayFailure.Kind.REJECTED_NO_COMMIT, failure.kind());
        assertFalse(Files.exists(directory.resolve("state.json")));
    }
}
