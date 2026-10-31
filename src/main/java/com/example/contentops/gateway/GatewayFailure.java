package com.example.contentops.gateway;

public final class GatewayFailure extends RuntimeException {
    public enum Kind { READ_FAILURE, REJECTED_NO_COMMIT, WRITE_UNKNOWN }
    private final Kind kind;
    private final String code;

    public GatewayFailure(Kind kind, String code, String message) {
        super(message);
        this.kind = kind;
        this.code = code;
    }

    public GatewayFailure(Kind kind, String code, String message, Throwable cause) {
        super(message, cause);
        this.kind = kind;
        this.code = code;
    }

    public Kind kind() { return kind; }
    public String code() { return code; }
}
