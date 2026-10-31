package com.example.contentops.support;

import com.example.contentops.gateway.ContentGateway;
import com.example.contentops.gateway.GatewayFailure;
import com.example.contentops.model.ContentModels.*;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.function.IntFunction;

/** In-memory controlled test double, not a simulated production server or S5 fault injector. */
public final class RecordingGateway implements ContentGateway {
    public ContentDetail current = detail("pending", List.of("keep"));
    public List<TagItem> library = List.of(new TagItem("keep", "fixture", 1, "active"),
            new TagItem("new", "fixture", 1, "active"), new TagItem("old", "fixture", 1, "deprecated"));
    public final List<String> events = new ArrayList<>();
    public List<ReviewItem> submitted = List.of();
    public List<String> replacement;
    public int gets, reviewCalls, tagCalls;
    public ReviewCounts counts = new ReviewCounts(1, 0);
    public TagAck tagAck = new TagAck("stored");
    public RuntimeException reviewFailure, tagFailure;
    public boolean applyReview = true, applyTags = true;
    public IntFunction<ContentDetail> onRead;

    public static ContentDetail detail(String status, List<String> tags) {
        return new ContentDetail("fixture-content", "测试内容", "creator", status, "limited", "offline", tags,
                Instant.parse("2026-01-01T00:00:00Z"), "测试正文", "fixture", List.of("fixture"), "category");
    }
    @Override public ContentDetail getContent(String id) {
        events.add("get"); gets++;
        return onRead == null ? current : onRead.apply(gets);
    }
    @Override public List<TagItem> listTags() { events.add("library"); return library; }
    @Override public ReviewCounts submitReviews(List<ReviewItem> items) {
        events.add("review"); reviewCalls++; submitted = List.copyOf(items);
        if (reviewFailure != null) { throw reviewFailure; }
        if (applyReview && !(counts != null && Integer.valueOf(0).equals(counts.successCount()) && Integer.valueOf(1).equals(counts.failedCount()))) {
            current = detail("approve".equals(items.get(0).action()) ? "approved" : "rejected", current.tags());
        }
        return counts;
    }
    @Override public TagAck replaceTags(String id, List<String> tags) {
        events.add("put"); tagCalls++; replacement = List.copyOf(tags);
        if (tagFailure != null) { throw tagFailure; }
        if (applyTags) { current = detail(current.reviewStatus(), tags); }
        return tagAck;
    }
    @Override public Page<ContentSummary> listContents(ContentQuery query) { return new Page<>(List.of(current.summary()), 1); }
    @Override public List<ReviewLog> getReviewLogs(String id) { return List.of(); }
    public static GatewayFailure readFailure() { return new GatewayFailure(GatewayFailure.Kind.READ_FAILURE, "CONTROLLED_READ_FAILURE", "受控单元测试读取失败"); }
}
