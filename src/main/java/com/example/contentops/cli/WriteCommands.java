package com.example.contentops.cli;

import com.example.contentops.model.OperationModels.OperationKind;
import com.example.contentops.model.OperationModels.WriteSpec;
import picocli.CommandLine.Command;
import picocli.CommandLine.Mixin;
import picocli.CommandLine.Option;
import picocli.CommandLine.Parameters;
import java.util.List;
import java.util.concurrent.Callable;

public final class WriteCommands {
    private WriteCommands() { }

    static final class ExecutionOptions {
        @Option(names = "--execute", description = "执行计划；单次模式需 --yes，Shell 可人工确认") boolean execute;
        @Option(names = "--yes", description = "显式授权本次执行；必须与 --execute 同时提供") boolean yes;
    }
    public abstract static class WriteCommand implements Callable<Integer> {
        protected final CliRunner runner;
        private final String name;
        @Parameters(index = "0", paramLabel = "<content-id>") String contentId;
        @Mixin ExecutionOptions authorization = new ExecutionOptions();
        protected WriteCommand(CliRunner runner, String name) { this.runner = runner; this.name = name; }
        public String canonicalName() { return name; }
        protected int run(OperationKind kind, String action, String reason, List<String> add) {
            return runner.write(name, new WriteSpec(kind, contentId, action, reason, add), authorization.execute, authorization.yes);
        }
    }

    @Command(name = "review", description = "单条 pending 审核；默认预览，驳回必须提供理由", mixinStandardHelpOptions = true)
    public static final class Review extends WriteCommand {
        @Option(names = "--action", required = true, paramLabel = "approve|reject") String action;
        @Option(names = "--reason", description = "人工审核理由；reject 时必填") String reason;
        public Review(CliRunner runner) { super(runner, "content.review"); }
        @Override public Integer call() { return run(OperationKind.REVIEW, action, reason, List.of()); }
    }

    @Command(name = "update", description = "新增标签并保留存量标签；默认预览，本阶段只支持 --add", mixinStandardHelpOptions = true)
    public static final class UpdateTags extends WriteCommand {
        @Option(names = "--add", required = true, arity = "1", paramLabel = "<tag>", description = "可重复；不按逗号拆分") List<String> add;
        public UpdateTags(CliRunner runner) { super(runner, "content.tags.update"); }
        @Override public Integer call() { return run(OperationKind.TAGS, null, null, add); }
    }

    @Command(name = "process", description = "单条审核后更新标签，分步回读核对；默认预览", mixinStandardHelpOptions = true)
    public static final class Process extends WriteCommand {
        @Option(names = "--action", required = true, paramLabel = "approve|reject") String action;
        @Option(names = "--reason", description = "人工审核理由；reject 时必填") String reason;
        @Option(names = "--add", required = true, arity = "1", paramLabel = "<tag>", description = "可重复，新增必须为 active") List<String> add;
        public Process(CliRunner runner) { super(runner, "content.process"); }
        @Override public Integer call() { return run(OperationKind.PROCESS, action, reason, add); }
    }
}
