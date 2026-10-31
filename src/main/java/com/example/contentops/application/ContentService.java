package com.example.contentops.application;

import com.example.contentops.gateway.ContentGateway;
import com.example.contentops.gateway.GatewayFailure;
import com.example.contentops.model.ContentModels.*;
import com.example.contentops.model.OperationModels.*;
import com.example.contentops.model.ResultModels.*;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Supplier;
import static com.example.contentops.model.OperationModels.sameTags;

public final class ContentService {
    private final ContentGateway gateway;
    private final TagPlanner tagPlanner = new TagPlanner();
    private final Supplier<List<String>> diagnostics;
    public ContentService(ContentGateway gateway) { this(gateway, List::of); }
    public ContentService(ContentGateway gateway, Supplier<List<String>> diagnostics) {
        this.gateway = gateway; this.diagnostics = diagnostics;
    }
    public List<String> diagnosticWarnings() { return List.copyOf(diagnostics.get()); }

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

    public OperationPlan plan(WriteSpec spec) {
        if (spec == null || spec.kind() == null) { throw new OperationRejected("INVALID_OPERATION", "必须指定操作类型"); }
        validateId(spec.contentId());
        String reason = TagPlanner.strip(spec.reason());
        if (spec.kind().includesReview()) {
            if (spec.action() == null || !Set.of("approve", "reject").contains(spec.action())) {
                throw new OperationRejected("INVALID_ACTION", "--action 只支持 approve 或 reject");
            }
            if ("reject".equals(spec.action()) && (reason == null || reason.isEmpty())) {
                throw new OperationRejected("REJECT_REASON_REQUIRED", "驳回必须提供非空 --reason");
            }
        } else if (spec.action() != null || spec.reason() != null) {
            throw new OperationRejected("UNSUPPORTED_REVIEW_OPTIONS", "标签命令不接收 action/reason");
        }
        if (spec.kind().includesTags() && spec.add().isEmpty()) {
            throw new OperationRejected("MISSING_TAG_CHANGE", "必须提供 --add；本阶段不支持 remove/set");
        }
        if (!spec.kind().includesTags() && !spec.add().isEmpty()) {
            throw new OperationRejected("UNSUPPORTED_TAG_OPTIONS", "审核命令不接收 --add");
        }
        ContentSnapshot before = readSnapshot(spec.contentId());
        if (spec.kind().includesReview()) { requirePending(before); }
        ReviewDecision review = spec.kind().includesReview() ? new ReviewDecision(before.reviewStatus(), spec.action(), reason) : null;
        TagPlanner.PlannedTags tags = spec.kind().includesTags() ? tagPlanner.add(before.tags(), gateway.listTags(), spec.add()) : null;
        return new OperationPlan(spec.kind(), spec.contentId(), before, review, tags == null ? null : tags.change(),
                tags == null ? List.of() : tags.warnings());
    }

    public WriteResult preview(OperationPlan plan) { return new Progress(plan).finish(Outcome.PREVIEWED, null); }

    public WriteResult execute(OperationPlan plan) {
        var progress = new Progress(plan);
        try {
            try {
                progress.observed = readSnapshot(plan.contentId());
            } catch (GatewayFailure failure) {
                return progress.fail(Outcome.READ_FAILURE, failure.code(), failure.getMessage(), "preflight");
            }
            if (!sameTags(progress.observed.tags(), plan.before().tags())
                    || (plan.kind().includesReview() && (!"pending".equals(progress.observed.reviewStatus())
                    || !plan.before().reviewStatus().equals(progress.observed.reviewStatus())))) {
                return progress.fail(Outcome.REJECTED, "STATE_CHANGED", "内容状态或标签已变化；请重新查询和预览，本次未提交", "preflight");
            }
            if (plan.kind().includesReview()) {
                WriteResult stopped = submitReview(progress);
                if (stopped != null) { return stopped; }
                if (plan.kind().includesTags() && !sameTags(progress.observed.tags(), plan.tags().before())) {
                    return progress.fail(Outcome.PARTIAL, "TAGS_CHANGED", "审核已核对成功，但标签已变化；未提交标签，请另做标签计划", "tags");
                }
            }
            if (plan.kind().includesTags()) {
                if (!plan.tags().hasChanges()) {
                    progress.set("tags", WriteState.SKIPPED, VerificationState.MATCHED, null);
                    return progress.finish(plan.kind() == OperationKind.TAGS ? Outcome.NO_CHANGE : Outcome.SUCCEEDED, null);
                }
                WriteResult stopped = submitTags(progress);
                if (stopped != null) { return stopped; }
            }
            return progress.finish(Outcome.SUCCEEDED, null);
        } catch (RuntimeException unexpected) {
            // Preserve facts even if an unforeseen local error occurs after a gateway has been invoked.
            if (progress.steps.values().stream().anyMatch(s -> s.write() == WriteState.UNKNOWN)) {
                return progress.fail(Outcome.UNKNOWN, "WRITE_RESULT_UNKNOWN", "写入调用结果未知；不自动重试，请核查详情和历史", progress.activeStep);
            }
            if (progress.steps.values().stream().anyMatch(s -> s.write() == WriteState.ACKNOWLEDGED && s.verification() == VerificationState.NOT_CHECKED)) {
                progress.steps.replaceAll((name, step) -> step.write() == WriteState.ACKNOWLEDGED && step.verification() == VerificationState.NOT_CHECKED
                        ? new StepResult(step.write(), VerificationState.UNAVAILABLE, step.apiResult()) : step);
                return progress.fail(Outcome.VERIFICATION_FAILED, "VERIFICATION_UNAVAILABLE", "已获写入确认，但本地核对未完成；不重试", progress.activeStep);
            }
            if (progress.reviewMatched()) {
                return progress.fail(plan.kind().includesTags() ? Outcome.PARTIAL : Outcome.VERIFICATION_FAILED,
                        "EXECUTION_INTERRUPTED", "保留已确认的审核结果；后续流程未完成，请核查后单独处理标签", progress.activeStep);
            }
            return progress.fail(Outcome.INTERNAL_FAILURE, "INTERNAL_ERROR", "写入前内部错误；未获得执行成功结论", "preflight");
        }
    }

