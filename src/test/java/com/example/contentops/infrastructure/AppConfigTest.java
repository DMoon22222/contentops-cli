package com.example.contentops.infrastructure;

import com.example.contentops.application.OperationRejected;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.Path;
import java.util.Map;
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
}
