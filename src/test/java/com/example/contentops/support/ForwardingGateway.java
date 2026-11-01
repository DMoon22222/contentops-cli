package com.example.contentops.support;

import com.example.contentops.gateway.ContentGateway;
import com.example.contentops.model.ContentModels.*;
import java.util.List;

/** Test-only seam around real gateways; never part of the executable JAR. */
public class ForwardingGateway implements ContentGateway {
    protected final ContentGateway delegate;
    public ForwardingGateway(ContentGateway delegate) { this.delegate = delegate; }
    @Override public Page<ContentSummary> listContents(ContentQuery query) { return delegate.listContents(query); }
    @Override public ContentDetail getContent(String id) { return delegate.getContent(id); }
    @Override public List<ReviewLog> getReviewLogs(String id) { return delegate.getReviewLogs(id); }
    @Override public ReviewCounts submitReviews(List<ReviewItem> items) { return delegate.submitReviews(items); }
    @Override public List<TagItem> listTags() { return delegate.listTags(); }
    @Override public TagAck replaceTags(String id, List<String> tags) { return delegate.replaceTags(id, tags); }
}
