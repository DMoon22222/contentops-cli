package com.example.contentops.application;

public final class OperationRejected extends RuntimeException {
    private final String code;
    public OperationRejected(String code, String message) {
        super(message);
        this.code = code;
    }
    public String code() { return code; }
}
