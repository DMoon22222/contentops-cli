package com.example.contentops.cli;

import com.example.contentops.model.ContentModels.*;
import com.example.contentops.model.ResultModels.CliResult;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.PrintWriter;

public final class ResultRenderer {
    private final ObjectMapper json;
    private final PrintWriter out;
    private final PrintWriter err;
    public ResultRenderer(ObjectMapper json, PrintWriter out, PrintWriter err) {
        this.json = json; this.out = out; this.err = err;
    }

    public int render(CliResult<?> result, String output) {
        try {
            if ("json".equals(output)) {
                String serialized = json.writeValueAsString(result);
                out.println(serialized);
            } else if (result.error() != null) {
                out.printf("结果: %s / %d%n错误: %s%n说明: %s%n", result.status(), result.exitCode(),
                        result.error().code(), result.error().message());
            } else {
                out.printf("环境: %s | 命令: %s | 模式: %s%n", result.environment(), result.command(), result.mode());
                renderData(result.data());
            }
            out.flush();
            if (result.error() != null) { err.printf("%s: %s%n", result.error().code(), result.error().message()); }
            if (out.checkError()) { err.println("结果输出失败；本次输出不可信"); return 1; }
            return result.exitCode();
        } catch (JsonProcessingException failure) {
            err.println("结果序列化失败；未提供可信结果");
            return 1;
        }
    }

    private void renderData(Object data) {
        if (data instanceof ContentListView list) {
            out.printf("第 %d 页 | 每页 %d 条 | 匹配 %d 条%n", list.page(), list.pageSize(), list.total());
            out.println("ID\t审核\t质量\t可见性\t标签\t标题");
            for (var item : list.items()) {
                out.printf("%s\t%s\t%s\t%s\t%s\t%s%n", item.contentId(), item.reviewStatus(), item.qualityStatus(),
                        item.visibility(), cell(String.join("、", item.tags())), cell(item.title()));
            }
            if (list.items().isEmpty()) { out.println("本页无内容"); }
        } else if (data instanceof ContentDetail content) {
            out.printf("ID: %s%n标题: %s%n创作者: %s%n审核: %s%n质量: %s%n可见性: %s%n",
                    content.contentId(), content.title(), content.creatorId(), content.reviewStatus(), content.qualityStatus(), content.visibility());
            out.printf("标签: %s%n创建时间: %s%n来源: %s%n渠道: %s%n栏目: %s%n正文:%n%s%n",
                    String.join("、", content.tags()), content.createdAt(), content.source(), String.join("、", content.channels()),
                    content.categoryId(), content.body() == null || content.body().isEmpty() ? "（正文为空）" : content.body());
        } else if (data instanceof HistoryView history) {
            out.printf("内容: %s | 历史 %d 条%n", history.contentId(), history.items().size());
            out.println("时间\t动作\t操作人\t原因");
            for (var log : history.items()) {
                out.printf("%s\t%s\t%s\t%s%n", log.createdAt(), log.action(), log.operatorId(), cell(log.reason()));
            }
            if (history.items().isEmpty()) { out.println("暂无历史记录"); }
        } else if (data instanceof TagListView tags) {
            out.printf("标签 %d 个%n标签\t分组\t状态\t使用量（源数据口径）%n", tags.total());
            for (var tag : tags.items()) {
                out.printf("%s\t%s\t%s\t%d%n", cell(tag.tag()), tag.group(), tag.status(), tag.usageCount());
            }
        }
    }

    private static String cell(String value) {
        return value == null ? "" : value.replace("\r", "\\r").replace("\n", "\\n").replace("\t", "\\t").replace("\u001b", "\\u001b");
    }
}
