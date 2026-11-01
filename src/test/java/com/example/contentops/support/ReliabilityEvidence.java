package com.example.contentops.support;

import com.example.contentops.infrastructure.JsonSupport;
import com.example.contentops.infrastructure.mock.JsonStateStore;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Map;
import java.util.UUID;

/** Records observations, not expected values. Independent directory for every test run. */
public final class ReliabilityEvidence {
    public final Path directory;
    public ReliabilityEvidence(String scenario) throws IOException {
        Path project = Path.of(System.getProperty("contentops.project", System.getProperty("user.dir"))).toAbsolutePath().normalize();
        String configured = System.getenv("CONTENTOPS_RELIABILITY_EVIDENCE");
        Path base = configured == null ? project.resolve("target/reliability-review-evidence") : Path.of(configured).toAbsolutePath().normalize();
        if (!base.startsWith(project.resolve("evidence/reliability-review"))
                && !base.startsWith(project.resolve("target/reliability-review-evidence"))) {
            throw new IllegalArgumentException("Test evidence must stay within the project review directories");
        }
        Files.createDirectories(base);
        directory = Files.createDirectory(base.resolve(scenario + "-" + UUID.randomUUID()));
        write("origin.json", Map.of("scenario", scenario, "captured_at", Instant.now().toString(),
                "source", "controlled Java test against real local Mock snapshot", "production_incident", false));
    }
    public void write(String name, Object value) throws IOException {
        Files.write(directory.resolve(name), JsonSupport.create().writerWithDefaultPrettyPrinter().writeValueAsBytes(value), StandardOpenOption.CREATE_NEW);
    }
    public static String sha(byte[] bytes) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
        catch (java.security.NoSuchAlgorithmException impossible) { throw new AssertionError(impossible); }
    }
    public ObjectNode snapshot(String name, Path state) throws IOException {
        var json = JsonSupport.create();
        var data = new JsonStateStore(state, json).read();
        ObjectNode facts = json.createObjectNode();
        boolean exists = Files.exists(state.resolve("state.json"));
        facts.put("exists", exists);
        if (exists) {
            byte[] bytes = Files.readAllBytes(state.resolve("state.json"));
            facts.put("sha256", sha(bytes));
            facts.set("revision", json.readTree(bytes).get("revision"));
        } else { facts.put("revision", 0); }
        for (var content : data.withArray("contents")) {
            if ("ct_000004".equals(content.path("content_id").asText())) { facts.set("content", content.deepCopy()); }
        }
        facts.set("history", data.path("review_logs").path("ct_000004").deepCopy());
        facts.set("markers", data.path("_reliability_markers").deepCopy());
        write(name, facts);
        return facts;
    }
}
