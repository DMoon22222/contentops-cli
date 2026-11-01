package com.example.contentops.cli;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.PrintWriter;
import java.util.Arrays;

/** Shares one reader with write confirmation so buffered command lines are not lost. */
public final class InteractiveShell {
    private final BufferedReader input;
    private final PrintWriter diagnostics;
    private final CliRunner runner;

    public InteractiveShell(BufferedReader input, PrintWriter diagnostics, CliRunner runner) {
        this.input = input;
        this.diagnostics = diagnostics;
        this.runner = runner;
    }

    public int run() {
        diagnostics.println("ContentOps CLI v1.1");
        diagnostics.println("Environment: mock");
        diagnostics.println("Type 'help' for commands.");
        try {
            while (true) {
                diagnostics.print("contentops> ");
                diagnostics.flush();
                String line = input.readLine();
                if (line == null) { diagnostics.println(); diagnostics.flush(); return 0; }
                try {
                    String[] args = CommandTokenizer.tokenize(line);
                    if (args.length > 0 && "contentops".equals(args[0])) {
                        args = Arrays.copyOfRange(args, 1, args.length);
                    }
                    if (args.length == 0) {
                        diagnostics.println("空命令；输入 help 查看用法。");
                    } else if ("exit".equals(args[0]) || "quit".equals(args[0])) {
                        if (args.length == 1) { return 0; }
                        diagnostics.println("exit / quit 不接收参数。");
                    } else {
                        if ("help".equals(args[0])) {
                            args = Arrays.copyOfRange(args, 1, args.length + 1);
                            args[args.length - 1] = "--help";
                        }
                        runner.runInteractive(input, args);
                    }
                } catch (IllegalArgumentException failure) {
                    diagnostics.println("参数解析失败：" + failure.getMessage());
                }
            }
        } catch (IOException failure) {
            diagnostics.println("Shell 输入读取失败，已退出。");
            diagnostics.flush();
            return 1;
        }
    }
}
