package com.example.contentops.support;

import org.junit.jupiter.api.extension.AnnotatedElementContext;
import org.junit.jupiter.api.extension.ExtensionContext;
import org.junit.jupiter.api.io.TempDirFactory;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

/** Run filesystem tests on the project drive, not an unrelated system temp drive. */
public final class WorkspaceTempDirFactory implements TempDirFactory {
    @Override public Path createTempDirectory(AnnotatedElementContext element, ExtensionContext context) throws IOException {
        Path root = Path.of(System.getProperty("contentops.project", System.getProperty("user.dir")))
                .toAbsolutePath().resolve("target/test-state");
        Files.createDirectories(root);
        return Files.createTempDirectory(root, "case-");
    }
}
