package com.example.contentops.model;

import com.example.contentops.model.OperationModels.ContentSnapshot;
import com.example.contentops.model.OperationModels.OperationPlan;
import com.fasterxml.jackson.annotation.JsonValue;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public final class ResultModels {
    private ResultModels() { }

    public enum Outcome {
        SUCCEEDED("succeeded", 0), PREVIEWED("previewed", 0), NO_CHANGE("no_change", 0),
        INTERNAL_FAILURE("failed", 1), REJECTED("rejected", 2), READ_FAILURE("failed", 3),
        PARTIAL("partial", 4), UNKNOWN("unknown", 5), VERIFICATION_FAILED("verification_failed", 6), CANCELLED("cancelled", 7);
        private final String status;
        private final int exitCode;
        Outcome(String status, int exitCode) { this.status = status; this.exitCode = exitCode; }
    }

    public record UpstreamError(Integer httpStatus, Integer code, String message) { }
    public record CliError(String code, String message, String step, UpstreamError upstream) { }
    public enum WriteState {
        NOT_SENT, ACKNOWLEDGED, FAILED, UNKNOWN, SKIPPED;
        @JsonValue public String wire() { return name().toLowerCase(java.util.Locale.ROOT); }
    }
    public enum VerificationState {
        NOT_CHECKED, MATCHED, MISMATCHED, UNAVAILABLE;
        @JsonValue public String wire() { return name().toLowerCase(java.util.Locale.ROOT); }
    }
    public record StepResult(WriteState write, VerificationState verification, Map<String, Object> apiResult) {
        public StepResult {
            apiResult = apiResult == null ? null : Collections.unmodifiableMap(new LinkedHashMap<>(apiResult));
        }
    }
    public record WriteData(OperationPlan plan, Map<String, StepResult> steps, ContentSnapshot observed) {
        public WriteData { steps = Collections.unmodifiableMap(new LinkedHashMap<>(steps)); }
    }
    public record WriteResult(Outcome outcome, WriteData data, CliError error, List<String> warnings) {
        public WriteResult { warnings = List.copyOf(warnings); }
    }
    public record CliResult<T>(String schemaVersion, String invocationId, String environment,
                               String command, String mode, String status, int exitCode,
                               String contentId, T data, CliError error, List<String> warnings) {
        public CliResult { warnings = List.copyOf(warnings); }
    }

    public static <T> CliResult<T> result(String environment, String command, String mode, String contentId,
                                         Outcome outcome, T data, CliError error) {
        return result(environment, command, mode, contentId, outcome, data, error, List.of());
    }

    public static <T> CliResult<T> result(String environment, String command, String mode, String contentId,
                                         Outcome outcome, T data, CliError error, List<String> warnings) {
        return new CliResult<>("1", UUID.randomUUID().toString(), environment, command, mode,
                outcome.status, outcome.exitCode, contentId, data, error, warnings);
    }
}