    private WriteResult submitReview(Progress progress) {
        OperationPlan plan = progress.plan;
        progress.activeStep = "review";
        progress.set("review", WriteState.UNKNOWN, VerificationState.NOT_CHECKED, null);
        ReviewCounts counts;
        try {
            counts = gateway.submitReviews(List.of(new ReviewItem(plan.contentId(), plan.review().action(), plan.review().reason())));
        } catch (RuntimeException failure) { return writeFailure(progress, "review", failure); }
        Map<String, Object> response = null;
        if (counts != null) {
            response = new LinkedHashMap<>();
            response.put("success_count", counts.successCount()); response.put("failed_count", counts.failedCount());
        }
        if (counts != null && Integer.valueOf(0).equals(counts.successCount()) && Integer.valueOf(1).equals(counts.failedCount())) {
            progress.set("review", WriteState.FAILED, VerificationState.NOT_CHECKED, response);
            return progress.fail(Outcome.READ_FAILURE, "REVIEW_FAILED", "上游计数表明该单项审核失败；未提供逐项原因", "review");
        }
        if (counts == null || !Integer.valueOf(1).equals(counts.successCount()) || !Integer.valueOf(0).equals(counts.failedCount())) {
            progress.set("review", WriteState.UNKNOWN, VerificationState.NOT_CHECKED, response);
            return progress.fail(Outcome.UNKNOWN, "REVIEW_COUNTS_UNKNOWN", "审核计数缺失或无法解释；不重发、不继续标签写入", "review");
        }
        progress.set("review", WriteState.ACKNOWLEDGED, VerificationState.NOT_CHECKED, response);
        try { progress.observed = readSnapshot(plan.contentId()); }
        catch (RuntimeException failure) { return verificationUnavailable(progress, "review"); }
        boolean matched = plan.review().expectedStatus().equals(progress.observed.reviewStatus());
        progress.verify("review", matched ? VerificationState.MATCHED : VerificationState.MISMATCHED);
        if (!matched) { return progress.fail(Outcome.VERIFICATION_FAILED, "REVIEW_MISMATCH", "审核已获确认，但实际状态未匹配；不继续写入", "review"); }
        return null;
    }

