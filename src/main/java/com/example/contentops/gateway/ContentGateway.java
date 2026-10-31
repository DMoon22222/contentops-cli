package com.example.contentops.gateway;

import com.example.contentops.model.ContentModels.*;
import java.util.List;

public interface ContentGateway {
    Page<ContentSummary> listContents(ContentQuery query);
    ContentDetail getContent(String contentId);
    List<ReviewLog> getReviewLogs(String contentId);
    ReviewCounts submitReviews(List<ReviewItem> items);
    List<TagItem> listTags();
    TagAck replaceTags(String contentId, List<String> completeTags);
}
