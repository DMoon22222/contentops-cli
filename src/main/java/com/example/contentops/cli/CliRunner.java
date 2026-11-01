package com.example.contentops.cli;

import com.example.contentops.application.ContentService;
import com.example.contentops.application.OperationRejected;
import com.example.contentops.gateway.GatewayFailure;
import com.example.contentops.infrastructure.AppConfig;
import com.example.contentops.infrastructure.mock.MockScenario;
import com.example.contentops.model.ResultModels;
import com.example.contentops.model.ResultModels.*;
import com.example.contentops.model.OperationModels.WriteSpec;
import com.fasterxml.jackson.databind.ObjectMapper;
import picocli.CommandLine;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.PrintWriter;
import java.util.Map;
import java.util.Set;
import java.util.List;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Objects;
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
    private BufferedReader interactiveInput;

    public CliRunner(Map<String, String> environment, PrintWriter out, PrintWriter err,
                     ObjectMapper json, Function<AppConfig, ContentService> factory) {
        this.environment = Map.copyOf(environment);
        this.out = out;
        this.err = err;
        this.factory = factory;
        this.renderer = new ResultRenderer(json, out, err);
    }

    public int run(String... args) {
        return runCommand(null, args);
    }

    public int runInteractive(BufferedReader input, String... args) {
        return runCommand(Objects.requireNonNull(input), args);
    }

    private int runCommand(BufferedReader input, String... args) {
        root = new RootCommand();
        service = null;
        interactiveInput = input;
        try {
            return createCommandTree().execute(args);
        } finally {
            interactiveInput = null;
        }
    }

    private CommandLine createCommandTree() {
        var command = new CommandLine(root);
        var content = new CommandLine(new RootCommand.ContentGroup());
        content.addSubcommand(new ReadCommands.ListContents(this));
        content.addSubcommand(new ReadCommands.GetContent(this));
        content.addSubcommand(new ReadCommands.History(this));
        content.addSubcommand(new WriteCommands.Review(this));
        content.addSubcommand(new WriteCommands.Process(this));
        var contentTags = new CommandLine(new RootCommand.ContentTagsGroup());
        contentTags.addSubcommand(new WriteCommands.UpdateTags(this));
        content.addSubcommand(contentTags);
        var tags = new CommandLine(new RootCommand.TagsGroup());
        tags.addSubcommand(new ReadCommands.ListTags(this));
        command.addSubcommand(content).addSubcommand(tags);
        configure(command);
        return command;
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
                    "INTERNAL_ERROR", "内部错误；无法提供可信结果，请核查实际状态");
        });
        command.getSubcommands().values().forEach(this::configure);
    }

    private int parseError(CommandLine.ParameterException exception) {
        Object leaf = exception.getCommandLine().getCommand();
        String name = leaf instanceof ReadCommands.ReadCommand read ? read.canonicalName()
                : leaf instanceof WriteCommands.WriteCommand write ? write.canonicalName() : null;
        return emitFailure(name, null, null, Outcome.REJECTED, "INVALID_ARGUMENTS",
                "命令、参数、必填项或参数类型不合法；请查看对应 --help（remove/set 尚未实现）");
    }

    int write(String command, WriteSpec spec, boolean execute, boolean yes) {
        String mode = execute ? "execute" : "preview";
        CliResult<?> result;
        try {
            if (!Set.of("table", "json").contains(root.output)) {
                throw new OperationRejected("INVALID_OUTPUT", "--output 只支持 table 或 json");
            }
            if (knownEnvironment() == null) {
                throw new OperationRejected("INVALID_ENVIRONMENT", "--env 只支持 mock 或 api");
            }
            boolean confirm = execute && !yes && interactiveInput != null && !root.nonInteractive;
            if ((!execute && yes) || (execute && !yes && !confirm)) {
                throw new OperationRejected("EXECUTION_AUTHORIZATION_REQUIRED", "单次或非交互执行必须同时提供 --execute --yes；仅 --yes 也不合法");
            }
            var application = service();
            var plan = application.plan(spec);
            WriteResult write;
            if (confirm && !confirm(spec)) {
                err.println("已取消，未执行任何写入。");
                err.flush();
                var preview = application.preview(plan);
                write = new WriteResult(Outcome.CANCELLED, preview.data(), null, preview.warnings());
            } else {
                write = execute ? application.execute(plan) : application.preview(plan);
            }
            result = ResultModels.result(knownEnvironment(), command, mode, spec.contentId(), write.outcome(), write.data(), write.error(), warnings(write.warnings()));
        } catch (OperationRejected failure) {
            return emitFailure(command, mode, spec.contentId(), Outcome.REJECTED, failure.code(), failure.getMessage());
        } catch (GatewayFailure failure) {
            return emitFailure(command, mode, spec.contentId(), Outcome.READ_FAILURE, failure.code(), failure.getMessage());
        } catch (IOException failure) {
            return emitFailure(command, mode, spec.contentId(), Outcome.CANCELLED, "CONFIRMATION_INPUT_FAILED", "读取确认失败，已取消，未执行任何写入");
        } catch (RuntimeException failure) {
            return emitFailure(command, mode, spec.contentId(), Outcome.INTERNAL_FAILURE, "INTERNAL_ERROR", "操作未完成；请核查实际状态，不自动重试");
        }
        return renderer.render(result, root.output);
    }

    private boolean confirm(WriteSpec spec) throws IOException {
        err.println("即将执行以下操作：");
        err.println("内容 ID：" + spec.contentId());
        if (spec.kind().includesReview()) { err.println("审核动作：" + spec.action()); }
        if (spec.reason() != null) { err.println("理由：" + confirmationText(spec.reason())); }
        if (spec.kind().includesTags()) { err.println("新增标签：" + confirmationText(String.join("、", spec.add()))); }
        err.print("确认执行吗？(y/N): ");
        err.flush();
        String answer = interactiveInput.readLine();
        return answer != null && Set.of("y", "yes").contains(answer.strip().toLowerCase(Locale.ROOT));
    }

    private static String confirmationText(String value) {
        return value.replace("\r", "\\r").replace("\n", "\\n").replace("\t", "\\t").replace("\u001b", "\\u001b");
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
            result = ResultModels.result(knownEnvironment(), command, "read", id, Outcome.SUCCEEDED, data, null, warnings(List.of()));
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

    private List<String> warnings(List<String> existing) {
        var result = new LinkedHashSet<>(existing);
        if ("mock".equals(knownEnvironment())) {
            try {
                var scenario = MockScenario.parse(environment.get("CONTENTOPS_MOCK_SCENARIO"));
                if (scenario.active()) { result.add(scenario.warning()); }
            } catch (OperationRejected invalid) { /* Invalid configuration never activates a fault. */ }
        }
        if (service != null) { result.addAll(service.diagnosticWarnings()); }
        return List.copyOf(result);
    }

    private int emitFailure(String command, String mode, String id, Outcome outcome, String code, String message) {
        var result = ResultModels.result(knownEnvironment(), command, mode, id, outcome, null,
                new CliError(code, message, mode == null ? null : "read".equals(mode) ? "read" : "preflight", null), warnings(List.of()));
        return renderer.render(result, root.output);
    }
}
