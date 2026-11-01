package com.example.contentops.cli;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;
import java.util.stream.Stream;
import static org.junit.jupiter.api.Assertions.*;

class CommandTokenizerTest {
    static Stream<Arguments> commands() {
        return Stream.of(
                Arguments.of("content get ct_000004", new String[]{"content", "get", "ct_000004"}),
                Arguments.of("  content\t list  ", new String[]{"content", "list"}),
                Arguments.of("--reason \"本地 演示 English\"", new String[]{"--reason", "本地 演示 English"}),
                Arguments.of("--reason '本地 演示 English'", new String[]{"--reason", "本地 演示 English"}),
                Arguments.of("--reason=\"本地 演示\" --add=悬疑", new String[]{"--reason=本地 演示", "--add=悬疑"}),
                Arguments.of("--reason ''", new String[]{"--reason", ""}),
                Arguments.of("--reason='中文\"引号'", new String[]{"--reason=中文\"引号"}),
                Arguments.of("--reason=前'中 文'后", new String[]{"--reason=前中 文后"}),
                Arguments.of("'C:\\中文 目录\\文件'", new String[]{"C:\\中文 目录\\文件"}),
                Arguments.of("'$HOME | > & $(command)'", new String[]{"$HOME | > & $(command)"}),
                Arguments.of("", new String[]{}),
                Arguments.of(" \t ", new String[]{}));
    }

    @ParameterizedTest @MethodSource("commands")
    void tokenizesWithoutShellExpansion(String line, String[] expected) {
        assertArrayEquals(expected, CommandTokenizer.tokenize(line));
    }

    @ParameterizedTest @ValueSource(strings = {"--reason '未闭合", "--reason \"未闭合"})
    void rejectsUnclosedQuotes(String line) {
        assertTrue(assertThrows(IllegalArgumentException.class,
                () -> CommandTokenizer.tokenize(line)).getMessage().contains("引号未闭合"));
    }
}
