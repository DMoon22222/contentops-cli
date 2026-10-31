package com.example.contentops.gateway;

import com.example.contentops.application.ContentService;
import com.example.contentops.infrastructure.JsonSupport;
import com.example.contentops.infrastructure.mock.JsonMockGateway;
import com.example.contentops.infrastructure.mock.JsonStateStore;
import com.example.contentops.model.ContentModels.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class JsonMockGatewayContractTest {
    @TempDir Path directory;
    ObjectMapper json;
    JsonStateStore store;
    ContentGateway gateway;

    @BeforeEach void setup() {
        json = JsonSupport.create();
        store = new JsonStateStore(directory, json);
        gateway = new JsonMockGateway(store, json);
    }

    @Test void realSeedCountsAndFixedPagination() {
        assertEquals(300, gateway.listContents(new ContentQuery(null, null, 1)).total());
        Page<ContentSummary> first = gateway.listContents(new ContentQuery(null, "pending", 1));
        assertEquals(132, first.total());
        assertEquals(20, first.items().size());
        assertEquals(12, gateway.listContents(new ContentQuery(null, "pending", 7)).items().size());
    }

    @Test void filtersAreAndNotOr() {
        assertEquals(1, gateway.listContents(new ContentQuery("ct_000004", "pending", 1)).total());
        assertEquals(0, gateway.listContents(new ContentQuery("ct_000004", "approved", 1)).total());
    }

    @Test void emptyPagesDoNotEraseTotalOrOverflow() {
        var page = gateway.listContents(new ContentQuery(null, "pending", Integer.MAX_VALUE));
        assertEquals(132, page.total());
        assertTrue(page.items().isEmpty());
        assertEquals(0, gateway.listContents(new ContentQuery("ct_missing", null, 1)).total());
    }

    @Test void detailPreservesAllTwelveFieldsAndChinese() {
        ContentDetail detail = gateway.getContent("ct_000004");
        assertEquals("无人剧场·第12话：逆流而上", detail.title());
        assertTrue(detail.body().contains("赛琳娜"));
        assertEquals(List.of("恋爱", "校园", "武侠"), detail.tags());
        assertEquals(12, json.valueToTree(detail).size());
        assertEquals("cat_03", detail.categoryId());
        assertThrows(UnsupportedOperationException.class, () -> detail.tags().add("anything"));
        assertTrue(gateway.getContent("ct_000042").title().contains("🌊"));
        assertEquals("", gateway.getContent("ct_000039").body());
    }

    @Test void historyIsSortedWithoutCleaningOrEditingStoredLogs() {
        var original = store.read().get("review_logs").deepCopy();
        var logs = gateway.getReviewLogs("ct_000003");
        assertEquals(2, logs.size());
        assertTrue(logs.get(0).createdAt().isAfter(logs.get(1).createdAt()));
        assertEquals("", logs.get(1).reason());
        assertEquals("limit", gateway.getReviewLogs("ct_000031").get(0).action());
        assertTrue(gateway.getReviewLogs("ct_000004").isEmpty());
        assertEquals(original, store.read().get("review_logs"));
    }

    @Test void tagFilteringBelongsToServiceAndKeepsDeprecatedInAll() {
        assertEquals(25, gateway.listTags().size());
        var service = new ContentService(gateway);
        assertEquals(23, service.tags("active").total());
        assertEquals(25, service.tags("all").total());
        assertEquals(2, service.tags("all").items().stream().filter(t -> t.status().equals("deprecated")).count());
    }

    @Test void nonexistentContentIsAReadFailureNotAnEmptyDetail() {
        var failure = assertThrows(GatewayFailure.class, () -> gateway.getContent("ct_missing"));
        assertEquals("CONTENT_NOT_FOUND", failure.code());
        assertEquals(GatewayFailure.Kind.READ_FAILURE, failure.kind());
        assertThrows(GatewayFailure.class, () -> gateway.getReviewLogs("ct_missing"));
    }

    @Test void readsFreshWorkingSnapshotWithoutChangingIt() throws Exception {
        store.update(data -> { data.put("_test_marker", "storage-only fixture"); return null; });
        byte[] before = Files.readAllBytes(directory.resolve("state.json"));
        gateway.listContents(new ContentQuery(null, "pending", 1));
        gateway.getContent("ct_000004");
        gateway.getReviewLogs("ct_000003");
        gateway.listTags();
        assertArrayEquals(before, Files.readAllBytes(directory.resolve("state.json")));
        assertEquals("storage-only fixture", store.read().get("_test_marker").asText());
    }

    @Test void currentSnapshotActuallyOverridesSeedForReadQueries() {
        var original = gateway.getContent("ct_000004");
        store.update(data -> {
            ((com.fasterxml.jackson.databind.node.ObjectNode) data.get("contents").get(3))
                    .put("title", "独立存储测试副本的标题标记");
            return null;
        });
        var observed = gateway.getContent("ct_000004");
        assertEquals("独立存储测试副本的标题标记", observed.title());
        assertEquals(original.reviewStatus(), observed.reviewStatus());
        assertEquals(original.tags(), observed.tags());
    }

    @Test void invalidWriteRequestsExplicitlyRejectWithoutAnyBusinessMutation() {
        var before = store.read();
        assertEquals("INVALID_REVIEW_BATCH", assertThrows(GatewayFailure.class,
                () -> gateway.submitReviews(java.util.Collections.nCopies(21, new ReviewItem("ct_000004", "approve", null)))).code());
        assertEquals("INVALID_TAG_ARRAY", assertThrows(GatewayFailure.class,
                () -> gateway.replaceTags("unused", null)).code());
        assertEquals(before, store.read());
        assertFalse(Files.exists(directory.resolve("state.json")));
    }
}
