package com.example.contentops.model;

import java.time.Instant;
import java.util.List;

public final class ContentModels {
    private ContentModels() { }

    public record ContentQuery(String contentId, String reviewStatus, int page) { }
    public record Page<T>(List<T> items, long total) {
        public Page { items = List.copyOf(items); }
    }
    public record ContentSummary(String contentId, String title, String creatorId,
                                 String reviewStatus, String qualityStatus, String visibility,
                                 List<String> tags, Instant createdAt) {
        public ContentSummary { tags = List.copyOf(tags); }
    }
    public record ContentDetail(String contentId, String title, String creatorId,
                                String reviewStatus, String qualityStatus, String visibility,
                                List<String> tags, Instant createdAt, String body, String source,
                                List<String> channels, String categoryId) {
        public ContentDetail { tags = List.copyOf(tags); channels = List.copyOf(channels); }
        public ContentSummary summary() {
            return new ContentSummary(contentId, title, creatorId, reviewStatus, qualityStatus,
                    visibility, tags, createdAt);
        }
    }
    public record ReviewLog(String action, String operatorId, String reason, Instant createdAt) { }
    public record TagItem(String tag, String group, long usageCount, String status) { }
    public record ReviewItem(String contentId, String action, String reason) { }
    public record ReviewCounts(Integer successCount, Integer failedCount) { }
    public record TagAck(String result) { }
    public record ContentListView(int page, int pageSize, long total, List<ContentSummary> items) {
        public ContentListView { items = List.copyOf(items); }
    }
    public record HistoryView(String contentId, List<ReviewLog> items) {
        public HistoryView { items = List.copyOf(items); }
    }
    public record TagListView(long total, List<TagItem> items) {
        public TagListView { items = List.copyOf(items); }
    }
}
