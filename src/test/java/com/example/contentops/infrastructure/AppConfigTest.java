package com.example.contentops.infrastructure;

import com.example.contentops.application.OperationRejected;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.Path;
import java.util.Map;
import com.example.contentops.infrastructure.mock.MockScenario;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import static org.junit.jupiter.api.Assertions.*;

class AppConfigTest {
    @TempDir Path temporary;

    @Test void configuredAbsolutePathIsUsed() {
        Path directory = temporary.resolve("independent");
        assertEquals(directory, AppConfig.load("mock", Map.of("CONTENTOPS_STATE_DIR", directory.toString())).stateDirectory());
    }

    @Test void relativeDirectoryIsRefused() {
        assertEquals("INVALID_STATE_DIRECTORY", assertThrows(OperationRejected.class,
                () -> AppConfig.load("mock", Map.of("CONTENTOPS_STATE_DIR", "relative"))).code());
    }

    @Test void apiDoesNotFallBackToMock() {
        assertEquals("API_ENV_NOT_IMPLEMENTED", assertThrows(OperationRejected.class,
                () -> AppConfig.load("api", Map.of())).code());
    }

    @Test void originalAttachmentDirectoryCannotBeConfigured() {
        assertThrows(OperationRejected.class, () -> AppConfig.load("mock",
                Map.of("CONTENTOPS_STATE_DIR", temporary.resolve("内容运营后台接口数据/working").toString())));
    }

    @Test void missingScenarioIsInactiveAndKnownScenarioIsAccepted() {
        assertEquals(MockScenario.NONE, AppConfig.load("mock", Map.of("CONTENTOPS_STATE_DIR", temporary.toString())).mockScenario());
        assertEquals(MockScenario.REVIEW_COMMIT_RESPONSE_LOST, AppConfig.load("mock", Map.of("CONTENTOPS_STATE_DIR", temporary.toString(),
                "CONTENTOPS_MOCK_SCENARIO", "review-commit-response-lost")).mockScenario());
    }
    @ParameterizedTest @ValueSource(strings = {"", " ", "none", "unknown", "REVIEW-COMMIT-RESPONSE-LOST"})
    void invalidScenarioIsRejectedRatherThanDisabled(String value) {
        assertEquals("INVALID_MOCK_SCENARIO", assertThrows(OperationRejected.class, () -> AppConfig.load("mock",
                Map.of("CONTENTOPS_STATE_DIR", temporary.toString(), "CONTENTOPS_MOCK_SCENARIO", value))).code());
    }
    @ParameterizedTest @ValueSource(strings = {"", "tags-reject-before-write", "unknown"})
    void apiRefusesAnyPresentMockScenario(String value) {
        assertEquals("MOCK_SCENARIO_NOT_ALLOWED", assertThrows(OperationRejected.class, () -> AppConfig.load("api", Map.of("CONTENTOPS_MOCK_SCENARIO", value))).code());
    }
}
