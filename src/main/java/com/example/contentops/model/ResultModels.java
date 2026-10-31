package com.example.contentops.model;

import java.util.List;
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
    public record CliResult<T>(String schemaVersion, String invocationId, String environment,
                               String command, String mode, String status, int exitCode,
                               String contentId, T data, CliError error, List<String> warnings) {
        public CliResult { warnings = List.copyOf(warnings); }
    }

    public static <T> CliResult<T> result(String environment, String command, String mode, String contentId,
                                         Outcome outcome, T data, CliError error) {
        return new CliResult<>("1", UUID.randomUUID().toString(), environment, command, mode,
                outcome.status, outcome.exitCode, contentId, data, error, List.of());
    }
}
