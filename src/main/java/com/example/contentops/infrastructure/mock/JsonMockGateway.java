package com.example.contentops.infrastructure.mock;

import com.example.contentops.gateway.ContentGateway;
import com.example.contentops.gateway.GatewayFailure;
import com.example.contentops.gateway.GatewayFailure.Kind;
import com.example.contentops.model.ContentModels.*;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Set;

public final class JsonMockGateway implements ContentGateway {
    private final JsonStateStore store;
    private final ObjectMapper json;

    public JsonMockGateway(JsonStateStore store, ObjectMapper json) {
        this.store = store;
        this.json = json;
    }

    @Override public Page<ContentSummary> listContents(ContentQuery query) {
        if (query == null || query.page() < 1 || (query.reviewStatus() != null
                && !Set.of("pending", "approved", "rejected").contains(query.reviewStatus()))) {
            throw new GatewayFailure(Kind.REJECTED_NO_COMMIT, "INVALID_QUERY", "内容查询参数不合法");
        }
        var matches = new ArrayList<ContentSummary>();
        for (JsonNode content : store.read().get("contents")) {
            if (query.contentId() != null && !query.contentId().equals(content.path("content_id").asText())) { continue; }
            if (query.reviewStatus() != null && !query.reviewStatus().equals(content.path("review_status").asText())) { continue; }
            matches.add(decode(content, ContentDetail.class).summary());
        }
        long offset = ((long) query.page() - 1) * 20;
        int from = (int) Math.min(offset, matches.size());
        int to = Math.min(from + 20, matches.size());
        return new Page<>(matches.subList(from, to), matches.size());
    }

    @Override public ContentDetail getContent(String contentId) {
        return decode(find(store.read().get("contents"), contentId), ContentDetail.class);
    }

    @Override public List<ReviewLog> getReviewLogs(String contentId) {
        var data = store.read();
        find(data.get("contents"), contentId);
        JsonNode logs = data.get("review_logs").get(contentId);
        if (logs == null) { return List.of(); }
        if (!logs.isArray()) { throw invalidResponse(); }
        var result = new ArrayList<ReviewLog>();
        for (JsonNode log : logs) {
            ReviewLog decoded = decode(log, ReviewLog.class);
            if (decoded.action() == null || decoded.createdAt() == null) { throw invalidResponse(); }
            result.add(decoded);
        }
        result.sort(Comparator.comparing(ReviewLog::createdAt).reversed());
        return List.copyOf(result);
    }

    @Override public List<TagItem> listTags() {
        var result = new ArrayList<TagItem>();
        for (JsonNode tag : store.read().get("tags")) {
            TagItem item = decode(tag, TagItem.class);
            if (item.tag() == null || item.status() == null || item.group() == null
                    || !tag.path("usage_count").isIntegralNumber()) { throw invalidResponse(); }
            result.add(item);
        }
        return List.copyOf(result);
    }

    @Override public ReviewCounts submitReviews(List<ReviewItem> items) { throw writesUnavailable(); }
    @Override public TagAck replaceTags(String contentId, List<String> completeTags) { throw writesUnavailable(); }

    private JsonNode find(JsonNode contents, String contentId) {
        for (JsonNode content : contents) {
            if (contentId != null && contentId.equals(content.path("content_id").asText())) { return content; }
        }
        throw new GatewayFailure(Kind.READ_FAILURE, "CONTENT_NOT_FOUND", "Mock 中不存在指定内容；请核对 ID");
    }

    private <T> T decode(JsonNode node, Class<T> type) {
        try {
            T result = json.treeToValue(node, type);
            if (result instanceof ContentDetail content && (content.contentId() == null || content.reviewStatus() == null)) {
                throw invalidResponse();
            }
            return result;
        } catch (JsonProcessingException | IllegalArgumentException e) {
            throw new GatewayFailure(Kind.READ_FAILURE, "MOCK_DATA_INVALID", "Mock 记录缺少必要字段或字段类型不合法", e);
        }
    }

    private static GatewayFailure invalidResponse() {
        return new GatewayFailure(Kind.READ_FAILURE, "MOCK_DATA_INVALID", "Mock 记录缺少必要字段或字段类型不合法");
    }
    private static GatewayFailure writesUnavailable() {
        return new GatewayFailure(Kind.REJECTED_NO_COMMIT, "WRITE_NOT_IMPLEMENTED", "S0–S2 只读阶段未实现审核和标签写入");
    }
}
