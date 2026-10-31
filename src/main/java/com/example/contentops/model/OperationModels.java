package com.example.contentops.model;

import com.example.contentops.model.ContentModels.ContentDetail;
import com.fasterxml.jackson.annotation.JsonIgnore;
import java.util.HashSet;
import java.util.List;

public final class OperationModels {
    private OperationModels() { }

    public enum OperationKind {
        REVIEW, TAGS, PROCESS;
        public boolean includesReview() { return this != TAGS; }
        public boolean includesTags() { return this != REVIEW; }
    }

    public record WriteSpec(OperationKind kind, String contentId, String action, String reason, List<String> add) {
        public WriteSpec { add = add == null ? List.of() : List.copyOf(add); }
    }
    public record ContentSnapshot(String contentId, String reviewStatus, String qualityStatus,
                                  String visibility, List<String> tags) {
        public ContentSnapshot { tags = List.copyOf(tags); }
        public static ContentSnapshot from(ContentDetail detail) {
            return new ContentSnapshot(detail.contentId(), detail.reviewStatus(), detail.qualityStatus(), detail.visibility(), detail.tags());
        }
    }
    public record ReviewDecision(String before, String action, String reason) {
        public String expectedStatus() { return "approve".equals(action) ? "approved" : "rejected"; }
    }
    public record TagChange(List<String> before, List<String> after) {
        public TagChange { before = List.copyOf(before); after = List.copyOf(after); }
        public boolean hasChanges() { return !sameTags(before, after); }
    }
    public record OperationPlan(@JsonIgnore OperationKind kind, @JsonIgnore String contentId,
                                @JsonIgnore ContentSnapshot before, ReviewDecision review, TagChange tags,
                                @JsonIgnore List<String> warnings) {
        public OperationPlan { warnings = List.copyOf(warnings); }
    }

    public static boolean sameTags(List<String> left, List<String> right) {
        return new HashSet<>(left).equals(new HashSet<>(right));
    }
}
