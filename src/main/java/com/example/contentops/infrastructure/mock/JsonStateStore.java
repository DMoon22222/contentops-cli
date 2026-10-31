package com.example.contentops.infrastructure.mock;

import com.example.contentops.gateway.GatewayFailure;
import com.example.contentops.gateway.GatewayFailure.Kind;
import com.example.contentops.infrastructure.AppConfig;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.channels.OverlappingFileLockException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.function.Function;

public final class JsonStateStore {
    private final Path directory;
    private final ObjectMapper json;
    private final ObjectNode seed;
    private final String seedSha;

    public JsonStateStore(Path directory, ObjectMapper json) {
        this.directory = directory;
        this.json = json;
        try (var stream = JsonStateStore.class.getResourceAsStream("/seed/mock_data.json")) {
            if (stream == null) { throw new IOException("missing seed resource"); }
            byte[] bytes = stream.readAllBytes();
            seed = object(json.readTree(bytes));
            validateData(seed);
            seedSha = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (IOException | NoSuchAlgorithmException | IllegalArgumentException e) {
            throw new GatewayFailure(Kind.READ_FAILURE, "SEED_UNAVAILABLE", "无法读取完整的只读 seed 资源", e);
        }
    }

    public ObjectNode read() {
        return locked(false, () -> load().withObject("data").deepCopy());
    }

    /** One local snapshot commit, never a transaction across business API calls. */
    public <T> T update(Function<ObjectNode, T> mutation) {
        return update(mutation, false);
    }

    /** An all-failed review batch must not create a business snapshot. */
    public <T> T updateIfChanged(Function<ObjectNode, T> mutation) {
        return update(mutation, true);
    }

    private <T> T update(Function<ObjectNode, T> mutation, boolean skipUnchanged) {
        return locked(true, () -> {
            ObjectNode snapshot = load();
            ObjectNode data = snapshot.withObject("data").deepCopy();
            T result = mutation.apply(data);
            validateData(data);
            if (skipUnchanged && data.equals(snapshot.get("data"))) { return result; }
            snapshot.set("data", data);
            snapshot.put("revision", Math.addExact(snapshot.get("revision").longValue(), 1));
            byte[] bytes = json.writerWithDefaultPrettyPrinter().writeValueAsBytes(snapshot);
            probeAtomicReplacement();
            Path temporary = directory.resolve("state." + UUID.randomUUID() + ".tmp");
            boolean moveAttempted = false;
            try {
                try (FileChannel channel = FileChannel.open(temporary,
                        StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)) {
                    ByteBuffer buffer = ByteBuffer.wrap(bytes);
                    while (buffer.hasRemaining()) { channel.write(buffer); }
                    channel.force(true);
                }
                moveAttempted = true;
                Files.move(temporary, directory.resolve("state.json"), StandardCopyOption.ATOMIC_MOVE);
                return result;
            } catch (IOException e) {
                throw new GatewayFailure(moveAttempted ? Kind.WRITE_UNKNOWN : Kind.REJECTED_NO_COMMIT,
                        moveAttempted ? "STATE_COMMIT_UNKNOWN" : "STATE_WRITE_FAILED",
                        moveAttempted ? "工作快照提交结果未知；禁止自动重试" : "工作快照未提交", e);
            } finally {
                try { Files.deleteIfExists(temporary); } catch (IOException | RuntimeException ignored) { /* Never mask commit outcome. */ }
            }
        });
    }

    private ObjectNode load() throws IOException {
        Path file = directory.resolve("state.json");
        rejectLink(file);
        if (!Files.exists(file, LinkOption.NOFOLLOW_LINKS)) {
            ObjectNode fresh = json.createObjectNode();
            fresh.put("state_schema_version", 1).put("seed_sha256", seedSha).put("revision", 0);
            fresh.set("data", seed.deepCopy());
            return fresh;
        }
        try {
            ObjectNode snapshot = object(json.readTree(Files.readAllBytes(file)));
            JsonNode version = snapshot.get("state_schema_version");
            JsonNode revision = snapshot.get("revision");
            if (version == null || !version.isInt() || version.intValue() != 1
                    || !seedSha.equals(snapshot.path("seed_sha256").asText())
                    || revision == null || !revision.isIntegralNumber()
                    || !revision.canConvertToLong() || revision.longValue() < 0) {
                throw new IllegalArgumentException("snapshot metadata mismatch");
            }
            validateData(object(snapshot.get("data")));
            return snapshot;
        } catch (IOException | IllegalArgumentException e) {
            throw new GatewayFailure(Kind.READ_FAILURE, "STATE_INVALID",
                    "工作状态损坏或 seed/版本不匹配；不会静默回退 seed", e);
        }
    }

    private <T> T locked(boolean writing, Callable<T> operation) {
        Kind failureKind = writing ? Kind.REJECTED_NO_COMMIT : Kind.READ_FAILURE;
        boolean operationCompleted = false;
        try {
            Path validated = AppConfig.validateStateDirectory(directory);
            if (!validated.equals(directory.normalize())) { throw new IOException("state path changed"); }
            Files.createDirectories(directory);
            Path lockFile = directory.resolve("state.lock");
            rejectLink(lockFile);
            try (FileChannel channel = FileChannel.open(lockFile, StandardOpenOption.CREATE, StandardOpenOption.WRITE);
                 FileLock ignored = acquire(channel, failureKind)) {
                T result = operation.call();
                operationCompleted = true;
                return result;
            }
        } catch (GatewayFailure e) {
            throw e;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new GatewayFailure(failureKind, "STATE_INTERRUPTED", "工作状态访问被中断", e);
        } catch (Exception e) {
            if (writing && operationCompleted) {
                throw new GatewayFailure(Kind.WRITE_UNKNOWN, "STATE_COMMIT_UNKNOWN", "提交后的资源释放失败；禁止自动重试", e);
            }
            throw new GatewayFailure(failureKind, "STATE_ACCESS_FAILED", "无法访问工作状态目录或完整快照", e);
        }
    }

    private FileLock acquire(FileChannel channel, Kind kind) throws IOException, InterruptedException {
        long deadline = System.nanoTime() + Duration.ofSeconds(2).toNanos();
        while (true) {
            try {
                FileLock lock = channel.tryLock();
                if (lock != null) { return lock; }
            } catch (OverlappingFileLockException ignored) { /* Another store in this JVM holds the lock. */ }
            if (System.nanoTime() >= deadline) {
                throw new GatewayFailure(kind, "STATE_LOCK_TIMEOUT", "工作状态正被其他操作占用；本次未取得锁");
            }
            Thread.sleep(20);
        }
    }

    private void probeAtomicReplacement() throws IOException {
        Path source = Files.createTempFile(directory, "atomic-probe-", ".tmp");
        Path target = directory.resolve("atomic-probe-" + UUID.randomUUID() + ".tmp");
        Path replacement = null;
        try {
            Files.writeString(source, "first");
            Files.move(source, target, StandardCopyOption.ATOMIC_MOVE);
            replacement = Files.createTempFile(directory, "atomic-probe-", ".tmp");
            Files.writeString(replacement, "second");
            Files.move(replacement, target, StandardCopyOption.ATOMIC_MOVE);
            if (!"second".equals(Files.readString(target))) { throw new IOException("atomic replace check failed"); }
        } finally {
            Files.deleteIfExists(source);
            Files.deleteIfExists(target);
            if (replacement != null) { Files.deleteIfExists(replacement); }
        }
    }

    private static ObjectNode object(JsonNode value) {
        if (!(value instanceof ObjectNode object)) { throw new IllegalArgumentException("object required"); }
        return object;
    }

    private static void validateData(ObjectNode data) {
        for (String field : List.of("contents", "creators", "reports", "promo_slots", "tags", "categories")) {
            if (!data.path(field).isArray()) { throw new IllegalArgumentException("missing array: " + field); }
        }
        if (!data.path("review_logs").isObject()) { throw new IllegalArgumentException("missing review logs"); }
    }

    private static void rejectLink(Path path) throws IOException {
        if (Files.isSymbolicLink(path)) { throw new IOException("symbolic state/lock file not allowed"); }
    }
}
