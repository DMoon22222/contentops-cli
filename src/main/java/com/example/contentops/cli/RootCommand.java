package com.example.contentops.cli;

import picocli.CommandLine;
import picocli.CommandLine.Command;
import picocli.CommandLine.Option;
import picocli.CommandLine.Spec;
import picocli.CommandLine.Model.CommandSpec;
import java.util.concurrent.Callable;

@Command(name = "contentops", description = "内容运营后台 CLI：单条 Mock 审核与标签维护",
        mixinStandardHelpOptions = true, version = "contentops 0.1.0",
        footer = "写命令默认预览；原型执行必须同时提供 --execute --yes，不等待人工输入。HTTP 尚未实现。")
public final class RootCommand implements Callable<Integer> {
    @Option(names = "--env", scope = CommandLine.ScopeType.INHERIT, defaultValue = "mock",
            paramLabel = "mock|api", description = "数据源；api 尚未实现，会明确拒绝")
    String environment = "mock";
    @Option(names = "--output", scope = CommandLine.ScopeType.INHERIT, defaultValue = "table",
            paramLabel = "table|json", description = "输出格式（默认 table）")
    String output = "table";
    @Option(names = "--non-interactive", scope = CommandLine.ScopeType.INHERIT,
            description = "禁止交互；当前原型均不读取 stdin，执行需 --execute --yes")
    boolean nonInteractive;
    @Spec CommandSpec spec;

    @Override public Integer call() { throw new CommandLine.ParameterException(spec.commandLine(), "请提供子命令，使用 --help 查看用法"); }

    @Command(name = "content", description = "查询、单条审核及标签维护", mixinStandardHelpOptions = true)
    public static final class ContentGroup implements Callable<Integer> {
        @Spec CommandSpec spec;
        @Override public Integer call() { throw new CommandLine.ParameterException(spec.commandLine(), "请提供 content 子命令"); }
    }
    @Command(name = "tags", description = "维护一条内容的标签", mixinStandardHelpOptions = true)
    public static final class ContentTagsGroup implements Callable<Integer> {
        @Spec CommandSpec spec;
        @Override public Integer call() { throw new CommandLine.ParameterException(spec.commandLine(), "请提供 content tags update"); }
    }
    @Command(name = "tags", description = "查询标签库", mixinStandardHelpOptions = true)
    public static final class TagsGroup implements Callable<Integer> {
        @Spec CommandSpec spec;
        @Override public Integer call() { throw new CommandLine.ParameterException(spec.commandLine(), "请提供 tags 子命令"); }
    }
}
