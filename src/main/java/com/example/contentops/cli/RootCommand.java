package com.example.contentops.cli;

import picocli.CommandLine;
import picocli.CommandLine.Command;
import picocli.CommandLine.Option;
import picocli.CommandLine.Spec;
import picocli.CommandLine.Model.CommandSpec;
import java.util.concurrent.Callable;

@Command(name = "contentops", description = "内容运营后台 CLI：S0–S2 只读 Mock 查询",
        mixinStandardHelpOptions = true, version = "contentops 0.1.0",
        footer = "本阶段未开放审核、标签写入、process 或 HTTP；业务状态不会因查询而修改。")
public final class RootCommand implements Callable<Integer> {
    @Option(names = "--env", scope = CommandLine.ScopeType.INHERIT, defaultValue = "mock",
            paramLabel = "mock|api", description = "数据源；api 尚未实现，会明确拒绝")
    String environment = "mock";
    @Option(names = "--output", scope = CommandLine.ScopeType.INHERIT, defaultValue = "table",
            paramLabel = "table|json", description = "输出格式（默认 table）")
    String output = "table";
    @Option(names = "--non-interactive", scope = CommandLine.ScopeType.INHERIT,
            description = "禁止交互；本阶段所有命令均只读且不读取 stdin")
    boolean nonInteractive;
    @Spec CommandSpec spec;

    @Override public Integer call() { throw new CommandLine.ParameterException(spec.commandLine(), "请提供子命令，使用 --help 查看用法"); }

    @Command(name = "content", description = "查询内容列表、详情和历史", mixinStandardHelpOptions = true)
    public static final class ContentGroup implements Callable<Integer> {
        @Spec CommandSpec spec;
        @Override public Integer call() { throw new CommandLine.ParameterException(spec.commandLine(), "请提供 content 子命令"); }
    }
    @Command(name = "tags", description = "查询标签库", mixinStandardHelpOptions = true)
    public static final class TagsGroup implements Callable<Integer> {
        @Spec CommandSpec spec;
        @Override public Integer call() { throw new CommandLine.ParameterException(spec.commandLine(), "请提供 tags 子命令"); }
    }
}