    private WriteResult submitTags(Progress progress) {
        OperationPlan plan = progress.plan;
        progress.activeStep = "tags";
        progress.set("tags", WriteState.UNKNOWN, VerificationState.NOT_CHECKED, null);
        TagAck response;
        try { response = gateway.replaceTags(plan.contentId(), plan.tags().after()); }
        catch (RuntimeException failure) { return writeFailure(progress, "tags", failure); }
        if (response == null || response.result() == null) {
            return progress.fail(Outcome.UNKNOWN, "TAG_RESPONSE_UNKNOWN", "标签写入响应缺少合规 result；不重试", "tags");
        }
        // The API specifies a string, not an enum whose only accepted value is "ok".
        progress.set("tags", WriteState.ACKNOWLEDGED, VerificationState.NOT_CHECKED, Map.of("result", response.result()));
        try { progress.observed = readSnapshot(plan.contentId()); }
        catch (RuntimeException failure) { return verificationUnavailable(progress, "tags"); }
        boolean tagsMatched = sameTags(plan.tags().after(), progress.observed.tags());
        progress.verify("tags", tagsMatched ? VerificationState.MATCHED : VerificationState.MISMATCHED);
        boolean reviewMatched = !plan.kind().includesReview() || plan.review().expectedStatus().equals(progress.observed.reviewStatus());
        if (plan.kind().includesReview()) { progress.verify("review", reviewMatched ? VerificationState.MATCHED : VerificationState.MISMATCHED); }
        if (!tagsMatched || !reviewMatched) {
            return progress.fail(Outcome.VERIFICATION_FAILED, "FINAL_STATE_MISMATCH", "写入已获确认，但最终审核或标签不匹配；不自动重写", "tags");
        }
        return null;
    }

    private WriteResult writeFailure(Progress progress, String step, RuntimeException failure) {
        boolean definite = failure instanceof GatewayFailure gatewayFailure && gatewayFailure.kind() == GatewayFailure.Kind.REJECTED_NO_COMMIT;
        progress.set(step, definite ? WriteState.FAILED : WriteState.UNKNOWN, VerificationState.NOT_CHECKED, null);
        String code = failure instanceof GatewayFailure gatewayFailure ? gatewayFailure.code() : "WRITE_RESULT_UNKNOWN";
        String message = definite ? "本步骤明确未提交；保留此前步骤，请核查后单独处理" : "本步骤写入结果未知；禁止自动重试，后续写入已停止";
        return progress.fail(definite ? (progress.reviewMatched() ? Outcome.PARTIAL : Outcome.READ_FAILURE) : Outcome.UNKNOWN, code, message, step);
    }

    private WriteResult verificationUnavailable(Progress progress, String step) {
        progress.verify(step, VerificationState.UNAVAILABLE);
        return progress.fail(Outcome.VERIFICATION_FAILED, "VERIFICATION_UNAVAILABLE", "写入已获确认，但回读不可用；observed 保留最近成功读取，不代表当前最终状态", step);
    }

    private ContentSnapshot readSnapshot(String contentId) {
        ContentDetail detail = gateway.getContent(contentId);
        if (detail == null || !contentId.equals(detail.contentId()) || detail.reviewStatus() == null || detail.tags() == null) {
            throw new GatewayFailure(GatewayFailure.Kind.READ_FAILURE, "INVALID_CONTENT_RESPONSE", "详情缺少必要状态/标签或 ID 不匹配；停止操作");
        }
        return ContentSnapshot.from(detail);
    }

    private void requirePending(ContentSnapshot snapshot) {
        if (!"pending".equals(snapshot.reviewStatus())) {
            throw new OperationRejected("REVIEW_NOT_PENDING", "只允许审核 pending 内容；请重新查看详情，不会重复提交");
        }
    }

    private static final class Progress {
        private final OperationPlan plan;
        private final Map<String, StepResult> steps = new LinkedHashMap<>();
        private ContentSnapshot observed;
        private String activeStep = "preflight";
        private Progress(OperationPlan plan) {
            this.plan = plan; observed = plan.before();
            if (plan.kind().includesReview()) { set("review", WriteState.NOT_SENT, VerificationState.NOT_CHECKED, null); }
            if (plan.kind().includesTags()) { set("tags", WriteState.NOT_SENT, VerificationState.NOT_CHECKED, null); }
        }
        private void set(String name, WriteState write, VerificationState verification, Map<String, Object> response) {
            steps.put(name, new StepResult(write, verification, response));
        }
        private void verify(String name, VerificationState verification) {
            StepResult previous = steps.get(name); set(name, previous.write(), verification, previous.apiResult());
        }
        private boolean reviewMatched() {
            StepResult review = steps.get("review");
            return review != null && review.write() == WriteState.ACKNOWLEDGED && review.verification() == VerificationState.MATCHED;
        }
        private WriteResult finish(Outcome outcome, CliError error) { return new WriteResult(outcome, new WriteData(plan, steps, observed), error, plan.warnings()); }
        private WriteResult fail(Outcome outcome, String code, String message, String step) { return finish(outcome, new CliError(code, message, step, null)); }
    }

    private static void validateId(String id) {
        if (id == null || id.isBlank() || id.codePoints().anyMatch(c -> Character.isWhitespace(c)
                || Character.isSpaceChar(c) || Character.isISOControl(c))) {
            throw new OperationRejected("INVALID_CONTENT_ID", "必须提供一个不含空白或控制字符的内容 ID");
        }
    }
}
