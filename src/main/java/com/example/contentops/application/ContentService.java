package com.example.contentops.application;

import com.example.contentops.gateway.ContentGateway;
import com.example.contentops.model.ContentModels.*;
import java.util.Set;

public final class ContentService {
    private final ContentGateway gateway;
    public ContentService(ContentGateway gateway) { this.gateway = gateway; }

    public ContentListView list(String contentId, String reviewStatus, int page) {
        if (page < 1) { throw new OperationRejected("INVALID_PAGE", "--page 必须是大于等于 1 的整数"); }
        if (reviewStatus != null && !Set.of("pending", "approved", "rejected").contains(reviewStatus)) {
            throw new OperationRejected("INVALID_REVIEW_STATUS", "--review-status 只支持 pending、approved、rejected");
        }
        if (contentId != null) { validateId(contentId); }
        Page<ContentSummary> result = gateway.listContents(new ContentQuery(contentId, reviewStatus, page));
        return new ContentListView(page, 20, result.total(), result.items());
    }

    public ContentDetail get(String contentId) {
        validateId(contentId);
        return gateway.getContent(contentId);
    }

    public HistoryView history(String contentId) {
        validateId(contentId);
        return new HistoryView(contentId, gateway.getReviewLogs(contentId));
    }

    public TagListView tags(String status) {
        if (status == null || !Set.of("active", "all").contains(status)) {
            throw new OperationRejected("INVALID_TAG_STATUS", "--status 本阶段只支持 active 或 all");
        }
        var tags = gateway.listTags().stream().filter(t -> "all".equals(status) || "active".equals(t.status())).toList();
        return new TagListView(tags.size(), tags);
    }

    private static void validateId(String id) {
        if (id == null || id.isBlank() || id.codePoints().anyMatch(c -> Character.isWhitespace(c)
                || Character.isSpaceChar(c) || Character.isISOControl(c))) {
            throw new OperationRejected("INVALID_CONTENT_ID", "必须提供一个不含空白或控制字符的内容 ID");
        }
    }
}
