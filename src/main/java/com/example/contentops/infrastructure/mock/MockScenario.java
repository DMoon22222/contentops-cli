package com.example.contentops.infrastructure.mock;

import com.example.contentops.application.OperationRejected;

public enum MockScenario {
    NONE(null), TAGS_REJECT_BEFORE_WRITE("tags-reject-before-write"),
    REVIEW_COMMIT_RESPONSE_LOST("review-commit-response-lost"), TAGS_COMMIT_RESPONSE_LOST("tags-commit-response-lost"),
    REVIEW_READBACK_MISMATCH("review-readback-mismatch"), TAGS_READBACK_MISMATCH("tags-readback-mismatch");

    private final String value;
    MockScenario(String value) { this.value = value; }
    public String value() { return value; }
    public boolean active() { return this != NONE; }
    public String warning() { return "MOCK_FAULT_ACTIVE scenario=" + value + "；本地受控模拟，不代表真实后台故障"; }

    public static MockScenario parse(String value) {
        if (value == null) { return NONE; }
        for (MockScenario scenario : values()) { if (scenario.active() && scenario.value.equals(value)) { return scenario; } }
        throw new OperationRejected("INVALID_MOCK_SCENARIO", "CONTENTOPS_MOCK_SCENARIO 不是已支持的场景名；清除变量可关闭故障");
    }
}
