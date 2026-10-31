package com.example.contentops.cli;

import com.example.contentops.application.ContentService;
import com.example.contentops.application.OperationRejected;
import com.example.contentops.gateway.GatewayFailure;
import com.example.contentops.infrastructure.AppConfig;
import com.example.contentops.model.ResultModels;
import com.example.contentops.model.ResultModels.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import picocli.CommandLine;
import java.io.PrintWriter;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.function.Supplier;

public final class CliRunner {
    private final Map<String, String> environment;
    private final PrintWriter out;
    private final PrintWriter err;
    private final Function<AppConfig, ContentService> factory;
    private final ResultRenderer renderer;
    private RootCommand root;
    private ContentService service;

    public CliRunner(Map<String, String> environment, PrintWriter out, PrintWriter err,
                     ObjectMapper json, Function<AppConfig, ContentService> factory) {
        this.environment = Map.copyOf(environment);
        this.out = out;
        this.err = err;
        this.factory = factory;
        this.renderer = new ResultRenderer(json, out, err);
    }

    public int run(String... args) {
        root = new RootCommand();
        service = null;
        var command = new CommandLine(root);
        var content = new CommandLine(new RootCommand.ContentGroup());
        content.addSubcommand(new ReadCommands.ListContents(this));
        content.addSubcommand(new ReadCommands.GetContent(this));
        content.addSubcommand(new ReadCommands.History(this));
        var tags = new CommandLine(new RootCommand.TagsGroup());
        tags.addSubcommand(new ReadCommands.ListTags(this));
        command.addSubcommand(content).addSubcommand(tags);
        configure(command);
        return command.execute(args);
    }

    private void configure(CommandLine command) {
        command.setOut(out).setErr(err);
        command.setColorScheme(CommandLine.Help.defaultColorScheme(CommandLine.Help.Ansi.OFF));
        command.setOverwrittenOptionsAllowed(false).setAbbreviatedOptionsAllowed(false)
                .setAbbreviatedSubcommandsAllowed(false).setExpandAtFiles(false);
        command.setParameterExceptionHandler((exception, args) -> parseError(exception));
        command.setExecutionExceptionHandler((exception, cmd, parse) -> {
            if (exception instanceof CommandLine.ParameterException parameter) { return parseError(parameter); }
            return emitFailure(null, null, null, Outcome.INTERNAL_FAILURE,
                    "INTERNAL_ERROR", "内部错误；未执行任何业务写入");
        });
        command.getSubcommands().values().forEach(this::configure);
    }

    private int parseError(CommandLine.ParameterException exception) {
        Object leaf = exception.getCommandLine().getCommand();
        String name = leaf instanceof ReadCommands.ReadCommand read ? read.canonicalName() : null;
        return emitFailure(name, null, null, Outcome.REJECTED, "INVALID_ARGUMENTS",
                "命令、参数、必填项或参数类型不合法；请查看对应 --help（写命令本阶段未开放）");
    }

    int read(String command, String id, Supplier<?> query) {
        CliResult<?> result;
        try {
            if (!Set.of("table", "json").contains(root.output)) {
                throw new OperationRejected("INVALID_OUTPUT", "--output 只支持 table 或 json");
            }
            if (knownEnvironment() == null) {
                throw new OperationRejected("INVALID_ENVIRONMENT", "--env 只支持 mock 或 api");
            }
            Object data = query.get();
            result = ResultModels.result(knownEnvironment(), command, "read", id, Outcome.SUCCEEDED, data, null);
        } catch (OperationRejected failure) {
            return emitFailure(command, "read", id, Outcome.REJECTED, failure.code(), failure.getMessage());
        } catch (GatewayFailure failure) {
            return emitFailure(command, "read", id, Outcome.READ_FAILURE, failure.code(), failure.getMessage());
        } catch (RuntimeException failure) {
            return emitFailure(command, "read", id, Outcome.INTERNAL_FAILURE, "INTERNAL_ERROR", "内部读取错误；未执行业务写入");
        }
        return renderer.render(result, root.output);
    }

    ContentService service() {
        if (service == null) { service = factory.apply(AppConfig.load(root.environment, environment)); }
        return service;
    }

    private String knownEnvironment() {
        return Set.of("mock", "api").contains(root.environment) ? root.environment : null;
    }

    private int emitFailure(String command, String mode, String id, Outcome outcome, String code, String message) {
        var result = ResultModels.result(knownEnvironment(), command, mode, id, outcome, null,
                new CliError(code, message, mode == null ? null : "read", null));
        return renderer.render(result, root.output);
    }
}
