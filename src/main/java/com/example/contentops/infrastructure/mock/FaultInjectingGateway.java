package com.example.contentops.infrastructure.mock;

import com.example.contentops.gateway.ContentGateway;
import com.example.contentops.gateway.GatewayFailure;
import com.example.contentops.model.ContentModels.*;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/** Invocation-local Mock diagnostics. A successful delegate write has already committed its snapshot. */
public final class FaultInjectingGateway implements ContentGateway {
    private enum Readback { REVIEW, TAGS }
    private record Pending(Readback phase, ContentDetail before) { }
    public record Calls(int contentReads, int delegateContentReads, int reviewAttempts, int reviewDelegateCalls,
                        int tagAttempts, int tagDelegateCalls, int injectedReadbacks) { }
    private final ContentGateway delegate;
    private final MockScenario scenario;
    private final Map<String, Pending> pending = new HashMap<>();
    private int contentReads, delegateContentReads, reviewAttempts, reviewDelegateCalls, tagAttempts, tagDelegateCalls, injectedReadbacks;

    public FaultInjectingGateway(ContentGateway delegate, MockScenario scenario) {
        this.delegate = Objects.requireNonNull(delegate); this.scenario = Objects.requireNonNull(scenario);
    }
    public Calls calls() { return new Calls(contentReads, delegateContentReads, reviewAttempts, reviewDelegateCalls, tagAttempts, tagDelegateCalls, injectedReadbacks); }
    public List<String> diagnosticWarnings() {
        if (!scenario.active()) { return List.of(); }
        String counts = "MOCK_CALL_COUNTS {\"content_reads\":" + contentReads + ",\"delegate_content_reads\":" + delegateContentReads
                + ",\"review_attempts\":" + reviewAttempts + ",\"review_delegate_calls\":" + reviewDelegateCalls
                + ",\"tag_attempts\":" + tagAttempts + ",\"tag_delegate_calls\":" + tagDelegateCalls + ",\"injected_readbacks\":" + injectedReadbacks + "}";
        return List.of(scenario.warning(), counts);
    }
    @Override public Page<ContentSummary> listContents(ContentQuery query) { return delegate.listContents(query); }
    @Override public List<ReviewLog> getReviewLogs(String id) { return delegate.getReviewLogs(id); }
    @Override public List<TagItem> listTags() { return delegate.listTags(); }

    @Override public ContentDetail getContent(String id) {
        contentReads++;
        ContentDetail actual = readDelegate(id);
        Pending stale = pending.remove(id);
        if (stale == null) { return actual; }
        injectedReadbacks++;
        // Only the selected view field is stale. Never write the stale view back to disk.
        return new ContentDetail(actual.contentId(), actual.title(), actual.creatorId(),
                stale.phase() == Readback.REVIEW ? stale.before().reviewStatus() : actual.reviewStatus(),
                actual.qualityStatus(), actual.visibility(), stale.phase() == Readback.TAGS ? stale.before().tags() : actual.tags(),
                actual.createdAt(), actual.body(), actual.source(), actual.channels(), actual.categoryId());
    }
    private ContentDetail readDelegate(String id) { delegateContentReads++; return delegate.getContent(id); }

    @Override public ReviewCounts submitReviews(List<ReviewItem> items) {
        reviewAttempts++;
        ContentDetail before = null;
        if (scenario == MockScenario.REVIEW_READBACK_MISMATCH && items != null && items.size() == 1 && items.get(0) != null) {
            before = readDelegate(items.get(0).contentId());
        }
        reviewDelegateCalls++;
        ReviewCounts response = delegate.submitReviews(items);
        if (response != null && response.successCount() != null && response.successCount() > 0) {
            if (scenario == MockScenario.REVIEW_COMMIT_RESPONSE_LOST) {
                throw new GatewayFailure(GatewayFailure.Kind.WRITE_UNKNOWN, "MOCK_REVIEW_RESPONSE_LOST", "受控模拟：审核 delegate 已提交，返回前响应丢失");
            }
            if (before != null && Integer.valueOf(1).equals(response.successCount()) && Integer.valueOf(0).equals(response.failedCount())) {
                pending.put(before.contentId(), new Pending(Readback.REVIEW, before));
            }
        }
        return response;
    }

    @Override public TagAck replaceTags(String id, List<String> tags) {
        tagAttempts++;
        if (scenario == MockScenario.TAGS_REJECT_BEFORE_WRITE) {
            throw new GatewayFailure(GatewayFailure.Kind.REJECTED_NO_COMMIT, "MOCK_TAGS_REJECTED", "受控模拟：标签 delegate 调用前拒绝，未提交标签");
        }
        ContentDetail before = scenario == MockScenario.TAGS_READBACK_MISMATCH ? readDelegate(id) : null;
        tagDelegateCalls++;
        TagAck response = delegate.replaceTags(id, tags);
        if (response != null && response.result() != null) {
            if (scenario == MockScenario.TAGS_COMMIT_RESPONSE_LOST) {
                throw new GatewayFailure(GatewayFailure.Kind.WRITE_UNKNOWN, "MOCK_TAGS_RESPONSE_LOST", "受控模拟：标签 delegate 已提交，返回前响应丢失");
            }
            if (before != null) { pending.put(id, new Pending(Readback.TAGS, before)); }
        }
        return response;
    }
}
