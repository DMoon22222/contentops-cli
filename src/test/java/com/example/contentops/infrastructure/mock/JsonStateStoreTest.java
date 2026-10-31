package com.example.contentops.infrastructure.mock;

import com.example.contentops.gateway.GatewayFailure;
import com.example.contentops.infrastructure.JsonSupport;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import static org.junit.jupiter.api.Assertions.*;

class JsonStateStoreTest {
    @TempDir Path temporary;
    ObjectMapper json;
    JsonStateStore store;
    Path directory;

    @BeforeEach void setup() {
        json = JsonSupport.create();
        directory = temporary.resolve("working");
        store = new JsonStateStore(directory, json);
    }

    @Test void freshReadDoesNotCreateBusinessState() {
        ObjectNode data = store.read();
        assertEquals(300, data.get("contents").size());
        assertEquals(40, data.get("creators").size());
        assertEquals(174, data.get("review_logs").size());
        assertEquals(30, data.get("reports").size());
        assertEquals(6, data.get("promo_slots").size());
        assertEquals(25, data.get("tags").size());
        assertEquals(3, data.get("categories").size());
        assertTrue(data.has("_note"));
        assertFalse(Files.exists(directory.resolve("state.json")));
    }

    @Test void returnedTreeDoesNotMutateSeed() {
        store.read().put("_test_marker", "in-memory only");
        assertFalse(store.read().has("_test_marker"));
        assertFalse(Files.exists(directory.resolve("state.json")));
    }

    @Test void commitsCompleteSnapshotAndPreservesEveryBusinessField() throws Exception {
        ObjectNode before = store.read();
        store.update(data -> { data.put("_test_marker", "storage-test"); return null; });
        ObjectNode after = store.read();
        assertEquals("storage-test", after.remove("_test_marker").asText());
        assertEquals(before, after, "Storage tests must not change review status, tags, or any original field");
        var snapshot = json.readTree(Files.readAllBytes(directory.resolve("state.json")));
        assertEquals(1, snapshot.get("revision").asLong());
        assertEquals(1, snapshot.get("state_schema_version").asInt());
        assertEquals("44ba17cbe95432547a8fe380f81e0416ae51404957ed0c87de5ced7f8e3939b0",
                snapshot.get("seed_sha256").asText());
    }

    @Test void eachReadLoadsTheLatestSnapshot() {
        store.read();
        var otherStore = new JsonStateStore(directory, json);
        otherStore.update(data -> { data.put("_test_marker", "second instance"); return null; });
        assertEquals("second instance", store.read().get("_test_marker").asText());
    }

    @Test void atomicCreationAndReplacementWorkOnThisFilesystem() throws Exception {
        store.update(data -> { data.put("_test_marker", "first"); return null; });
        store.update(data -> { data.put("_test_marker", "second"); return null; });
        assertEquals("second", store.read().get("_test_marker").asText());
        assertEquals(2, json.readTree(Files.readAllBytes(directory.resolve("state.json"))).get("revision").asLong());
        try (var files = Files.list(directory)) {
            assertEquals(0, files.filter(p -> p.toString().endsWith(".tmp")).count());
        }
        assertTrue(Files.isRegularFile(directory.resolve("state.lock")));
    }

    @Test void corruptStateDoesNotFallBackToSeed() throws Exception {
        Files.createDirectories(directory);
        Files.writeString(directory.resolve("state.json"), "{truncated");
        GatewayFailure error = assertThrows(GatewayFailure.class, store::read);
        assertEquals("STATE_INVALID", error.code());
        assertEquals(GatewayFailure.Kind.READ_FAILURE, error.kind());
        assertEquals("{truncated", Files.readString(directory.resolve("state.json")));
    }

    @ParameterizedTest @ValueSource(strings = {"seed_sha256", "state_schema_version", "revision", "data"})
    void invalidMetadataOrStructureIsNotReset(String field) throws Exception {
        store.update(data -> null);
        Path file = directory.resolve("state.json");
        ObjectNode snapshot = (ObjectNode) json.readTree(Files.readAllBytes(file));
        switch (field) {
            case "seed_sha256" -> snapshot.put(field, "wrong-seed");
            case "state_schema_version" -> snapshot.put(field, 2);
            case "revision" -> snapshot.put(field, -1);
            case "data" -> snapshot.withObject(field).remove("creators");
            default -> fail("unexpected test case");
        }
        byte[] invalid = json.writeValueAsBytes(snapshot);
        Files.write(file, invalid);
        assertEquals("STATE_INVALID", assertThrows(GatewayFailure.class, store::read).code());
        assertArrayEquals(invalid, Files.readAllBytes(file));
    }

    @Test void callbackFailureCannotPartiallyCommit() throws Exception {
        store.update(data -> { data.put("_test_marker", "before"); return null; });
        Path file = directory.resolve("state.json");
        byte[] before = Files.readAllBytes(file);
        GatewayFailure error = assertThrows(GatewayFailure.class, () -> store.update(data -> {
            data.put("_test_marker", "must not commit");
            throw new IllegalStateException("controlled storage failure before commit");
        }));
        assertEquals(GatewayFailure.Kind.REJECTED_NO_COMMIT, error.kind());
        assertArrayEquals(before, Files.readAllBytes(file));
    }

    @Test void heldFileLockTimesOutWithoutChangingBusinessState() throws Exception {
        Files.createDirectories(directory);
        try (var channel = FileChannel.open(directory.resolve("state.lock"),
                StandardOpenOption.CREATE, StandardOpenOption.WRITE);
             var lock = channel.lock()) {
            GatewayFailure error = assertThrows(GatewayFailure.class, store::read);
            assertEquals("STATE_LOCK_TIMEOUT", error.code());
            assertTrue(lock.isValid());
            assertFalse(Files.exists(directory.resolve("state.json")));
        }
        assertEquals(300, store.read().get("contents").size());
    }

    @Test void duplicateKeysAreRejected() throws Exception {
        Files.createDirectories(directory);
        Files.writeString(directory.resolve("state.json"), "{\"revision\":0,\"revision\":1}");
        assertEquals("STATE_INVALID", assertThrows(GatewayFailure.class, store::read).code());
    }

    @Test void originalAttachmentDirectoryIsRefusedWithoutCreatingIt() {
        Path protectedPath = temporary.resolve("内容运营后台接口数据").resolve("working");
        var unsafe = new JsonStateStore(protectedPath, json);
        assertThrows(GatewayFailure.class, unsafe::read);
        assertFalse(Files.exists(protectedPath));
    }
}
