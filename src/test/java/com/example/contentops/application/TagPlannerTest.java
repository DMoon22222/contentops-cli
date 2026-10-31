package com.example.contentops.application;

import com.example.contentops.model.ContentModels.TagItem;
import org.junit.jupiter.api.Test;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class TagPlannerTest {
    TagPlanner planner = new TagPlanner();
    List<TagItem> library = List.of(new TagItem("新增", "test", 1, "active"), new TagItem("废弃", "test", 1, "deprecated"), new TagItem("one,two", "test", 1, "active"));
    @Test void trimsAndDeduplicatesInputsButPreservesExistingOrderAndDuplicateData() {
        var result = planner.add(List.of("旧值", "旧值", "废弃"), library, List.of(" 新增 ", "新增"));
        assertEquals(List.of("旧值", "旧值", "废弃", "新增"), result.change().after());
        assertEquals(3, result.warnings().size());
    }
    @Test void existingDeprecatedOrUnknownTagsCanBeRetainedWithoutAddingAnything() {
        var result = planner.add(List.of("废弃", "未知"), library, List.of("废弃", "未知"));
        assertFalse(result.change().hasChanges()); assertEquals(2, result.warnings().size());
    }
    @Test void newlyAddedUnknownOrDeprecatedTagsAreRejected() {
        assertEquals("UNKNOWN_TAG", assertThrows(OperationRejected.class, () -> planner.add(List.of("旧"), library, List.of("未知"))).code());
        assertEquals("INACTIVE_TAG", assertThrows(OperationRejected.class, () -> planner.add(List.of("旧"), library, List.of("废弃"))).code());
    }
    @Test void invalidInputsAreRejectedBeforeNoChangeCheck() {
        for (String value : List.of("", " ", "\u00a0", "含\n换行")) {
            assertThrows(OperationRejected.class, () -> planner.add(List.of("新增"), library, List.of(value)));
        }
        assertThrows(OperationRejected.class, () -> planner.add(List.of(), library, List.of()));
    }
    @Test void commasAreLiteralTagCharactersNotSeparators() {
        assertEquals(List.of("one,two"), planner.add(List.of(), library, List.of("one,two")).change().after());
    }
}
