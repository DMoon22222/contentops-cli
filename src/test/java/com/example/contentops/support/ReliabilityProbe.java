package com.example.contentops.support;

import com.example.contentops.application.ContentService;
import com.example.contentops.cli.CliRunner;
import com.example.contentops.infrastructure.JsonSupport;
import com.example.contentops.infrastructure.mock.JsonMockGateway;
import com.example.contentops.infrastructure.mock.JsonStateStore;
import com.example.contentops.model.ContentModels.*;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Test classpath only. Adds barriers, not production commands or business rules. */
public final class ReliabilityProbe {
    static void await(Path file) {
        long deadline = System.nanoTime() + Duration.ofSeconds(25).toNanos();
        while (!Files.exists(file)) {
            if (System.nanoTime() >= deadline) { throw new IllegalStateException("test barrier timed out: " + file); }
            try { Thread.sleep(10); } catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new IllegalStateException(e); }
        }
    }
    static void ready(Path coord, String actor, String stage, Object facts) {
        try {
            Files.createDirectories(coord);
            var json = JsonSupport.create();
            Path pending = coord.resolve(actor + "." + stage + ".writing");
            Files.write(pending, json.writeValueAsBytes(Map.of(
                    "actor", actor, "pid", ProcessHandle.current().pid(), "stage", stage,
                    "at", Instant.now().toString(), "facts", facts)));
            Files.move(pending, coord.resolve(actor + "." + stage + ".json"), java.nio.file.StandardCopyOption.ATOMIC_MOVE);
        } catch (java.io.IOException e) { throw new IllegalStateException(e); }
    }
    public static void main(String[] args) throws Exception {
        String mode = args[0], actor = args[3];
        Path state = Path.of(args[1]), coord = Path.of(args[2]);
        var json = JsonSupport.create();
        var store = new JsonStateStore(state, json);
        if (mode.equals("markers")) {
            ready(coord, actor, "ready", "waiting for explicit start gate");
            await(coord.resolve("start"));
            for (int i = 0; i < 20; i++) {
                int number = i;
                store.update(data -> { data.withObject("_reliability_markers").put(actor + "-" + number, number); return null; });
                if (i == 9) {
                    ready(coord, actor, "mid", "10 complete commits, waiting outside the lock");
                    await(coord.resolve("finish"));
                }
            }
            System.out.println(json.writeValueAsString(Map.of("source", "test-only-storage-probe", "actor", actor, "commits", 20,
                    "contents", store.read().withArray("contents").size())));
            return;
        }
        if (!List.of("review-gate", "tags-gate").contains(mode)) { throw new IllegalArgumentException("unknown test probe mode"); }
        var actual = new JsonMockGateway(store, json);
        var gated = new ForwardingGateway(actual) {
            int reads;
            @Override public ContentDetail getContent(String id) { reads++; return super.getContent(id); }
            private void gate(String operation, Object request) {
                ready(coord, actor, "ready", Map.of("operation", operation, "detail_reads_before_write", reads,
                        "current", actual.getContent("ct_000004"), "request", request));
                await(coord.resolve(actor + ".release"));
            }
            @Override public ReviewCounts submitReviews(List<ReviewItem> items) {
                if (mode.equals("review-gate")) { gate("submitReviews after service preflight", items); }
                return super.submitReviews(items);
            }
            @Override public TagAck replaceTags(String id, List<String> tags) {
                if (mode.equals("tags-gate")) { gate("replaceTags after service preflight", tags); }
                return super.replaceTags(id, tags);
            }
        };
        var env = new HashMap<>(System.getenv());
        env.put("CONTENTOPS_STATE_DIR", state.toString()); env.remove("CONTENTOPS_MOCK_SCENARIO");
        var out = new PrintWriter(new OutputStreamWriter(System.out, StandardCharsets.UTF_8), true);
        var err = new PrintWriter(new OutputStreamWriter(System.err, StandardCharsets.UTF_8), true);
        var runner = new CliRunner(env, out, err, json, config -> new ContentService(gated));
        System.exit(runner.run(Arrays.copyOfRange(args, 4, args.length)));
    }
}
