package com.example.contentops.support;

import com.example.contentops.infrastructure.JsonSupport;
import com.example.contentops.infrastructure.mock.JsonStateStore;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;

/** Test-only separate JVM probe: changes synthetic markers, never review status or tags. */
public final class StateStoreProbe {
    public static void main(String[] args) throws Exception {
        Path directory = Path.of(args[1]);
        var json = JsonSupport.create();
        var store = new JsonStateStore(directory, json);
        switch (args[0]) {
            case "put" -> {
                store.update(data -> { data.withObject("_storage_test").put(args[2], args[3]); return null; });
                System.out.println(json.writeValueAsString(store.read().get("_storage_test")));
            }
            case "read" -> System.out.println(json.writeValueAsString(store.read().get("_storage_test")));
            case "title-fixture" -> {
                store.update(data -> {
                    ((com.fasterxml.jackson.databind.node.ObjectNode) data.get("contents").get(3))
                            .put("title", "跨 JVM 只读查询测试标记");
                    return null;
                });
            }
            case "hold-lock" -> {
                Files.createDirectories(directory);
                try (var channel = FileChannel.open(directory.resolve("state.lock"),
                        StandardOpenOption.CREATE, StandardOpenOption.WRITE);
                     var lock = channel.lock()) {
                    Files.writeString(Path.of(args[2]), "ready");
                    long deadline = System.nanoTime() + java.time.Duration.ofSeconds(15).toNanos();
                    while (!Files.exists(Path.of(args[3])) && System.nanoTime() < deadline) { Thread.sleep(20); }
                    if (!lock.isValid()) { throw new IllegalStateException("lock lost"); }
                }
            }
            default -> throw new IllegalArgumentException("unknown test probe mode");
        }
    }
}
