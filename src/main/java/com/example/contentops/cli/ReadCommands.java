package com.example.contentops.cli;

import picocli.CommandLine.Command;
import picocli.CommandLine.Option;
import picocli.CommandLine.Parameters;
import java.util.concurrent.Callable;

public final class ReadCommands {
    private ReadCommands() { }

    public abstract static class ReadCommand implements Callable<Integer> {
        protected final CliRunner runner;
        private final String name;
        protected ReadCommand(CliRunner runner, String name) { this.runner = runner; this.name = name; }
        public String canonicalName() { return name; }
    }

    @Command(name = "list", description = "单页查询内容；条件为 AND，固定每页 20 条", mixinStandardHelpOptions = true)
    public static final class ListContents extends ReadCommand {
        @Option(names = "--review-status", paramLabel = "pending|approved|rejected") String reviewStatus;
        @Option(names = "--page", defaultValue = "1", description = "页码（>=1）") int page;
        @Option(names = "--content-id", description = "精确筛选一个 ID") String contentId;
        public ListContents(CliRunner runner) { super(runner, "content.list"); }
        @Override public Integer call() {
            return runner.read(canonicalName(), null, () -> runner.service().list(contentId, reviewStatus, page));
        }
    }

    @Command(name = "get", description = "读取详情及当前实际状态", mixinStandardHelpOptions = true)
    public static final class GetContent extends ReadCommand {
        @Parameters(index = "0", paramLabel = "<content-id>") String contentId;
        public GetContent(CliRunner runner) { super(runner, "content.get"); }
        @Override public Integer call() {
            return runner.read(canonicalName(), contentId, () -> runner.service().get(contentId));
        }
    }

    @Command(name = "history", description = "完整审核/处置历史，按时间倒序展示", mixinStandardHelpOptions = true)
    public static final class History extends ReadCommand {
        @Parameters(index = "0", paramLabel = "<content-id>") String contentId;
        public History(CliRunner runner) { super(runner, "content.history"); }
        @Override public Integer call() {
            return runner.read(canonicalName(), contentId, () -> runner.service().history(contentId));
        }
    }

    @Command(name = "list", description = "标签库本地过滤；默认仅 active", mixinStandardHelpOptions = true)
    public static final class ListTags extends ReadCommand {
        @Option(names = "--status", defaultValue = "active", paramLabel = "active|all") String status;
        public ListTags(CliRunner runner) { super(runner, "tags.list"); }
        @Override public Integer call() {
            return runner.read(canonicalName(), null, () -> runner.service().tags(status));
        }
    }
}
