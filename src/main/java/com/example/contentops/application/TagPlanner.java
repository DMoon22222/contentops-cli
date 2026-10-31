package com.example.contentops.application;

import com.example.contentops.model.ContentModels.TagItem;
import com.example.contentops.model.OperationModels.TagChange;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;

public final class TagPlanner {
    public record PlannedTags(TagChange change, List<String> warnings) {
        public PlannedTags { warnings = List.copyOf(warnings); }
    }

    public PlannedTags add(List<String> before, List<TagItem> library, List<String> requested) {
        if (requested == null || requested.isEmpty()) {
            throw new OperationRejected("MISSING_TAG_CHANGE", "必须提供至少一个 --add；本阶段不支持 remove/set");
        }
        var additions = new LinkedHashSet<String>();
        var warnings = new ArrayList<String>();
        for (String value : requested) {
            String tag = strip(value);
            if (tag == null || tag.isEmpty() || tag.codePoints().anyMatch(Character::isISOControl)) {
                throw new OperationRejected("INVALID_TAG", "标签去除首尾空白后不得为空或包含控制字符");
            }
            if (!additions.add(tag)) { warnings.add("重复的 --add 已去重：" + tag); }
        }
        var after = new ArrayList<>(before); // Preserve existing values and order, including anomalies.
        for (String tag : additions) {
            if (before.contains(tag)) { continue; }
            var matches = library.stream().filter(item -> tag.equals(item.tag())).toList();
            if (matches.isEmpty()) { throw new OperationRejected("UNKNOWN_TAG", "新增标签不在标签库中：" + tag); }
            if (matches.stream().anyMatch(item -> !"active".equals(item.status()))) {
                throw new OperationRejected("INACTIVE_TAG", "新增标签必须为 active：" + tag);
            }
            after.add(tag);
        }
        if (after.isEmpty()) { throw new OperationRejected("EMPTY_TAGS_NOT_SUPPORTED", "本阶段不支持清空全部标签"); }
        for (String tag : new LinkedHashSet<>(before)) {
            if (library.stream().noneMatch(item -> tag.equals(item.tag()))) { warnings.add("保留存量未知标签：" + tag); }
            else if (library.stream().anyMatch(item -> tag.equals(item.tag()) && !"active".equals(item.status()))) {
                warnings.add("保留存量废弃标签：" + tag);
            }
        }
        return new PlannedTags(new TagChange(before, after), warnings);
    }

    static String strip(String value) {
        if (value == null) { return null; }
        int start = 0, end = value.length();
        while (start < end && space(value.codePointAt(start))) { start += Character.charCount(value.codePointAt(start)); }
        while (end > start && space(value.codePointBefore(end))) { end -= Character.charCount(value.codePointBefore(end)); }
        return value.substring(start, end);
    }
    private static boolean space(int codePoint) { return Character.isWhitespace(codePoint) || Character.isSpaceChar(codePoint); }
}
