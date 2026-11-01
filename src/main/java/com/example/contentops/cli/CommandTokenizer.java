package com.example.contentops.cli;

import java.util.ArrayList;
import java.util.List;

/** Argument tokenization only. No expansion, escaping, pipes or command execution. */
public final class CommandTokenizer {
    private CommandTokenizer() { }

    public static String[] tokenize(String line) {
        List<String> tokens = new ArrayList<>();
        var token = new StringBuilder();
        char quote = 0;
        boolean started = false;
        for (int i = 0; i < line.length(); i++) {
            char current = line.charAt(i);
            if (quote != 0) {
                if (current == quote) { quote = 0; }
                else { token.append(current); }
            } else if (current == '\'' || current == '"') {
                quote = current;
                started = true;
            } else if (Character.isWhitespace(current)) {
                if (started) {
                    tokens.add(token.toString());
                    token.setLength(0);
                    started = false;
                }
            } else {
                token.append(current);
                started = true;
            }
        }
        if (quote != 0) { throw new IllegalArgumentException("引号未闭合；请补全单引号或双引号后重试。"); }
        if (started) { tokens.add(token.toString()); }
        return tokens.toArray(String[]::new);
    }
}
