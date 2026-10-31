package com.example.contentops.infrastructure;

import com.example.contentops.application.OperationRejected;
import com.example.contentops.infrastructure.mock.MockScenario;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.Map;

public record AppConfig(String environment, Path stateDirectory, MockScenario mockScenario) {
    public static AppConfig load(String environment, Map<String, String> variables) {
        if (!"mock".equals(environment) && !"api".equals(environment)) {
            throw new OperationRejected("INVALID_ENVIRONMENT", "--env 只支持 mock 或 api");
        }
        if ("api".equals(environment)) {
            if (variables.containsKey("CONTENTOPS_MOCK_SCENARIO")) {
                throw new OperationRejected("MOCK_SCENARIO_NOT_ALLOWED", "api 环境不允许设置 CONTENTOPS_MOCK_SCENARIO");
            }
            throw new OperationRejected("API_ENV_NOT_IMPLEMENTED", "尚未实现 HTTP Gateway；不会回退 Mock");
        }
        MockScenario scenario = MockScenario.parse(variables.get("CONTENTOPS_MOCK_SCENARIO"));
        String configured = variables.get("CONTENTOPS_STATE_DIR");
        Path path;
        try {
            path = configured == null ? Path.of(System.getProperty("user.home"), ".contentops", "mock", "v1")
                    : Path.of(configured);
            if (configured != null && configured.isBlank()) {
                throw new IllegalArgumentException("empty path");
            }
            path = validateStateDirectory(path);
        } catch (IOException | IllegalArgumentException e) {
            throw new OperationRejected("INVALID_STATE_DIRECTORY", "状态目录必须是原始附件目录以外的有效绝对目录");
        }
        return new AppConfig(environment, path, scenario);
    }

    /** Resolve existing ancestors, including Windows directory junctions, without creating files. */
    public static Path validateStateDirectory(Path path) throws IOException {
        if (!path.isAbsolute()) { throw new IllegalArgumentException("absolute path required"); }
        Path normalized = path.normalize();
        rejectSourceDirectory(normalized);
        var suffix = new ArrayDeque<String>();
        Path ancestor = normalized;
        while (!Files.exists(ancestor, LinkOption.NOFOLLOW_LINKS)) {
            suffix.addFirst(ancestor.getFileName().toString());
            ancestor = ancestor.getParent();
        }
        Path resolved = ancestor.toRealPath();
        for (String part : suffix) { resolved = resolved.resolve(part); }
        rejectSourceDirectory(resolved);
        if (Files.exists(resolved) && !Files.isDirectory(resolved)) {
            throw new IllegalArgumentException("not a directory");
        }
        return resolved;
    }

    private static void rejectSourceDirectory(Path path) {
        for (Path part : path) {
            if ("内容运营后台接口数据".equalsIgnoreCase(part.toString())) {
                throw new IllegalArgumentException("source directory is read-only");
            }
        }
    }
}
